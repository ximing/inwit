export { createEmbeddingClient, type EmbeddingClient } from './embedding.js';
export { RetrievalError } from './http.js';
export { createMeiliClient, type MeiliClient } from './meili.js';
export {
  cardEmbeddingText,
  deleteCard,
  deleteDocumentFromIndex,
  documentEmbeddingText,
  indexCard,
  indexDocument,
  searchCards,
  searchDocuments,
  tryDeleteDocumentFromIndex,
  tryIndexDocument,
  type IndexableCard,
  type IndexableDocument,
} from './pipeline.js';
export { createQdrantClient, type QdrantClient } from './qdrant.js';
export {
  cardsStoreName,
  docsStoreName,
  ensureRetrievalStores,
  getRetrievalClients,
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
} from './registry.js';
export { ilikeContainsPattern, orderByIds, withSearchFallback } from './search-logic.js';
export { createRerankClient, type RerankClient } from './rerank.js';
export { rrfMerge } from './rrf.js';
