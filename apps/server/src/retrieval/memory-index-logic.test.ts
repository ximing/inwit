import { afterEach, describe, expect, it } from 'vitest';
import {
  collectionEmbeddingText,
  entryEmbeddingText,
  memoryCollectionsStoreName,
  memoryEntriesStoreName,
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
    expect(memoryCollectionsStoreName('production')).toBe('inwit_memory_collections_prod');
    expect(memoryEntriesStoreName('production')).toBe('inwit_memory_entries_prod');
    for (const nodeEnv of ['development', 'test', 'productionx']) {
      expect(memoryCollectionsStoreName(nodeEnv)).toBe('inwit_memory_collections_dev');
      expect(memoryEntriesStoreName(nodeEnv)).toBe('inwit_memory_entries_dev');
    }
    process.env.NODE_ENV = 'production';
    expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_prod');
    expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_prod');
    process.env.NODE_ENV = 'test';
    expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_dev');
    expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_dev');
    delete process.env.NODE_ENV;
    expect(memoryCollectionsStoreName()).toBe('inwit_memory_collections_dev');
    expect(memoryEntriesStoreName()).toBe('inwit_memory_entries_dev');
  });
});
