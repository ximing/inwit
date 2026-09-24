import type { AnnotationKind } from '@inwit/dto';
import { documentPlainText } from '../documents/content-json.js';
import { logger } from '../utils/logger.js';
import {
  annotationsStoreName,
  cardsStoreName,
  docsStoreName,
  ensureRetrievalStores,
  getRetrievalClients,
} from './registry.js';
import {
  collectionEmbeddingText,
  entryEmbeddingText,
  memoryCollectionsStoreName,
  memoryEntriesStoreName,
} from './memory-index-logic.js';
import { rrfMerge } from './rrf.js';
import {
  ANNOTATION_QUOTE_CHARS,
  annotationEmbeddingText,
  annotationIndexableQuote,
  clipChars,
  documentEmbeddingText,
  meiliScopeFilter,
  qdrantScopeFilter,
  type PayloadEqual,
} from './search-logic.js';

export { annotationEmbeddingText, documentEmbeddingText } from './search-logic.js';

export interface IndexableCard {
  id: string;
  userId: string;
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
  topicId?: string | null;
}

export interface IndexableDocument {
  id: string;
  userId: string;
  title: string | null;
  description: string | null;
  contentJson: unknown;
  topicId?: string | null;
}

export interface IndexableAnnotation {
  id: string;
  userId: string;
  documentId: string;
  kind: AnnotationKind;
  quote: string;
  note: string;
}

export type HybridSearchOptions = {
  topicId?: string | undefined;
  filterIds?: ((ids: string[]) => Promise<string[]>) | undefined;
};

const RECALL_LIMIT = 20;
const ANNOTATION_NOTE_CHARS = 500;

export function cardEmbeddingText(card: Pick<IndexableCard, 'concept' | 'example' | 'confusionPoint'>): string {
  return `${card.concept}\n${card.example}\n${card.confusionPoint}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function topicIdPayload(topicId: string | null | undefined): string {
  return topicId ?? '';
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
  const content = asString(source.content_text) ?? asString(source.contentText) ?? '';
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

function annotationIdOf(id: string | number, source: Record<string, unknown>): string {
  const fromPayload = asString(source.annotation_id) ?? asString(source.annotationId);
  if (fromPayload) return fromPayload;
  return String(id);
}

function annotationPayloadText(source: Record<string, unknown>): string | null {
  const stored = asString(source.text);
  if (stored && stored.trim() !== '') return stored;
  const note = asString(source.note) ?? '';
  const quote = asString(source.quote) ?? '';
  const joined = `${note}\n${quote}`.trim();
  return joined === '' ? null : joined;
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
    topic_id: topicIdPayload(card.topicId),
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
      topic_id: topicIdPayload(card.topicId),
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
export async function deleteCardFromIndex(cardId: string): Promise<void> {
  await deleteBoth(cardsStoreName(), cardId, 'deleteCardFromIndex');
}

/** Index (or re-index) one document into Qdrant + Meili. */
export async function indexDocument(doc: IndexableDocument): Promise<void> {
  await ensureRetrievalStores();
  const contentText = documentPlainText(doc.contentJson);
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
    topic_id: topicIdPayload(doc.topicId),
    title: doc.title ?? '',
    description: doc.description ?? '',
    content_text: contentText,
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
      topic_id: topicIdPayload(doc.topicId),
      title: doc.title ?? '',
      description: doc.description ?? '',
      content_text: contentText,
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

function annotationDoc(a: IndexableAnnotation, text: string): Record<string, unknown> {
  return {
    id: a.id,
    annotation_id: a.id,
    user_id: a.userId,
    doc_id: a.documentId,
    kind: a.kind,
    note: clipChars(a.note, ANNOTATION_NOTE_CHARS),
    quote: annotationIndexableQuote(a.quote, ANNOTATION_QUOTE_CHARS),
    text,
  };
}

/**
 * Index (or re-index) one annotation. When there is no semantic text (empty
 * note + placeholder quote), the annotation goes to Meili only — keyword
 * search still works and no embedding call is spent on a placeholder.
 */
export async function indexAnnotation(a: IndexableAnnotation): Promise<void> {
  await ensureRetrievalStores();
  const name = annotationsStoreName();
  const text = annotationEmbeddingText(a);
  const doc = annotationDoc(a, text);
  if (text === '') {
    const { qdrant, meili } = getRetrievalClients();
    await Promise.all([
      qdrant.deletePoints(name, [a.id]).catch(() => undefined),
      meili.upsertDocuments(name, [doc]),
    ]);
    return;
  }
  const { embedding } = getRetrievalClients();
  const vectors = await embedding.embedTexts([text], { userId: a.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) {
    throw new Error('embedding returned no vector for annotation content');
  }
  await upsertBoth(name, a.id, vector, doc, doc, 'indexAnnotation');
}

/** Remove one annotation from both indexes. */
export async function deleteAnnotationFromIndex(annotationId: string): Promise<void> {
  await ensureRetrievalStores();
  await deleteBoth(annotationsStoreName(), annotationId, 'deleteAnnotationFromIndex');
}

/** Failures are logged; callers keep the main write path. */
export async function tryIndexAnnotation(a: IndexableAnnotation): Promise<void> {
  try {
    await indexAnnotation(a);
  } catch (err) {
    logger.warn('retrieval.index_annotation_failed', {
      annotationId: a.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function tryDeleteAnnotationFromIndex(annotationId: string): Promise<void> {
  try {
    await deleteAnnotationFromIndex(annotationId);
  } catch (err) {
    logger.warn('retrieval.delete_annotation_failed', {
      annotationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

/** Warn-only card indexing for user-facing write paths (manual card creation). */
export async function tryIndexCard(card: IndexableCard): Promise<void> {
  try {
    await indexCard(card);
  } catch (err) {
    logger.warn('retrieval.index_card_failed', {
      cardId: card.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function tryDeleteCardFromIndex(cardId: string): Promise<void> {
  try {
    await deleteCardFromIndex(cardId);
  } catch (err) {
    logger.warn('retrieval.delete_card_failed', {
      cardId,
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

export interface IndexableMemoryCollection {
  id: string;
  userId: string;
  title: string;
  description: string;
}

export interface IndexableMemoryEntry {
  id: string;
  userId: string;
  collectionId: string;
  collectionTitle: string;
  body: string;
}

/** Index one collection. Callers skip retired rows; this upsert does not check status. */
export async function indexMemoryCollection(collection: IndexableMemoryCollection): Promise<void> {
  await ensureRetrievalStores();
  const { embedding } = getRetrievalClients();
  const name = memoryCollectionsStoreName();
  const title = collection.title.trim();
  const description = collection.description.trim();
  const text = collectionEmbeddingText(title, description);
  const vectors = await embedding.embedTexts([text], { userId: collection.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) {
    throw new Error('embedding returned no vector for memory collection');
  }
  const payload = {
    collection_id: collection.id,
    user_id: collection.userId,
    title,
    description,
    text,
  };
  await upsertBoth(
    name,
    collection.id,
    vector,
    payload,
    { id: collection.id, ...payload },
    'indexMemoryCollection',
  );
}

/** Remove one collection point from Qdrant and Meili. */
export async function deleteMemoryCollectionFromIndex(collectionId: string): Promise<void> {
  await ensureRetrievalStores();
  await deleteBoth(memoryCollectionsStoreName(), collectionId, 'deleteMemoryCollectionFromIndex');
}

/** Index one entry. Callers skip retired rows; this upsert does not check status. */
export async function indexMemoryEntry(entry: IndexableMemoryEntry): Promise<void> {
  await ensureRetrievalStores();
  const { embedding } = getRetrievalClients();
  const name = memoryEntriesStoreName();
  const text = entryEmbeddingText(entry.collectionTitle, entry.body);
  const vectors = await embedding.embedTexts([text], { userId: entry.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) {
    throw new Error('embedding returned no vector for memory entry');
  }
  const payload = {
    entry_id: entry.id,
    collection_id: entry.collectionId,
    user_id: entry.userId,
    text,
  };
  await upsertBoth(
    name,
    entry.id,
    vector,
    payload,
    { id: entry.id, ...payload },
    'indexMemoryEntry',
  );
}

/** Remove one entry point from Qdrant and Meili. */
export async function deleteMemoryEntryFromIndex(entryId: string): Promise<void> {
  await ensureRetrievalStores();
  await deleteBoth(memoryEntriesStoreName(), entryId, 'deleteMemoryEntryFromIndex');
}

/**
 * `score` is the reranker relevance_score. Null when rerank did not produce an order
 * (failure, or no rerank text); the order is then today's RRF candidate truncation.
 */
export interface RankedSearchHit {
  id: string;
  score: number | null;
}

type HitId = (id: string | number, source: Record<string, unknown>) => string;
type HitText = (source: Record<string, unknown>) => string | null;

interface HybridSearchInput {
  storeName: string;
  userId: string;
  query: string;
  limit: number;
  topicId?: string | undefined;
  payloadEquals?: readonly PayloadEqual[] | undefined;
  filterIds?: ((ids: string[]) => Promise<string[]>) | undefined;
  idOf: HitId;
  textOf: HitText;
}

function storedPayloadText(source: Record<string, unknown>): string | null {
  const stored = asString(source.text);
  if (stored && stored.trim() !== '') return stored;
  return null;
}

function hitKey(id: unknown, source: Record<string, unknown>, idOf: HitId): string {
  return idOf(typeof id === 'string' || typeof id === 'number' ? id : '', source);
}

async function hybridSearchRankedHits(input: HybridSearchInput): Promise<RankedSearchHit[]> {
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
      qdrantScopeFilter(input.userId, input.topicId, input.payloadEquals),
      recall,
    ),
    meili.search(input.storeName, {
      q: trimmed,
      filter: meiliScopeFilter(input.userId, input.topicId, input.payloadEquals),
      limit: recall,
    }),
  ]);

  let merged = rrfMerge([
    scored.map((point) => input.idOf(point.id, point.payload)),
    hits.map((hit) => hitKey(hit.id, hit, input.idOf)),
  ]).slice(0, recall);
  if (input.filterIds && merged.length > 0) {
    merged = await input.filterIds(merged);
  }
  if (merged.length === 0) return [];

  const textById = new Map<string, string>();
  const collect = (id: string, source: Record<string, unknown>): void => {
    if (textById.has(id)) return;
    const text = input.textOf(source);
    if (text) textById.set(id, text);
  };
  for (const point of scored) collect(input.idOf(point.id, point.payload), point.payload);
  for (const hit of hits) collect(hitKey(hit.id, hit, input.idOf), hit);

  const candidates = merged.filter((id) => textById.has(id));
  if (candidates.length === 0) {
    return merged.slice(0, input.limit).map((id) => ({ id, score: null }));
  }

  try {
    const ranked = await rerank.rerankTexts(
      trimmed,
      candidates.map((id) => textById.get(id) ?? ''),
      input.limit,
      { userId: input.userId },
    );
    const results: RankedSearchHit[] = [];
    for (const { index, score } of ranked) {
      const id = candidates[index];
      if (id) results.push({ id, score });
    }
    if (results.length > 0) return results.slice(0, input.limit);
  } catch (err) {
    logger.warn('retrieval.rerank.failed', err);
  }
  return candidates.slice(0, input.limit).map((id) => ({ id, score: null }));
}

async function hybridSearchIds(input: HybridSearchInput): Promise<string[]> {
  const ranked = await hybridSearchRankedHits(input);
  return ranked.map((hit) => hit.id);
}

/**
 * Same recall as card search (embed, Qdrant + Meili, RRF, rerank).
 * `payloadEquals` is ANDed onto both filters; card, document, and annotation search omit it.
 * Point id is the hit id unless `idOf` is set.
 */
export async function hybridSearchRanked(input: {
  storeName: string;
  userId: string;
  query: string;
  limit: number;
  topicId?: string | undefined;
  payloadEquals?: readonly PayloadEqual[] | undefined;
  filterIds?: ((ids: string[]) => Promise<string[]>) | undefined;
  idOf?: HitId | undefined;
  textOf?: HitText | undefined;
}): Promise<RankedSearchHit[]> {
  return hybridSearchRankedHits({
    storeName: input.storeName,
    userId: input.userId,
    query: input.query,
    limit: input.limit,
    topicId: input.topicId,
    payloadEquals: input.payloadEquals,
    filterIds: input.filterIds,
    idOf: input.idOf ?? ((id) => String(id)),
    textOf: input.textOf ?? storedPayloadText,
  });
}

/**
 * Hybrid card search: Qdrant semantic ∪ Meili keyword, both filtered by user_id
 * (and optional topic_id), fused with RRF, then DashScope rerank.
 * Returns card ids in rank order.
 */
export async function searchCards(
  userId: string,
  query: string,
  limit = 10,
  options?: HybridSearchOptions,
): Promise<string[]> {
  return hybridSearchIds({
    storeName: cardsStoreName(),
    userId,
    query,
    limit,
    topicId: options?.topicId,
    filterIds: options?.filterIds,
    idOf: cardIdOf,
    textOf: payloadText,
  });
}

/**
 * Hybrid document search: same dual-path → RRF → rerank as cards.
 * Rerank text is title + description + content head (stored as `text`).
 */
export async function searchDocuments(
  userId: string,
  query: string,
  limit = 8,
  options?: HybridSearchOptions,
): Promise<string[]> {
  await ensureRetrievalStores();
  return hybridSearchIds({
    storeName: docsStoreName(),
    userId,
    query,
    limit,
    topicId: options?.topicId,
    filterIds: options?.filterIds,
    idOf: docIdOf,
    textOf: documentPayloadText,
  });
}

/**
 * Hybrid annotation search: same dual-path → RRF → rerank.
 * topicId scoping relies on `filterIds` (DB join) only — the annotation
 * payload carries no topic_id, so an index-side topic filter would match
 * nothing, and the payload never goes stale when a document changes topic.
 */
export async function searchAnnotations(
  userId: string,
  query: string,
  limit = 8,
  options?: HybridSearchOptions,
): Promise<string[]> {
  await ensureRetrievalStores();
  return hybridSearchIds({
    storeName: annotationsStoreName(),
    userId,
    query,
    limit,
    filterIds: options?.filterIds,
    idOf: annotationIdOf,
    textOf: annotationPayloadText,
  });
}
