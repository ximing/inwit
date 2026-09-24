import { randomUUID } from 'node:crypto';
import type { MemoryRevision } from '@inwit/dto';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  cardFeedback,
  memoryCollections,
  memoryEntries,
  memoryRevisions,
  type MemoryCollectionRow,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { currentAgentRun } from './run-context.js';
import {
  MEMORY_ACTIVE_COLLECTION_CAP,
  MEMORY_ACTIVE_ENTRY_CAP,
  memoryBodyPreview,
  normalizeMemoryRevision,
  type NormalizedEntryTarget,
  type NormalizedMemoryRevision,
} from './memory-organize-logic.js';
import {
  indexDirtyMemoryRows,
  type DirtyMemoryIndexRow,
} from '../retrieval/memory-index-repair.js';

export class RevisionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionRejected';
  }
}

function reject(message: string): never {
  throw new RevisionRejected(message);
}

/** Only the revision batch key is idempotent. Other unique failures must retry. */
function isRevisionBatchConflict(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      current.constraint === 'memory_revisions_user_batch_key_uidx'
    ) {
      return true;
    }
    if (!('cause' in current)) break;
    current = current.cause;
  }
  return false;
}

type ColState = {
  id: string;
  title: string;
  description: string;
  status: MemoryCollectionRow['status'];
};

export type ApplyMemoryRevisionResult =
  | { duplicate: true }
  | { duplicate: false; indexed: 'ok' | 'partial'; revisionId: string };

function collectionIdOf(target: NormalizedEntryTarget, createdAtIndex: ReadonlyMap<number, string>): string {
  if (target.kind === 'collection') return target.id;
  const id = createdAtIndex.get(target.index);
  if (!id) reject('新建集合不存在');
  return id;
}

async function writeRevision(
  userId: string,
  jobId: string,
  batchKey: string,
  batchFeedbackIds: readonly string[],
  revision: NormalizedMemoryRevision,
): Promise<{ revisionId: string; indexRows: DirtyMemoryIndexRow[] }> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const loaded = await tx
      .select()
      .from(memoryCollections)
      .where(eq(memoryCollections.userId, userId))
      .for('update');
    const cols = new Map<string, ColState>(
      loaded.map((row) => [
        row.id,
        { id: row.id, title: row.title, description: row.description, status: row.status },
      ]),
    );

    const sourceIds: string[] = [];
    const updateIds: string[] = [];
    const intoIds = new Set<string>();
    for (const op of revision.collections) {
      if (op.op === 'retire') sourceIds.push(op.id);
      else if (op.op === 'merge') {
        sourceIds.push(...op.sourceIds);
        intoIds.add(op.intoId);
      } else if (op.op === 'update') updateIds.push(op.id);
      else if (op.clientId && cols.has(op.clientId)) reject('create 不传 id');
    }

    const requireActive = (id: string, message: string) => {
      const col = cols.get(id);
      if (!col || col.status !== 'active') reject(message);
    };
    for (const id of sourceIds) requireActive(id, 'retire 或 merge 必须指向启用中的集合');
    for (const id of updateIds) requireActive(id, 'update 必须传已有 id');
    for (const id of intoIds) requireActive(id, 'merge 的 intoId 必须是启用中的集合');

    const indexRows = new Map<string, DirtyMemoryIndexRow>();
    const remember = (row: DirtyMemoryIndexRow) => {
      indexRows.set(`${row.kind}:${row.id}`, row);
    };
    const diffCollections: MemoryRevision['diff']['collections'] = [];
    const diffEntries: MemoryRevision['diff']['entries'] = [];
    const createdAtIndex = new Map<number, string>();
    const autoRetired: Array<{ id: string; collectionId: string; body: string }> = [];

    // Retire sources before entry ops so a later retire of those entries is a no-op.
    if (sourceIds.length > 0) {
      const retiredCols = await tx
        .update(memoryCollections)
        .set({ status: 'retired', retiredAt: now, indexDirty: true, updatedAt: now })
        .where(
          and(
            eq(memoryCollections.userId, userId),
            inArray(memoryCollections.id, sourceIds),
            eq(memoryCollections.status, 'active'),
          ),
        )
        .returning({
          id: memoryCollections.id,
          title: memoryCollections.title,
          description: memoryCollections.description,
          updatedAt: memoryCollections.updatedAt,
        });
      if (retiredCols.length !== sourceIds.length) reject('retire 或 merge 必须指向启用中的集合');
      for (const row of retiredCols) {
        const col = cols.get(row.id);
        if (col) col.status = 'retired';
        remember({
          kind: 'collection',
          id: row.id,
          userId,
          updatedAt: row.updatedAt,
          status: 'retired',
          title: row.title,
          description: row.description,
        });
      }
      const retiredEntries = await tx
        .update(memoryEntries)
        .set({ status: 'retired', retiredAt: now, indexDirty: true, updatedAt: now })
        .where(
          and(
            eq(memoryEntries.userId, userId),
            inArray(memoryEntries.collectionId, sourceIds),
            eq(memoryEntries.status, 'active'),
          ),
        )
        .returning({
          id: memoryEntries.id,
          collectionId: memoryEntries.collectionId,
          body: memoryEntries.body,
          updatedAt: memoryEntries.updatedAt,
        });
      for (const row of retiredEntries) {
        autoRetired.push({ id: row.id, collectionId: row.collectionId, body: row.body });
        const title = cols.get(row.collectionId)?.title ?? '';
        remember({
          kind: 'entry',
          id: row.id,
          userId,
          updatedAt: row.updatedAt,
          status: 'retired',
          collectionId: row.collectionId,
          collectionTitle: title,
          body: row.body,
        });
      }
    }

    // Creates happen before entries so an add can target a collection born in this revision.
    for (let index = 0; index < revision.collections.length; index += 1) {
      const op = revision.collections[index];
      if (!op || op.op !== 'create') continue;
      const id = op.clientId ?? randomUUID();
      if (cols.has(id)) reject('create 不传 id');
      const [inserted] = await tx
        .insert(memoryCollections)
        .values({
          id,
          userId,
          title: op.title,
          description: op.description,
          status: 'active',
          indexDirty: true,
        })
        .returning({ id: memoryCollections.id, updatedAt: memoryCollections.updatedAt });
      if (!inserted) reject('修订没有写入');
      createdAtIndex.set(index, inserted.id);
      cols.set(inserted.id, {
        id: inserted.id,
        title: op.title,
        description: op.description,
        status: 'active',
      });
      remember({
        kind: 'collection',
        id: inserted.id,
        userId,
        updatedAt: inserted.updatedAt,
        status: 'active',
        title: op.title,
        description: op.description,
      });
    }

    for (const op of revision.collections) {
      if (op.op === 'update') {
        const col = cols.get(op.id);
        if (!col || col.status !== 'active') reject('update 必须传已有 id');
        const title = op.title ?? col.title;
        const description = op.description ?? col.description;
        const titleChanged = title !== col.title;
        const [updated] = await tx
          .update(memoryCollections)
          .set({ title, description, indexDirty: true, updatedAt: now })
          .where(and(eq(memoryCollections.id, op.id), eq(memoryCollections.userId, userId)))
          .returning({ updatedAt: memoryCollections.updatedAt });
        if (!updated) reject('update 必须传已有 id');
        col.title = title;
        col.description = description;
        remember({
          kind: 'collection',
          id: op.id,
          userId,
          updatedAt: updated.updatedAt,
          status: 'active',
          title,
          description,
        });
        if (titleChanged) {
          const marked = await tx
            .update(memoryEntries)
            .set({ indexDirty: true, updatedAt: now })
            .where(
              and(
                eq(memoryEntries.userId, userId),
                eq(memoryEntries.collectionId, op.id),
                eq(memoryEntries.status, 'active'),
              ),
            )
            .returning({
              id: memoryEntries.id,
              body: memoryEntries.body,
              collectionId: memoryEntries.collectionId,
              updatedAt: memoryEntries.updatedAt,
            });
          for (const entry of marked) {
            remember({
              kind: 'entry',
              id: entry.id,
              userId,
              updatedAt: entry.updatedAt,
              status: 'active',
              collectionId: entry.collectionId,
              collectionTitle: title,
              body: entry.body,
            });
          }
        }
        continue;
      }
    }

    for (let index = 0; index < revision.collections.length; index += 1) {
      const op = revision.collections[index];
      if (!op) continue;
      if (op.op === 'create') {
        const id = createdAtIndex.get(index);
        if (!id) reject('新建集合不存在');
        diffCollections.push({ op: 'create', id, title: op.title });
        continue;
      }
      if (op.op === 'update' || op.op === 'retire') {
        const col = cols.get(op.id);
        diffCollections.push({ op: op.op, id: op.id, title: col?.title ?? '' });
        continue;
      }
      const col = cols.get(op.intoId);
      diffCollections.push({
        op: 'merge',
        id: op.intoId,
        title: col?.title ?? '',
        sourceIds: op.sourceIds,
      });
    }

    const entryIds = revision.entries.flatMap((op) => (op.op === 'add' ? [] : [op.id]));
    const entryById = new Map<
      string,
      { id: string; collectionId: string; body: string; status: 'active' | 'retired' }
    >();
    if (entryIds.length > 0) {
      const entryRows = await tx
        .select({
          id: memoryEntries.id,
          collectionId: memoryEntries.collectionId,
          body: memoryEntries.body,
          status: memoryEntries.status,
        })
        .from(memoryEntries)
        .where(and(eq(memoryEntries.userId, userId), inArray(memoryEntries.id, entryIds)))
        .for('update');
      for (const row of entryRows) entryById.set(row.id, row);
    }

    const requireLiveCollection = (id: string) => {
      const col = cols.get(id);
      if (!col || col.status !== 'active') reject('add 或 update 不能指向已停用的集合');
      return col;
    };

    for (const op of revision.entries) {
      if (op.op === 'add') {
        const collectionId = collectionIdOf(op.target, createdAtIndex);
        const col = requireLiveCollection(collectionId);
        const [inserted] = await tx
          .insert(memoryEntries)
          .values({
            userId,
            collectionId,
            body: op.body,
            status: 'active',
            indexDirty: true,
          })
          .returning({ id: memoryEntries.id, updatedAt: memoryEntries.updatedAt });
        if (!inserted) reject('修订没有写入');
        remember({
          kind: 'entry',
          id: inserted.id,
          userId,
          updatedAt: inserted.updatedAt,
          status: 'active',
          collectionId,
          collectionTitle: col.title,
          body: op.body,
        });
        diffEntries.push({
          op: 'add',
          id: inserted.id,
          collectionId,
          bodyPreview: memoryBodyPreview(op.body),
        });
        continue;
      }
      const row = entryById.get(op.id);
      if (!row) reject('条目不存在');
      if (op.op === 'update') {
        if (row.status !== 'active') reject('不能更新已停用的条目');
        if (op.collectionId && op.collectionId !== row.collectionId) reject('条目不属于这个集合');
        const col = requireLiveCollection(row.collectionId);
        const [updated] = await tx
          .update(memoryEntries)
          .set({ body: op.body, indexDirty: true, updatedAt: now })
          .where(and(eq(memoryEntries.id, op.id), eq(memoryEntries.userId, userId)))
          .returning({ updatedAt: memoryEntries.updatedAt });
        if (!updated) reject('条目不存在');
        row.body = op.body;
        remember({
          kind: 'entry',
          id: op.id,
          userId,
          updatedAt: updated.updatedAt,
          status: 'active',
          collectionId: row.collectionId,
          collectionTitle: col.title,
          body: op.body,
        });
        diffEntries.push({
          op: 'update',
          id: op.id,
          collectionId: row.collectionId,
          bodyPreview: memoryBodyPreview(op.body),
        });
        continue;
      }
      if (row.status === 'retired') {
        diffEntries.push({
          op: 'retire',
          id: op.id,
          collectionId: row.collectionId,
          bodyPreview: memoryBodyPreview(row.body),
        });
        continue;
      }
      const [updated] = await tx
        .update(memoryEntries)
        .set({ status: 'retired', retiredAt: now, indexDirty: true, updatedAt: now })
        .where(
          and(
            eq(memoryEntries.id, op.id),
            eq(memoryEntries.userId, userId),
            eq(memoryEntries.status, 'active'),
          ),
        )
        .returning({ updatedAt: memoryEntries.updatedAt });
      if (!updated) reject('条目不存在');
      row.status = 'retired';
      const title = cols.get(row.collectionId)?.title ?? '';
      remember({
        kind: 'entry',
        id: op.id,
        userId,
        updatedAt: updated.updatedAt,
        status: 'retired',
        collectionId: row.collectionId,
        collectionTitle: title,
        body: row.body,
      });
      diffEntries.push({
        op: 'retire',
        id: op.id,
        collectionId: row.collectionId,
        bodyPreview: memoryBodyPreview(row.body),
      });
    }

    const explicitRetire = new Set(
      revision.entries.flatMap((op) => (op.op === 'retire' ? [op.id] : [])),
    );
    for (const entry of autoRetired) {
      if (explicitRetire.has(entry.id)) continue;
      diffEntries.push({
        op: 'retire',
        id: entry.id,
        collectionId: entry.collectionId,
        bodyPreview: memoryBodyPreview(entry.body),
      });
    }

    const [activeCollections] = await tx
      .select({ n: count() })
      .from(memoryCollections)
      .where(and(eq(memoryCollections.userId, userId), eq(memoryCollections.status, 'active')));
    if (Number(activeCollections?.n ?? 0) > MEMORY_ACTIVE_COLLECTION_CAP) {
      reject('启用中的集合最多 24 个，请先 merge 或 retire 再创建');
    }
    const activeEntries = await tx
      .select({ collectionId: memoryEntries.collectionId, n: count() })
      .from(memoryEntries)
      .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.status, 'active')))
      .groupBy(memoryEntries.collectionId);
    for (const row of activeEntries) {
      if (Number(row.n) > MEMORY_ACTIVE_ENTRY_CAP) {
        reject('每个集合最多 40 条启用中的条目，请先 retire 再添加');
      }
    }

    const diff: MemoryRevision['diff'] = {
      collections: diffCollections,
      entries: diffEntries,
      feedbackCount: batchFeedbackIds.length,
    };
    const [created] = await tx
      .insert(memoryRevisions)
      .values({
        userId,
        jobId,
        executionId: currentAgentRun()?.executionId ?? null,
        batchKey,
        summary: revision.summary,
        diff,
        feedbackIds: [...batchFeedbackIds],
      })
      .returning({ id: memoryRevisions.id });
    if (!created) reject('修订没有写入');

    const consumed = await tx
      .update(cardFeedback)
      .set({ consumedAt: now, organizeJobId: jobId })
      .where(
        and(
          eq(cardFeedback.userId, userId),
          inArray(cardFeedback.id, [...batchFeedbackIds]),
          isNull(cardFeedback.consumedAt),
        ),
      )
      .returning({ id: cardFeedback.id });
    if (consumed.length !== batchFeedbackIds.length) reject('这批反馈已变化，不能写入修订');

    return { revisionId: created.id, indexRows: [...indexRows.values()] };
  });
}

export async function applyMemoryRevision(input: {
  userId: string;
  jobId: string;
  batchKey: string;
  batchFeedbackIds: readonly string[];
  raw: { summary: unknown; collections: unknown; entries: unknown };
}): Promise<ApplyMemoryRevisionResult> {
  if (input.batchFeedbackIds.length === 0) reject('没有锁定的反馈');
  const normalized = normalizeMemoryRevision(input.raw);
  if (!normalized.ok) reject(normalized.message);
  try {
    const committed = await writeRevision(
      input.userId,
      input.jobId,
      input.batchKey,
      input.batchFeedbackIds,
      normalized.value,
    );
    try {
      const indexed = await indexDirtyMemoryRows(committed.indexRows);
      return { duplicate: false, indexed, revisionId: committed.revisionId };
    } catch (err) {
      logger.warn('memory.index_failed', {
        id: committed.revisionId,
        kind: 'revision',
        error: err instanceof Error ? err.message.slice(0, 200) : 'error',
      });
      return { duplicate: false, indexed: 'partial', revisionId: committed.revisionId };
    }
  } catch (err) {
    if (err instanceof RevisionRejected) throw err;
    if (isRevisionBatchConflict(err)) return { duplicate: true };
    throw err;
  }
}
