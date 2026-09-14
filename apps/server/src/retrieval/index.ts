export { createEmbeddingClient, type EmbeddingClient } from './embedding.js';
export { RetrievalError } from './http.js';
export { createMeiliClient, type MeiliClient } from './meili.js';
export {
  cardEmbeddingText,
  deleteCard,
  indexCard,
  searchCards,
  type IndexableCard,
} from './pipeline.js';
export { createQdrantClient, type QdrantClient } from './qdrant.js';
export {
  cardsStoreName,
  ensureRetrievalStores,
  getRetrievalClients,
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
} from './registry.js';
export { createRerankClient, type RerankClient } from './rerank.js';
export { rrfMerge } from './rrf.js';
