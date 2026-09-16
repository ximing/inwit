import {
  docDisplayTitle,
  type DocumentListItem,
  type SearchCard,
  type SearchQuery,
  type SearchResult,
} from '@inwit/dto';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { toPublicCardBase } from '../cards/card.mapper.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { cards, documents } from '../db/schema.js';
import { getDocumentListItemsByIds } from '../documents/document.service.js';
import { searchCards, searchDocuments } from '../retrieval/pipeline.js';
import {
  ilikeContainsPattern,
  intersectOrdered,
  orderByIds,
  withSearchFallback,
} from '../retrieval/search-logic.js';
import { logger } from '../utils/logger.js';

function topicEq(
  column: typeof documents.topicId | typeof cards.topicId,
  topicId?: string,
): SQL | undefined {
  return topicId ? eq(column, topicId) : undefined;
}

async function searchDocumentIdsIlike(
  userId: string,
  query: string,
  limit: number,
  topicId?: string,
): Promise<string[]> {
  const pattern = ilikeContainsPattern(query);
  const rows = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        topicEq(documents.topicId, topicId),
        or(
          ilike(documents.title, pattern),
          ilike(documents.description, pattern),
          sql`${documents.contentJson}::text ilike ${pattern}`,
        ),
      ),
    )
    .orderBy(desc(documents.updatedAt), desc(documents.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function searchCardIdsIlike(
  userId: string,
  query: string,
  limit: number,
  topicId?: string,
): Promise<string[]> {
  const pattern = ilikeContainsPattern(query);
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        topicEq(cards.topicId, topicId),
        or(ilike(cards.concept, pattern), ilike(cards.example, pattern), ilike(cards.confusionPoint, pattern)),
      ),
    )
    .orderBy(desc(cards.updatedAt), desc(cards.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function idsInTopic(
  kind: 'documents' | 'cards',
  userId: string,
  ids: string[],
  topicId: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const table = kind === 'documents' ? documents : cards;
  const rows = await getDb()
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.topicId, topicId), inArray(table.id, ids)));
  return intersectOrdered(ids, new Set(rows.map((row) => row.id)));
}

async function loadCardsByIds(userId: string, ids: string[]): Promise<SearchCard[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({
      card: cards,
      docTitle: documents.title,
      docDescription: documents.description,
    })
    .from(cards)
    .leftJoin(documents, eq(documents.id, cards.documentId))
    .where(and(eq(cards.userId, userId), inArray(cards.id, ids)));
  const byId = new Map(rows.map((row) => [row.card.id, row]));
  const ordered: SearchCard[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    ordered.push({
      ...toPublicCardBase(row.card),
      documentTitle: row.card.documentId
        ? docDisplayTitle({ title: row.docTitle, description: row.docDescription })
        : null,
    });
  }
  return ordered;
}

async function loadDocumentsByIds(userId: string, ids: string[]): Promise<DocumentListItem[]> {
  return orderByIds(ids, await getDocumentListItemsByIds(userId, ids));
}

function fallbackOpts(scope: string) {
  return {
    forceFallback: config.INWIT_SEARCH_FALLBACK,
    onFallback: (err: unknown) => {
      logger.warn(`search.${scope}.hybrid_failed`, err);
    },
  };
}

async function retrieveSearchIds(
  hybrid: () => Promise<string[]>,
  fallback: () => Promise<string[]>,
  scope: string,
  fallbackIfEmpty: boolean,
): Promise<string[]> {
  const ids = await withSearchFallback(hybrid, fallback, fallbackOpts(scope));
  if (fallbackIfEmpty && ids.length === 0) return fallback();
  return ids;
}

export async function search(userId: string, query: SearchQuery): Promise<SearchResult> {
  const { q, limit, topicId } = query;
  const scoped = Boolean(topicId);
  const docScope = topicId
    ? { topicId, filterIds: (ids: string[]) => idsInTopic('documents', userId, ids, topicId) }
    : undefined;
  const cardScope = topicId
    ? { topicId, filterIds: (ids: string[]) => idsInTopic('cards', userId, ids, topicId) }
    : undefined;
  const [documentIds, cardIds] = await Promise.all([
    retrieveSearchIds(
      () => searchDocuments(userId, q, limit, docScope),
      () => searchDocumentIdsIlike(userId, q, limit, topicId),
      'documents',
      scoped,
    ),
    retrieveSearchIds(
      () => searchCards(userId, q, limit, cardScope),
      () => searchCardIdsIlike(userId, q, limit, topicId),
      'cards',
      scoped,
    ),
  ]);

  const [docs, cardRows] = await Promise.all([
    loadDocumentsByIds(userId, documentIds),
    loadCardsByIds(userId, cardIds),
  ]);
  return { documents: docs, cards: cardRows };
}
