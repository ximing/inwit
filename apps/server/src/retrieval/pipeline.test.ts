import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    DASHSCOPE_API_KEY: 'test-key',
    DASHSCOPE_BASE_URL: 'https://dashscope.example.test',
    EMBEDDING_MODEL: 'embed-test',
    EMBEDDING_DIMENSIONS: 4,
    RERANK_MODEL: 'rerank-test',
    QDRANT_URL: 'https://qdrant.example.test',
    QDRANT_API_KEY: 'qdrant-test',
    MEILI_HOST: 'https://meili.example.test',
    MEILI_API_KEY: 'meili-test',
  },
}));

import { logger } from '../utils/logger.js';
import { memoryCollectionsStoreName, memoryEntriesStoreName } from './memory-index-logic.js';
import {
  MEMORY_COLLECTION_INDEX_SETTINGS,
  MEMORY_ENTRY_INDEX_SETTINGS,
} from './meili.js';
import {
  deleteMemoryCollectionFromIndex,
  deleteMemoryEntryFromIndex,
  hybridSearchRanked,
  indexMemoryCollection,
  indexMemoryEntry,
  searchCards,
} from './pipeline.js';
import {
  cardsStoreName,
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from './registry.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COLLECTION_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const RECALL = 20;

function installClients() {
  const embedding: EmbeddingClient = {
    embedTexts: vi.fn(async () => [[0.25, 0.5]]),
  };
  const qdrant: QdrantClient = {
    ensureCollection: vi.fn(async () => undefined),
    upsertPoints: vi.fn(async () => undefined),
    queryPoints: vi.fn(async () => []),
    deletePoints: vi.fn(async () => undefined),
  };
  const meili: MeiliClient = {
    ensureIndex: vi.fn(async () => undefined),
    upsertDocuments: vi.fn(async () => undefined),
    deleteDocuments: vi.fn(async () => undefined),
    listIds: vi.fn(async () => []),
    search: vi.fn(async () => []),
  };
  const rerank: RerankClient = {
    rerankTexts: vi.fn(async () => []),
  };
  setRetrievalClientsForTest({ embedding, qdrant, meili, rerank });
  return { embedding, qdrant, meili, rerank };
}

let clients: ReturnType<typeof installClients>;

beforeEach(() => {
  clients = installClients();
});

afterEach(() => {
  resetRetrievalClientsForTest();
});

describe('hybridSearchRanked', () => {
  it('does not embed or query stores for an empty query', async () => {
    for (const query of ['', '   ', '\n\t']) {
      await expect(
        hybridSearchRanked({
          storeName: memoryCollectionsStoreName(),
          userId: USER_ID,
          query,
          limit: 5,
        }),
      ).resolves.toEqual([]);
    }
    await expect(
      hybridSearchRanked({
        storeName: memoryEntriesStoreName(),
        userId: USER_ID,
        query: '对照',
        limit: 0,
      }),
    ).resolves.toEqual([]);
    expect(clients.embedding.embedTexts).not.toHaveBeenCalled();
    expect(clients.qdrant.queryPoints).not.toHaveBeenCalled();
    expect(clients.meili.search).not.toHaveBeenCalled();
    expect(clients.rerank.rerankTexts).not.toHaveBeenCalled();
  });

  it('adds payloadEquals to both filters and keeps the card recall limit', async () => {
    await hybridSearchRanked({
      storeName: memoryEntriesStoreName(),
      userId: USER_ID,
      query: ' 对照 ',
      limit: 8,
      payloadEquals: [{ key: 'collection_id', value: COLLECTION_ID }],
    });
    expect(clients.embedding.embedTexts).toHaveBeenCalledWith(['对照'], { userId: USER_ID });
    expect(clients.qdrant.queryPoints).toHaveBeenCalledWith(
      memoryEntriesStoreName(),
      [0.25, 0.5],
      {
        must: [
          { key: 'user_id', match: { value: USER_ID } },
          { key: 'collection_id', match: { value: COLLECTION_ID } },
        ],
      },
      RECALL,
    );
    expect(clients.meili.search).toHaveBeenCalledWith(memoryEntriesStoreName(), {
      q: '对照',
      filter: `user_id = '${USER_ID}' AND collection_id = '${COLLECTION_ID}'`,
      limit: RECALL,
    });
    expect(clients.rerank.rerankTexts).not.toHaveBeenCalled();
  });

  it('returns relevance_score when rerank succeeds', async () => {
    vi.mocked(clients.qdrant.queryPoints).mockResolvedValue([
      { id: 'a', score: 0.2, payload: { text: '甲' } },
      { id: 'b', score: 0.9, payload: { text: '乙' } },
    ]);
    vi.mocked(clients.rerank.rerankTexts).mockResolvedValue([
      { index: 1, score: 0.88 },
      { index: 0, score: 0.12 },
    ]);
    await expect(
      hybridSearchRanked({
        storeName: memoryCollectionsStoreName(),
        userId: USER_ID,
        query: '粒度',
        limit: 5,
      }),
    ).resolves.toEqual([
      { id: 'b', score: 0.88 },
      { id: 'a', score: 0.12 },
    ]);
  });

  it('keeps RRF order and null scores when rerank fails', async () => {
    // List order is the RRF order. b has the higher vector score and must not jump the queue.
    vi.mocked(clients.qdrant.queryPoints).mockResolvedValue([
      { id: 'a', score: 0.1, payload: { text: '甲' } },
      { id: 'b', score: 0.9, payload: { text: '乙' } },
    ]);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.mocked(clients.rerank.rerankTexts).mockRejectedValue(new Error('rerank down'));
    await expect(
      hybridSearchRanked({
        storeName: memoryCollectionsStoreName(),
        userId: USER_ID,
        query: '粒度',
        limit: 5,
      }),
    ).resolves.toEqual([
      { id: 'a', score: null },
      { id: 'b', score: null },
    ]);
    expect(warn).toHaveBeenCalledWith('retrieval.rerank.failed', expect.any(Error));
    warn.mockRestore();
  });
});

describe('searchCards', () => {
  it('still returns ids only and does not add payloadEquals', async () => {
    vi.mocked(clients.qdrant.queryPoints).mockResolvedValue([
      { id: 'card-b', score: 0.4, payload: { text: '乙', card_id: 'card-b' } },
      { id: 'card-a', score: 0.2, payload: { text: '甲', card_id: 'card-a' } },
    ]);
    vi.mocked(clients.rerank.rerankTexts).mockResolvedValue([{ index: 1, score: 0.7 }]);
    await expect(searchCards(USER_ID, '甲', 5, { topicId: TOPIC_ID })).resolves.toEqual(['card-a']);
    expect(clients.qdrant.queryPoints).toHaveBeenCalledWith(
      cardsStoreName(),
      [0.25, 0.5],
      {
        must: [
          { key: 'user_id', match: { value: USER_ID } },
          { key: 'topic_id', match: { value: TOPIC_ID } },
        ],
      },
      RECALL,
    );
    expect(clients.meili.search).toHaveBeenCalledWith(cardsStoreName(), {
      q: '甲',
      filter: `user_id = '${USER_ID}' AND topic_id = '${TOPIC_ID}'`,
      limit: RECALL,
    });
  });
});

describe('memory index', () => {
  it('upserts collection title and description, not entry bodies', async () => {
    await indexMemoryCollection({
      id: COLLECTION_ID,
      userId: USER_ID,
      title: '  切卡粒度  ',
      description: '\n例子与定义\n',
    });
    const text = '切卡粒度\n例子与定义';
    const payload = {
      collection_id: COLLECTION_ID,
      user_id: USER_ID,
      title: '切卡粒度',
      description: '例子与定义',
      text,
    };
    expect(clients.embedding.embedTexts).toHaveBeenCalledWith([text], { userId: USER_ID });
    expect(clients.qdrant.upsertPoints).toHaveBeenCalledWith(memoryCollectionsStoreName(), [
      { id: COLLECTION_ID, vector: [0.25, 0.5], payload },
    ]);
    expect(clients.meili.upsertDocuments).toHaveBeenCalledWith(memoryCollectionsStoreName(), [
      { id: COLLECTION_ID, ...payload },
    ]);
    expect(clients.qdrant.ensureCollection).toHaveBeenCalledWith(memoryCollectionsStoreName(), {
      payloadFields: ['user_id', 'collection_id'],
    });
    expect(clients.meili.ensureIndex).toHaveBeenCalledWith(
      memoryCollectionsStoreName(),
      MEMORY_COLLECTION_INDEX_SETTINGS,
    );
  });

  it('upserts entry text as collection title plus body', async () => {
    await indexMemoryEntry({
      id: ENTRY_ID,
      userId: USER_ID,
      collectionId: COLLECTION_ID,
      collectionTitle: ' 易混点 ',
      body: '  要对照旧卡  ',
    });
    const text = '易混点\n要对照旧卡';
    const payload = {
      entry_id: ENTRY_ID,
      collection_id: COLLECTION_ID,
      user_id: USER_ID,
      text,
    };
    expect(clients.embedding.embedTexts).toHaveBeenCalledWith([text], { userId: USER_ID });
    expect(clients.qdrant.upsertPoints).toHaveBeenCalledWith(memoryEntriesStoreName(), [
      { id: ENTRY_ID, vector: [0.25, 0.5], payload },
    ]);
    expect(clients.meili.upsertDocuments).toHaveBeenCalledWith(memoryEntriesStoreName(), [
      { id: ENTRY_ID, ...payload },
    ]);
    expect(clients.qdrant.ensureCollection).toHaveBeenCalledWith(memoryEntriesStoreName(), {
      payloadFields: ['user_id', 'entry_id', 'collection_id'],
    });
    expect(clients.meili.ensureIndex).toHaveBeenCalledWith(
      memoryEntriesStoreName(),
      MEMORY_ENTRY_INDEX_SETTINGS,
    );
  });

  it('deletes the point from both stores', async () => {
    await deleteMemoryCollectionFromIndex(COLLECTION_ID);
    await deleteMemoryEntryFromIndex(ENTRY_ID);
    expect(clients.qdrant.deletePoints).toHaveBeenCalledWith(memoryCollectionsStoreName(), [
      COLLECTION_ID,
    ]);
    expect(clients.meili.deleteDocuments).toHaveBeenCalledWith(memoryCollectionsStoreName(), [
      COLLECTION_ID,
    ]);
    expect(clients.qdrant.deletePoints).toHaveBeenCalledWith(memoryEntriesStoreName(), [ENTRY_ID]);
    expect(clients.meili.deleteDocuments).toHaveBeenCalledWith(memoryEntriesStoreName(), [ENTRY_ID]);
    expect(clients.embedding.embedTexts).not.toHaveBeenCalled();
  });
});
