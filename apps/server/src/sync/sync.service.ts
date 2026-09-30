import type { SyncPollQuery, SyncPollResponse } from '@inwit/dto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { syncChanges } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  SYNC_PAGE_LIMIT,
  decideSyncPoll,
  syncChangeFromDriver,
  syncIdFromDriver,
  syncRetentionCutoff,
  toSyncPollResponse,
  type SyncChange,
} from './sync-logic.js';

const SYNC_SLOW_MS = 200;
const SYNC_PRUNE_BATCH = 5000;

async function timedSyncQuery<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    const ms = Date.now() - started;
    if (ms > SYNC_SLOW_MS) logger.warn('sync.slow', { userId, ms });
  }
}

async function readUserBounds(
  userId: string,
): Promise<{ oldestId: bigint | null; newestId: bigint | null }> {
  const [row] = await timedSyncQuery(userId, () =>
    getDb()
      .select({
        oldest: sql<string | null>`min(${syncChanges.id})::text`,
        newest: sql<string | null>`max(${syncChanges.id})::text`,
      })
      .from(syncChanges)
      .where(eq(syncChanges.userId, userId)),
  );
  return {
    oldestId: row?.oldest == null ? null : syncIdFromDriver(row.oldest),
    newestId: row?.newest == null ? null : syncIdFromDriver(row.newest),
  };
}

async function readPage(userId: string, since: bigint): Promise<SyncChange[]> {
  const rows = await timedSyncQuery(userId, () =>
    getDb()
      .select({
        id: syncChanges.id,
        scope: syncChanges.scope,
        resourceId: syncChanges.resourceId,
        op: syncChanges.op,
        at: syncChanges.at,
      })
      .from(syncChanges)
      .where(
        and(
          eq(syncChanges.userId, userId),
          // Decimal string, not Number(since): past 2^53 a float would skip or repeat rows.
          sql`${syncChanges.id} > ${since.toString()}::bigint`,
        ),
      )
      .orderBy(asc(syncChanges.id))
      .limit(SYNC_PAGE_LIMIT + 1),
  );
  return rows.map((row) => syncChangeFromDriver(row));
}

export async function pollSync(userId: string, query: SyncPollQuery): Promise<SyncPollResponse> {
  // Missing since is a handshake. since=0 is a real cursor and must return rows.
  const since = query.since === undefined ? null : syncIdFromDriver(query.since);
  let decision: ReturnType<typeof decideSyncPoll>;
  if (since === null) {
    const { newestId } = await readUserBounds(userId);
    decision = decideSyncPoll({ since, oldestId: null, newestId, rows: [] });
  } else if (since > 0n) {
    const [bounds, rows] = await Promise.all([readUserBounds(userId), readPage(userId, since)]);
    decision = decideSyncPoll({
      since,
      oldestId: bounds.oldestId,
      newestId: bounds.newestId,
      rows,
    });
  } else {
    decision = decideSyncPoll({
      since,
      oldestId: null,
      newestId: null,
      rows: await readPage(userId, since),
    });
  }
  const response = toSyncPollResponse(decision);
  if (response.changes.length > 0) {
    logger.info('sync.served', { userId, n: response.changes.length, more: response.more });
  }
  return response;
}

export async function pruneSyncChanges(now = new Date()): Promise<number> {
  const cutoff = syncRetentionCutoff(now);
  const db = getDb();
  let deleted = 0;
  // One 5000-row batch per hour cannot keep the 7-day window.
  // MATERIALIZED: otherwise PG may inline the CTE and delete more than one batch.
  // created_at is not indexed; add that index if one tick cannot finish the backlog.
  for (;;) {
    const result = await db.execute(sql`
      WITH delete_batch AS MATERIALIZED (
        SELECT ${syncChanges.id} AS id
        FROM ${syncChanges}
        WHERE ${syncChanges.createdAt} < ${cutoff}::timestamptz
        ORDER BY ${syncChanges.id}
        LIMIT ${SYNC_PRUNE_BATCH}
      )
      DELETE FROM ${syncChanges} AS target
      USING delete_batch AS batch
      WHERE target.id = batch.id
      RETURNING target.id
    `);
    const count = result.rows.length;
    deleted += count;
    if (count < SYNC_PRUNE_BATCH) break;
  }
  return deleted;
}
