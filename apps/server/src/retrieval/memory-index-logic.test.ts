import { afterEach, describe, expect, it } from 'vitest';
import {
  collectionEmbeddingText,
  entryEmbeddingText,
  isMemoryIndexStale,
  MEMORY_INDEX_REPAIR_LIMIT,
  MEMORY_INDEX_STALE_MS,
  memoryCollectionsStoreName,
  memoryEntriesStoreName,
  selectDirtyIndexBatch,
} from './memory-index-logic.js';

describe('memory embedding text', () => {
  it('embeds a trimmed title and description, not entry bodies', () => {
    expect(collectionEmbeddingText('  切卡粒度  ', '\n例子与定义\n')).toBe('切卡粒度\n例子与定义');
    expect(collectionEmbeddingText('   ', '  ')).toBe('\n');
  });

  it('embeds the collection title and the entry body', () => {
    expect(entryEmbeddingText(' 易混点 ', '  要对照旧卡  ')).toBe('易混点\n要对照旧卡');
  });
});

describe('memory store names', () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  it('uses _prod only when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_prod');
    expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_prod');
    for (const nodeEnv of ['development', 'test', 'productionx']) {
      process.env.NODE_ENV = nodeEnv;
      expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_dev');
      expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_dev');
    }
    delete process.env.NODE_ENV;
    expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_dev');
    expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_dev');
  });
});

describe('dirty memory index batch', () => {
  it('keeps the oldest 20 rows across collections and entries', () => {
    const collections = Array.from({ length: 15 }, (_, i) => ({
      id: `c${String(i)}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }));
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${String(i)}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i, 30)),
    }));
    const batch = selectDirtyIndexBatch(collections, entries);
    expect(MEMORY_INDEX_REPAIR_LIMIT).toBe(20);
    expect(batch).toHaveLength(20);
    expect(batch[0]).toEqual({ kind: 'collection', row: collections[0] });
    expect(batch[1]).toEqual({ kind: 'entry', row: entries[0] });
    expect(batch.filter((row) => row.kind === 'collection')).toHaveLength(10);
    expect(batch.filter((row) => row.kind === 'entry')).toHaveLength(10);
    expect(batch.at(-1)?.row.id).toBe('e9');
  });

  it('treats a row as stale only when updatedAt is strictly older than 15 minutes', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(MEMORY_INDEX_STALE_MS).toBe(15 * 60 * 1000);
    expect(isMemoryIndexStale(new Date(now.getTime() - MEMORY_INDEX_STALE_MS - 1), now)).toBe(true);
    expect(isMemoryIndexStale(new Date(now.getTime() - MEMORY_INDEX_STALE_MS), now)).toBe(false);
  });
});
