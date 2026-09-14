import { logger } from '../utils/logger.js';
import { cardsStoreName, getRetrievalClients } from './registry.js';
import { rrfMerge } from './rrf.js';

export interface IndexableCard {
  id: string;
  userId: string;
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
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

function cardIdOf(id: string | number, source: Record<string, unknown>): string {
  const fromPayload = asString(source.card_id) ?? asString(source.cardId);
  if (fromPayload) return fromPayload;
  return String(id);
}

/** Index (or re-index) one card into Qdrant + Meili. */
export async function indexCard(card: IndexableCard): Promise<void> {
  const { embedding, qdrant, meili } = getRetrievalClients();
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
  const errors: unknown[] = [];
  try {
    await qdrant.upsertPoints(name, [{ id: card.id, vector, payload }]);
  } catch (err) {
    errors.push(err);
  }
  try {
    await meili.upsertDocuments(name, [
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
    ]);
  } catch (err) {
    errors.push(err);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'indexCard failed');
}

/** Remove one card from both indexes. */
export async function deleteCard(cardId: string): Promise<void> {
  const { qdrant, meili } = getRetrievalClients();
  const name = cardsStoreName();
  const errors: unknown[] = [];
  try {
    await qdrant.deletePoints(name, [cardId]);
  } catch (err) {
    errors.push(err);
  }
  try {
    await meili.deleteDocuments(name, [cardId]);
  } catch (err) {
    errors.push(err);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'deleteCard failed');
}

/**
 * Hybrid card search: Qdrant semantic ∪ Meili keyword, both filtered by user_id,
 * fused with RRF, then DashScope rerank. Returns card ids in rank order.
 */
export async function searchCards(userId: string, query: string, limit = 10): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed === '' || limit <= 0) return [];
  const { embedding, qdrant, meili, rerank } = getRetrievalClients();
  const name = cardsStoreName();
  const vectors = await embedding.embedTexts([trimmed], { userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) return [];

  const recall = Math.max(limit, RECALL_LIMIT);
  const [scored, hits] = await Promise.all([
    qdrant.queryPoints(
      name,
      vector,
      { must: [{ key: 'user_id', match: { value: userId } }] },
      recall,
    ),
    meili.search(name, {
      q: trimmed,
      filter: `user_id = '${escapeMeiliValue(userId)}'`,
      limit: recall,
    }),
  ]);

  const merged = rrfMerge([
    scored.map((point) => cardIdOf(point.id, point.payload)),
    hits.map((hit) => cardIdOf(typeof hit.id === 'string' || typeof hit.id === 'number' ? hit.id : '', hit)),
  ]).slice(0, recall);
  if (merged.length === 0) return [];

  const textById = new Map<string, string>();
  const collect = (id: string, source: Record<string, unknown>): void => {
    if (textById.has(id)) return;
    const text = payloadText(source);
    if (text) textById.set(id, text);
  };
  for (const point of scored) collect(cardIdOf(point.id, point.payload), point.payload);
  for (const hit of hits) {
    collect(cardIdOf(typeof hit.id === 'string' || typeof hit.id === 'number' ? hit.id : '', hit), hit);
  }

  const candidates = merged.filter((id) => textById.has(id));
  if (candidates.length === 0) return merged.slice(0, limit);

  try {
    const ranked = await rerank.rerankTexts(
      trimmed,
      candidates.map((id) => textById.get(id) ?? ''),
      limit,
      { userId },
    );
    const results: string[] = [];
    for (const { index } of ranked) {
      const id = candidates[index];
      if (id) results.push(id);
    }
    if (results.length > 0) return results.slice(0, limit);
  } catch (err) {
    logger.warn('retrieval.rerank.failed', err);
  }
  return candidates.slice(0, limit);
}
