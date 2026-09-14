import { config } from '../config.js';
import { createEmbeddingClient, type EmbeddingClient } from './embedding.js';
import { createMeiliClient, type MeiliClient } from './meili.js';
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

export function getRetrievalClients(): RetrievalClients {
  cached ??= buildClients();
  return testOverride ? { ...cached, ...testOverride } : cached;
}

/** Test seam. Do not call from product code. */
export function setRetrievalClientsForTest(clients: Partial<RetrievalClients>): void {
  testOverride = clients;
}

/** Test seam. Do not call from product code. */
export function resetRetrievalClientsForTest(): void {
  testOverride = null;
  cached = null;
}

export async function ensureRetrievalStores(): Promise<void> {
  const { qdrant, meili } = getRetrievalClients();
  const name = cardsStoreName();
  await Promise.all([qdrant.ensureCollection(name), meili.ensureIndex(name)]);
}
