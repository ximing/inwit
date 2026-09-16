import {
  docDisplayTitle,
  type DocumentListItem,
  type SearchCard,
  type SearchQuery,
  type SearchResult,
} from '@inwit/dto';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { toPublicCardBase } from '../cards/card.mapper.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { cards, documents } from '../db/schema.js';
import { getDocumentListItemsByIds } from '../documents/document.service.js';
import { searchCards, searchDocuments } from '../retrieval/pipeline.js';
import { ilikeContainsPattern, orderByIds, withSearchFallback } from '../retrieval/search-logic.js';
import { logger } from '../utils/logger.js';

async function searchDocumentIdsIlike(userId: string, query: string, limit: number): Promise<string[]> {
  const pattern = ilikeContainsPattern(query);
  const rows = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        or(
          ilike(documents.title, pattern),
          ilike(documents.description, pattern),
          ilike(documents.contentMd, pattern),
        ),
      ),
    )
    .orderBy(desc(documents.updatedAt), desc(documents.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function searchCardIdsIlike(userId: string, query: string, limit: number): Promise<string[]> {
  const pattern = ilikeContainsPattern(query);
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        or(ilike(cards.concept, pattern), ilike(cards.example, pattern), ilike(cards.confusionPoint, pattern)),
      ),
    )
    .orderBy(desc(cards.updatedAt), desc(cards.id))
    .limit(limit);
  return rows.map((row) => row.id);
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

export async function search(userId: string, query: SearchQuery): Promise<SearchResult> {
  const { q, limit } = query;
  const [documentIds, cardIds] = await Promise.all([
    withSearchFallback(
      () => searchDocuments(userId, q, limit),
      () => searchDocumentIdsIlike(userId, q, limit),
      fallbackOpts('documents'),
    ),
    withSearchFallback(
      () => searchCards(userId, q, limit),
      () => searchCardIdsIlike(userId, q, limit),
      fallbackOpts('cards'),
    ),
  ]);

  const [docs, cardRows] = await Promise.all([
    loadDocumentsByIds(userId, documentIds),
    loadCardsByIds(userId, cardIds),
  ]);
  return { documents: docs, cards: cardRows };
}
