import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { memoryCollections, memoryEntries } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  isMemoryIndexStale,
  MEMORY_INDEX_REPAIR_LIMIT,
  selectDirtyIndexBatch,
} from './memory-index-logic.js';
import {
  deleteMemoryCollectionFromIndex,
  deleteMemoryEntryFromIndex,
  indexMemoryCollection,
  indexMemoryEntry,
} from './pipeline.js';

export interface DirtyMemoryCollection {
  kind: 'collection';
  id: string;
  userId: string;
  updatedAt: Date;
  status: 'active' | 'retired';
  title: string;
  description: string;
}

export interface DirtyMemoryEntry {
  kind: 'entry';
  id: string;
  userId: string;
  updatedAt: Date;
  status: 'active' | 'retired';
  collectionId: string;
  collectionTitle: string;
  body: string;
}

export type DirtyMemoryIndexRow = DirtyMemoryCollection | DirtyMemoryEntry;

/** Match updatedAt so a newer write that landed while we embedded stays dirty. */
async function clearDirty(row: DirtyMemoryIndexRow): Promise<void> {
  if (row.kind === 'collection') {
    await getDb()
      .update(memoryCollections)
      .set({ indexDirty: false })
      .where(
        and(
          eq(memoryCollections.id, row.id),
          eq(memoryCollections.updatedAt, row.updatedAt),
          eq(memoryCollections.indexDirty, true),
        ),
      );
    return;
  }
  await getDb()
    .update(memoryEntries)
    .set({ indexDirty: false })
    .where(
      and(
        eq(memoryEntries.id, row.id),
        eq(memoryEntries.updatedAt, row.updatedAt),
        eq(memoryEntries.indexDirty, true),
      ),
    );
}

/** Upsert active rows and delete retired ones. A failed row stays dirty. */
export async function indexDirtyMemoryRows(rows: readonly DirtyMemoryIndexRow[]): Promise<'ok' | 'partial'> {
  if (rows.length === 0) return 'ok';
  let partial = false;
  for (const row of rows) {
    try {
      if (row.kind === 'collection') {
        if (row.status === 'active') {
          await indexMemoryCollection({
            id: row.id,
            userId: row.userId,
            title: row.title,
            description: row.description,
          });
        } else {
          await deleteMemoryCollectionFromIndex(row.id);
        }
      } else if (row.status === 'active') {
        await indexMemoryEntry({
          id: row.id,
          userId: row.userId,
          collectionId: row.collectionId,
          collectionTitle: row.collectionTitle,
          body: row.body,
        });
      } else {
        await deleteMemoryEntryFromIndex(row.id);
      }
      await clearDirty(row);
    } catch (err) {
      partial = true;
      logger.warn('memory.index_failed', {
        id: row.id,
        kind: row.kind,
        error: err instanceof Error ? err.message.slice(0, 200) : 'error',
      });
    }
  }
  return partial ? 'partial' : 'ok';
}

/**
 * Embed at most 20 dirty collection or entry rows. Returns immediately when
 * nothing is dirty so the timer does not call the embedding API.
 */
export async function repairDirtyMemoryIndexes(now = new Date()): Promise<number> {
  const db = getDb();
  const [collectionRows, entryRows] = await Promise.all([
    db
      .select({
        id: memoryCollections.id,
        userId: memoryCollections.userId,
        updatedAt: memoryCollections.updatedAt,
        status: memoryCollections.status,
        title: memoryCollections.title,
        description: memoryCollections.description,
      })
      .from(memoryCollections)
      .where(eq(memoryCollections.indexDirty, true))
      .orderBy(asc(memoryCollections.updatedAt), asc(memoryCollections.id))
      .limit(MEMORY_INDEX_REPAIR_LIMIT),
    db
      .select({
        id: memoryEntries.id,
        userId: memoryEntries.userId,
        updatedAt: memoryEntries.updatedAt,
        status: memoryEntries.status,
        collectionId: memoryEntries.collectionId,
        body: memoryEntries.body,
      })
      .from(memoryEntries)
      .where(eq(memoryEntries.indexDirty, true))
      .orderBy(asc(memoryEntries.updatedAt), asc(memoryEntries.id))
      .limit(MEMORY_INDEX_REPAIR_LIMIT),
  ]);
  const picked = selectDirtyIndexBatch(collectionRows, entryRows, MEMORY_INDEX_REPAIR_LIMIT);
  if (picked.length === 0) return 0;

  for (const item of picked) {
    if (!isMemoryIndexStale(item.row.updatedAt, now)) continue;
    logger.warn('memory.index_stale', {
      id: item.row.id,
      kind: item.kind,
      updatedAt: item.row.updatedAt.toISOString(),
    });
  }

  const entryCollectionIds = [
    ...new Set(picked.flatMap((item) => (item.kind === 'entry' ? [item.row.collectionId] : []))),
  ];
  const titles = new Map<string, string>();
  if (entryCollectionIds.length > 0) {
    const cols = await db
      .select({ id: memoryCollections.id, title: memoryCollections.title })
      .from(memoryCollections)
      .where(inArray(memoryCollections.id, entryCollectionIds));
    for (const col of cols) titles.set(col.id, col.title);
  }

  const rows: DirtyMemoryIndexRow[] = [];
  for (const item of picked) {
    if (item.kind === 'collection') {
      rows.push({ kind: 'collection', ...item.row });
      continue;
    }
    const collectionTitle = titles.get(item.row.collectionId);
    if (item.row.status === 'active' && collectionTitle === undefined) {
      logger.warn('memory.index_failed', { id: item.row.id, kind: 'entry', error: 'missing collection' });
      continue;
    }
    rows.push({
      kind: 'entry',
      id: item.row.id,
      userId: item.row.userId,
      updatedAt: item.row.updatedAt,
      status: item.row.status,
      collectionId: item.row.collectionId,
      collectionTitle: collectionTitle ?? '',
      body: item.row.body,
    });
  }
  await indexDirtyMemoryRows(rows);
  return picked.length;
}
