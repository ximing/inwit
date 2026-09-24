import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<unknown[] | Error>,
  selects: 0,
}));

const hybridSearchRanked = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: () => {
      state.selects += 1;
      const next = state.rows.shift();
      if (next instanceof Error) throw next;
      const rows = next ?? [];
      const query = {
        from() {
          return query;
        },
        where() {
          return query;
        },
        orderBy() {
          return query;
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
  }),
}));

vi.mock('../retrieval/pipeline.js', () => ({
  hybridSearchRanked,
}));

import { logger } from '../utils/logger.js';
import { memoryCollectionsStoreName, memoryEntriesStoreName } from '../retrieval/memory-index-logic.js';
import { MEMORY_LOAD_SEARCH_MAX_HITS } from './memory-load-logic.js';
import { loadMemoryCollectionTool, searchMemoryCollectionsTool } from './memory-tools.js';

const USER_ID = 'user-1';
const QUERY = 'SECRET_QUERY_切卡粒度';
const SECRET_TITLE = 'SECRET_TITLE_切卡';
const SECRET_DESC = 'SECRET_DESC_要例子';
const SECRET_BODY = 'SECRET_BODY_对照旧卡';
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const C4 = '44444444-4444-4444-8444-444444444444';
const RETIRED = '55555555-5555-4555-8555-555555555555';
const MISSING = '66666666-6666-4666-8666-666666666666';

function entryId(n: number): string {
  return `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`;
}

type RankedCall = {
  storeName: string;
  userId: string;
  query: string;
  limit: number;
  payloadEquals?: { key: string; value: string }[];
  filterIds?: (ids: string[]) => Promise<string[]>;
};

function asRankedCall(value: unknown): RankedCall {
  return value as RankedCall;
}

describe('memory collection tools', () => {
  beforeEach(() => {
    state.rows = [];
    state.selects = 0;
    hybridSearchRanked.mockReset();
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [] and does not embed when the user has no active collections', async () => {
    state.rows.push([{ n: '0' }]);
    const tool = searchMemoryCollectionsTool({ userId: USER_ID });
    const result = await tool.execute('call', { query: QUERY });
    expect(result.details).toEqual([]);
    expect(result.content).toEqual([{ type: 'text', text: '[]' }]);
    expect(hybridSearchRanked).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('memory.search_empty', {
      userId: USER_ID,
      collectionHits: 0,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(QUERY);
  });

  it('returns ranked title and description from the table, not from the index', async () => {
    state.rows.push([{ n: '2' }]);
    state.rows.push([{ id: C2 }, { id: C1 }]);
    state.rows.push([
      { id: C2, title: '易混', description: '对照旧卡' },
      { id: C1, title: '粒度', description: SECRET_DESC },
    ]);
    hybridSearchRanked.mockImplementation(async (input: unknown) => {
      const call = asRankedCall(input);
      expect(call.storeName).toBe(memoryCollectionsStoreName());
      expect(call.userId).toBe(USER_ID);
      expect(call.query).toBe(QUERY);
      expect(call.limit).toBe(5);
      expect(call.payloadEquals).toBeUndefined();
      const ids = call.filterIds ? await call.filterIds([C1, RETIRED, C2]) : [];
      expect(ids).toEqual([C1, C2]);
      return [
        { id: C1, score: 0.91 },
        { id: C2, score: null },
        { id: RETIRED, score: 0.2 },
      ];
    });

    const result = await searchMemoryCollectionsTool({ userId: USER_ID }).execute('call', { query: QUERY });
    expect(result.details).toEqual({
      collections: [
        { id: C1, title: '粒度', description: SECRET_DESC, score: 0.91 },
        { id: C2, title: '易混', description: '对照旧卡', score: null },
      ],
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns an empty collection list when search finds nothing, without a second embed', async () => {
    state.rows.push([{ n: 1 }]);
    hybridSearchRanked.mockResolvedValue([]);
    const result = await searchMemoryCollectionsTool({ userId: USER_ID }).execute('call', { query: QUERY });
    expect(result.details).toEqual({ collections: [] });
    expect(hybridSearchRanked).toHaveBeenCalledTimes(1);
    expect(state.selects).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('memory.search_empty', {
      userId: USER_ID,
      collectionHits: 0,
    });
  });

  it('warns and returns [] when search throws', async () => {
    state.rows.push([{ n: 1 }]);
    hybridSearchRanked.mockRejectedValue(new Error('embed down'));
    const result = await searchMemoryCollectionsTool({ userId: USER_ID }).execute('call', { query: QUERY });
    expect(result.details).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('memory.search_failed', {
      userId: USER_ID,
      error: 'embed down',
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(QUERY);

    state.rows.push(new Error('db down'));
    const again = await searchMemoryCollectionsTool({ userId: USER_ID }).execute('call', { query: QUERY });
    expect(again.details).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('memory.search_failed', {
      userId: USER_ID,
      error: 'db down',
    });
  });

  it('returns every active entry of a small collection and does not embed', async () => {
    state.rows.push([{ id: C1, title: SECRET_TITLE, description: SECRET_DESC }]);
    state.rows.push([{ id: entryId(1), collectionId: C1, body: SECRET_BODY }]);
    const result = await loadMemoryCollectionTool({ userId: USER_ID }).execute('call', {
      query: QUERY,
      collectionIds: [C1, C1, 'not-a-uuid'],
    });
    expect(result.details).toEqual({
      collections: [
        {
          id: C1,
          title: SECRET_TITLE,
          entries: [{ id: entryId(1), body: SECRET_BODY }],
          truncated: false,
        },
      ],
    });
    expect(result.details).not.toMatchObject({ collections: [expect.objectContaining({ description: SECRET_DESC })] });
    expect(hybridSearchRanked).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('memory.load', {
      userId: USER_ID,
      loadedIds: [C1],
      truncated: false,
    });
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain(SECRET_BODY);
    expect(logged).not.toContain(SECRET_DESC);
    expect(logged).not.toContain(SECRET_TITLE);
    expect(logged).not.toContain(QUERY);
  });

  it('searches inside a large collection and caps hits by rank and body size', async () => {
    const active = Array.from({ length: 13 }, (_, index) => ({
      id: entryId(index),
      collectionId: C1,
      body: 'a',
    }));
    state.rows.push([{ id: C1, title: SECRET_TITLE, description: SECRET_DESC }]);
    state.rows.push(active);
    state.rows.push([
      { id: entryId(2), body: '字' },
      { id: entryId(0), body: '字'.repeat(3000) },
      { id: entryId(1), body: '字'.repeat(1000) },
    ]);
    hybridSearchRanked.mockImplementation(async (input: unknown) => {
      const call = asRankedCall(input);
      expect(call.storeName).toBe(memoryEntriesStoreName());
      expect(call.userId).toBe(USER_ID);
      expect(call.query).toBe(QUERY);
      expect(call.limit).toBe(MEMORY_LOAD_SEARCH_MAX_HITS);
      expect(call.payloadEquals).toEqual([{ key: 'collection_id', value: C1 }]);
      const filtered = call.filterIds ? await call.filterIds([entryId(0), MISSING]) : [];
      expect(filtered).toEqual([entryId(0)]);
      return [entryId(0), entryId(1), entryId(2)].map((id) => ({ id, score: 0.4 }));
    });

    const result = await loadMemoryCollectionTool({ userId: USER_ID }).execute('call', {
      query: QUERY,
      collectionIds: [C1],
    });
    expect(result.details).toEqual({
      collections: [
        {
          id: C1,
          title: SECRET_TITLE,
          truncated: true,
          entries: [
            { id: entryId(0), body: '字'.repeat(3000) },
            { id: entryId(1), body: '字'.repeat(1000) },
          ],
        },
      ],
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('字');
  });

  it('loads at most three owned collections and warns on failure', async () => {
    state.rows.push([
      { id: C1, title: '一', description: 'd1' },
      { id: C2, title: '二', description: 'd2' },
      { id: C3, title: '三', description: 'd3' },
      { id: C4, title: '四', description: 'd4' },
    ]);
    state.rows.push([]);
    const capped = await loadMemoryCollectionTool({ userId: USER_ID }).execute('call', {
      query: QUERY,
      collectionIds: [C1, C2, C3, C4],
    });
    expect(capped.details).toEqual({
      collections: [
        { id: C1, title: '一', entries: [], truncated: false },
        { id: C2, title: '二', entries: [], truncated: false },
        { id: C3, title: '三', entries: [], truncated: false },
      ],
    });
    expect(hybridSearchRanked).not.toHaveBeenCalled();

    state.rows = [];
    state.selects = 0;
    const skipped = await loadMemoryCollectionTool({ userId: USER_ID }).execute('call', {
      query: QUERY,
      collectionIds: ['not-a-uuid'],
    });
    expect(skipped.details).toEqual({ collections: [] });
    expect(state.selects).toBe(0);
    expect(hybridSearchRanked).not.toHaveBeenCalled();

    state.rows.push(new Error('load down'));
    const failed = await loadMemoryCollectionTool({ userId: USER_ID }).execute('call', {
      query: QUERY,
      collectionIds: [C1],
    });
    expect(failed.details).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('memory.load_failed', {
      userId: USER_ID,
      error: 'load down',
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(QUERY);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(SECRET_BODY);
  });
});
