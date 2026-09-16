import { logger } from '../utils/logger.js';
import { cardsStoreName, docsStoreName, ensureRetrievalStores, getRetrievalClients } from './registry.js';
import { rrfMerge } from './rrf.js';
import { documentEmbeddingText } from './search-logic.js';

export { documentEmbeddingText } from './search-logic.js';

export interface IndexableCard {
  id: string;
  userId: string;
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
}

export interface IndexableDocument {
  id: string;
  userId: string;
  title: string | null;
  description: string | null;
  contentMd: string;
}

const RECALL_LIMIT = 20;

export function cardEmbeddingText(card: Pick<IndexableCard, 'concept' | 'example' | 'confusionPoint'>): string {
  return `${card.concept}\n${card.example}\n${card.confusionPoint}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function escapeMeiliValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function payloadText(source: Record<string, unknown>): string | null {
  const stored = asString(source.text);
  if (stored && stored.trim() !== '') return stored;
  const concept = asString(source.concept) ?? '';
  const example = asString(source.example) ?? '';
  const confusion = asString(source.confusion_point) ?? asString(source.confusionPoint) ?? '';
  const joined = `${concept}\n${example}\n${confusion}`.trim();
  return joined === '' ? null : joined;
}

function documentPayloadText(source: Record<string, unknown>): string | null {
  const stored = asString(source.text);
  if (stored && stored.trim() !== '') return stored;
  const title = asString(source.title) ?? '';
  const description = asString(source.description) ?? '';
  const content = asString(source.content_md) ?? asString(source.contentMd) ?? '';
  const joined = `${title}\n${description}\n${content}`.trim();
  return joined === '' ? null : joined;
}

function cardIdOf(id: string | number, source: Record<string, unknown>): string {
  const fromPayload = asString(source.card_id) ?? asString(source.cardId);
  if (fromPayload) return fromPayload;
  return String(id);
}

function docIdOf(id: string | number, source: Record<string, unknown>): string {
  const fromPayload = asString(source.doc_id) ?? asString(source.docId);
  if (fromPayload) return fromPayload;
  return String(id);
}

async function upsertBoth(
  name: string,
  id: string,
  vector: number[],
  payload: Record<string, unknown>,
  meiliDoc: Record<string, unknown>,
  label: string,
): Promise<void> {
  const { qdrant, meili } = getRetrievalClients();
  const errors: unknown[] = [];
  try {
    await qdrant.upsertPoints(name, [{ id, vector, payload }]);
  } catch (err) {
    errors.push(err);
  }
  try {
    await meili.upsertDocuments(name, [meiliDoc]);
  } catch (err) {
    errors.push(err);
  }
  if (errors.length > 0) throw new AggregateError(errors, `${label} failed`);
}

async function deleteBoth(name: string, id: string, label: string): Promise<void> {
  const { qdrant, meili } = getRetrievalClients();
  const errors: unknown[] = [];
  try {
    await qdrant.deletePoints(name, [id]);
  } catch (err) {
    errors.push(err);
  }
  try {
    await meili.deleteDocuments(name, [id]);
  } catch (err) {
    errors.push(err);
  }
  if (errors.length > 0) throw new AggregateError(errors, `${label} failed`);
}

/** Index (or re-index) one card into Qdrant + Meili. */
export async function indexCard(card: IndexableCard): Promise<void> {
  const { embedding } = getRetrievalClients();
  const name = cardsStoreName();
  const text = cardEmbeddingText(card);
  const vectors = await embedding.embedTexts([text], { userId: card.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) {
    throw new Error('embedding returned no vector for card content');
  }
  const payload = {
    card_id: card.id,
    user_id: card.userId,
    tags: card.tags,
    concept: card.concept,
    example: card.example,
    confusion_point: card.confusionPoint,
    text,
  };
  await upsertBoth(
    name,
    card.id,
    vector,
    payload,
    {
      id: card.id,
      card_id: card.id,
      user_id: card.userId,
      tags: card.tags,
      concept: card.concept,
      example: card.example,
      confusion_point: card.confusionPoint,
      text,
    },
    'indexCard',
  );
}

/** Remove one card from both indexes. */
export async function deleteCard(cardId: string): Promise<void> {
  await deleteBoth(cardsStoreName(), cardId, 'deleteCard');
}

/** Index (or re-index) one document into Qdrant + Meili. */
export async function indexDocument(doc: IndexableDocument): Promise<void> {
  await ensureRetrievalStores();
  const text = documentEmbeddingText(doc);
  if (text.trim() === '') {
    await deleteDocumentFromIndex(doc.id);
    return;
  }
  const { embedding } = getRetrievalClients();
  const name = docsStoreName();
  const vectors = await embedding.embedTexts([text], { userId: doc.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) {
    throw new Error('embedding returned no vector for document content');
  }
  const payload = {
    doc_id: doc.id,
    user_id: doc.userId,
    title: doc.title ?? '',
    description: doc.description ?? '',
    content_md: doc.contentMd,
    text,
  };
  await upsertBoth(
    name,
    doc.id,
    vector,
    payload,
    {
      id: doc.id,
      doc_id: doc.id,
      user_id: doc.userId,
      title: doc.title ?? '',
      description: doc.description ?? '',
      content_md: doc.contentMd,
      text,
    },
    'indexDocument',
  );
}

/** Remove one document from both indexes. */
export async function deleteDocumentFromIndex(documentId: string): Promise<void> {
  await ensureRetrievalStores();
  await deleteBoth(docsStoreName(), documentId, 'deleteDocumentFromIndex');
}

/** Failures are logged; callers keep the main write path. */
export async function tryIndexDocument(doc: IndexableDocument): Promise<void> {
  try {
    await indexDocument(doc);
  } catch (err) {
    logger.warn('retrieval.index_document_failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function tryDeleteDocumentFromIndex(documentId: string): Promise<void> {
  try {
    await deleteDocumentFromIndex(documentId);
  } catch (err) {
    logger.warn('retrieval.delete_document_failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function hybridSearchIds(input: {
  storeName: string;
  userId: string;
  query: string;
  limit: number;
  idOf: (id: string | number, source: Record<string, unknown>) => string;
  textOf: (source: Record<string, unknown>) => string | null;
}): Promise<string[]> {
  const trimmed = input.query.trim();
  if (trimmed === '' || input.limit <= 0) return [];
  const { embedding, qdrant, meili, rerank } = getRetrievalClients();
  const vectors = await embedding.embedTexts([trimmed], { userId: input.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) return [];

  const recall = Math.max(input.limit, RECALL_LIMIT);
  const [scored, hits] = await Promise.all([
    qdrant.queryPoints(
      input.storeName,
      vector,
      { must: [{ key: 'user_id', match: { value: input.userId } }] },
      recall,
    ),
    meili.search(input.storeName, {
      q: trimmed,
      filter: `user_id = '${escapeMeiliValue(input.userId)}'`,
      limit: recall,
    }),
  ]);

  const merged = rrfMerge([
    scored.map((point) => input.idOf(point.id, point.payload)),
    hits.map((hit) =>
      input.idOf(typeof hit.id === 'string' || typeof hit.id === 'number' ? hit.id : '', hit),
    ),
  ]).slice(0, recall);
  if (merged.length === 0) return [];

  const textById = new Map<string, string>();
  const collect = (id: string, source: Record<string, unknown>): void => {
    if (textById.has(id)) return;
    const text = input.textOf(source);
    if (text) textById.set(id, text);
  };
  for (const point of scored) collect(input.idOf(point.id, point.payload), point.payload);
  for (const hit of hits) {
    collect(
      input.idOf(typeof hit.id === 'string' || typeof hit.id === 'number' ? hit.id : '', hit),
      hit,
    );
  }

  const candidates = merged.filter((id) => textById.has(id));
  if (candidates.length === 0) return merged.slice(0, input.limit);

  try {
    const ranked = await rerank.rerankTexts(
      trimmed,
      candidates.map((id) => textById.get(id) ?? ''),
      input.limit,
      { userId: input.userId },
    );
    const results: string[] = [];
    for (const { index } of ranked) {
      const id = candidates[index];
      if (id) results.push(id);
    }
    if (results.length > 0) return results.slice(0, input.limit);
  } catch (err) {
    logger.warn('retrieval.rerank.failed', err);
  }
  return candidates.slice(0, input.limit);
}

/**
 * Hybrid card search: Qdrant semantic ∪ Meili keyword, both filtered by user_id,
 * fused with RRF, then DashScope rerank. Returns card ids in rank order.
 */
export async function searchCards(userId: string, query: string, limit = 10): Promise<string[]> {
  return hybridSearchIds({
    storeName: cardsStoreName(),
    userId,
    query,
    limit,
    idOf: cardIdOf,
    textOf: payloadText,
  });
}

/**
 * Hybrid document search: same dual-path → RRF → rerank as cards.
 * Rerank text is title + description + content head (stored as `text`).
 */
export async function searchDocuments(userId: string, query: string, limit = 8): Promise<string[]> {
  await ensureRetrievalStores();
  return hybridSearchIds({
    storeName: docsStoreName(),
    userId,
    query,
    limit,
    idOf: docIdOf,
    textOf: documentPayloadText,
  });
}
