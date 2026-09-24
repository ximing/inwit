import { describe, expect, it } from 'vitest';
import {
  MEMORY_LOAD_ALL_MAX_CHARS,
  MEMORY_LOAD_ALL_MAX_ENTRIES,
  MEMORY_LOAD_MAX_COLLECTIONS,
  MEMORY_LOAD_SEARCH_MAX_CHARS,
  MEMORY_LOAD_SEARCH_MAX_HITS,
  keepUuidIds,
  memoryLoadFitsInline,
  selectMemoryLoad,
  takeMemoryCollectionIds,
} from './memory-load-logic.js';

function entries(count: number, each: string): { id: string; body: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `e${index}`, body: each }));
}

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const C4 = '44444444-4444-4444-8444-444444444444';

describe('takeMemoryCollectionIds', () => {
  it('keeps order, caps at 3, and drops duplicates and non-uuids', () => {
    expect(takeMemoryCollectionIds([C2, 'nope', C2, C1.toUpperCase(), C3, C4, ''])).toEqual([
      C2,
      C1.toUpperCase(),
      C3,
    ]);
    expect(takeMemoryCollectionIds([C1, C1])).toEqual([C1]);
    expect(takeMemoryCollectionIds([C1, C1.toUpperCase()])).toEqual([C1]);
    expect(takeMemoryCollectionIds(['not-a-uuid', 12, null])).toEqual([]);
    expect(takeMemoryCollectionIds([C1, C2], 0)).toEqual([]);
    expect(MEMORY_LOAD_MAX_COLLECTIONS).toBe(3);
    expect(keepUuidIds([C1, C2, C3, C4, C1.toUpperCase(), 'nope'])).toEqual([C1, C2, C3, C4]);
  });
});

describe('memoryLoadFitsInline', () => {
  it('is true only while both the entry count and the code-point size fit', () => {
    expect(memoryLoadFitsInline([])).toBe(true);
    expect(memoryLoadFitsInline(entries(MEMORY_LOAD_ALL_MAX_ENTRIES, 'a'))).toBe(true);
    expect(memoryLoadFitsInline(entries(MEMORY_LOAD_ALL_MAX_ENTRIES + 1, 'a'))).toBe(false);
    expect(memoryLoadFitsInline([{ body: '🙂'.repeat(MEMORY_LOAD_ALL_MAX_CHARS) }])).toBe(true);
    expect(memoryLoadFitsInline([{ body: '🙂'.repeat(MEMORY_LOAD_ALL_MAX_CHARS + 1) }])).toBe(false);
  });
});

describe('selectMemoryLoad', () => {
  it('returns every active entry at or under both all-load limits', () => {
    const active = entries(MEMORY_LOAD_ALL_MAX_ENTRIES, '🙂'.repeat(MEMORY_LOAD_ALL_MAX_CHARS / 12));
    const hits = entries(3, 'other');
    expect(active.reduce((sum, entry) => sum + [...entry.body].length, 0)).toBe(
      MEMORY_LOAD_ALL_MAX_CHARS,
    );
    expect(selectMemoryLoad({ active, hits })).toEqual({ entries: active, truncated: false });
    expect(selectMemoryLoad({ active: [], hits })).toEqual({ entries: [], truncated: false });
  });

  it('searches once either the entry count or the body size is over the limit', () => {
    const tooMany = entries(MEMORY_LOAD_ALL_MAX_ENTRIES + 1, 'a');
    const tooLong = entries(2, '字'.repeat(MEMORY_LOAD_ALL_MAX_CHARS));
    const hits = entries(2, 'hit');
    expect(selectMemoryLoad({ active: tooMany, hits })).toEqual({ entries: hits, truncated: true });
    expect(selectMemoryLoad({ active: tooLong, hits })).toEqual({ entries: hits, truncated: true });
    expect(
      selectMemoryLoad({
        active: entries(MEMORY_LOAD_ALL_MAX_ENTRIES, '🙂'.repeat(201)),
        hits,
      }).truncated,
    ).toBe(true);
  });

  it('caps search hits at 8 and accumulated body chars at 4000', () => {
    const active = entries(MEMORY_LOAD_ALL_MAX_ENTRIES + 1, 'a');
    const shortHits = entries(MEMORY_LOAD_SEARCH_MAX_HITS + 2, 'x');
    const capped = selectMemoryLoad({ active, hits: shortHits });
    expect(capped.truncated).toBe(true);
    expect(capped.entries).toEqual(shortHits.slice(0, MEMORY_LOAD_SEARCH_MAX_HITS));

    const wide = [
      { id: 'a', body: '字'.repeat(3000) },
      { id: 'b', body: '字'.repeat(1000) },
      { id: 'c', body: '字'.repeat(1) },
    ];
    expect(selectMemoryLoad({ active, hits: wide }).entries.map((entry) => entry.id)).toEqual([
      'a',
      'b',
    ]);
    expect(
      selectMemoryLoad({
        active,
        hits: [{ id: 'only', body: '字'.repeat(MEMORY_LOAD_SEARCH_MAX_CHARS) }],
      }).entries,
    ).toHaveLength(1);
    expect(
      selectMemoryLoad({
        active,
        hits: [{ id: 'over', body: '字'.repeat(MEMORY_LOAD_SEARCH_MAX_CHARS + 1) }],
      }).entries,
    ).toEqual([]);

    const exact = entries(MEMORY_LOAD_SEARCH_MAX_HITS, '字'.repeat(500));
    expect(exact.reduce((sum, entry) => sum + [...entry.body].length, 0)).toBe(
      MEMORY_LOAD_SEARCH_MAX_CHARS,
    );
    expect(selectMemoryLoad({ active, hits: exact }).entries).toEqual(exact);
  });
});
