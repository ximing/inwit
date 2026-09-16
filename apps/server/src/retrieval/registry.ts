import { config } from '../config.js';
import { createEmbeddingClient, type EmbeddingClient } from './embedding.js';
import {
  CARD_INDEX_SETTINGS,
  createMeiliClient,
  DOCS_INDEX_SETTINGS,
  type MeiliClient,
} from './meili.js';
import { createQdrantClient, type QdrantClient } from './qdrant.js';
import { createRerankClient, type RerankClient } from './rerank.js';

export type { EmbeddingClient } from './embedding.js';
export type { MeiliClient } from './meili.js';
export type { QdrantClient, QdrantPoint, QdrantScoredPoint } from './qdrant.js';
export type { RerankClient, RerankResult } from './rerank.js';

export interface RetrievalClients {
  embedding: EmbeddingClient;
  rerank: RerankClient;
  qdrant: QdrantClient;
  meili: MeiliClient;
}

export function cardsStoreName(): string {
  return config.NODE_ENV === 'production' ? 'inwit_cards_prod' : 'inwit_cards_dev';
}

export function docsStoreName(): string {
  return config.NODE_ENV === 'production' ? 'inwit_docs_prod' : 'inwit_docs_dev';
}

function buildClients(): RetrievalClients {
  return {
    embedding: createEmbeddingClient({
      apiKey: config.DASHSCOPE_API_KEY,
      baseUrl: config.DASHSCOPE_BASE_URL,
      model: config.EMBEDDING_MODEL,
      dimensions: config.EMBEDDING_DIMENSIONS,
    }),
    rerank: createRerankClient({
      apiKey: config.DASHSCOPE_API_KEY,
      baseUrl: config.DASHSCOPE_BASE_URL,
      model: config.RERANK_MODEL,
    }),
    qdrant: createQdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
      vectorSize: config.EMBEDDING_DIMENSIONS,
    }),
    meili: createMeiliClient({
      url: config.MEILI_HOST,
      apiKey: config.MEILI_API_KEY,
    }),
  };
}

let cached: RetrievalClients | null = null;
let testOverride: Partial<RetrievalClients> | null = null;
let storesReady: Promise<void> | null = null;

export function getRetrievalClients(): RetrievalClients {
  cached ??= buildClients();
  return testOverride ? { ...cached, ...testOverride } : cached;
}

/** Test seam. Do not call from product code. */
export function setRetrievalClientsForTest(clients: Partial<RetrievalClients>): void {
  testOverride = clients;
  storesReady = null;
}

/** Test seam. Do not call from product code. */
export function resetRetrievalClientsForTest(): void {
  testOverride = null;
  cached = null;
  storesReady = null;
}

export async function ensureRetrievalStores(): Promise<void> {
  storesReady ??= (async () => {
    const { qdrant, meili } = getRetrievalClients();
    const cards = cardsStoreName();
    const docs = docsStoreName();
    await Promise.all([
      qdrant.ensureCollection(cards, { payloadFields: ['user_id', 'card_id'] }),
      qdrant.ensureCollection(docs, { payloadFields: ['user_id', 'doc_id'] }),
      meili.ensureIndex(cards, CARD_INDEX_SETTINGS),
      meili.ensureIndex(docs, DOCS_INDEX_SETTINGS),
    ]);
  })().catch((err: unknown) => {
    storesReady = null;
    throw err;
  });
  return storesReady;
}
