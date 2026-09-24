import {
  docDisplayTitle,
  type DocumentListItem,
  type SearchAnnotation,
  type SearchCard,
  type SearchQuery,
  type SearchResult,
} from '@inwit/dto';
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { acceptedCard } from '../cards/accepted-card.js';
import { toPublicCardBase } from '../cards/card.mapper.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { annotations, cards, documents } from '../db/schema.js';
import { getDocumentListItemsByIds } from '../documents/document.service.js';
import { searchAnnotations, searchCards, searchDocuments } from '../retrieval/pipeline.js';
import {
  clipChars,
  ilikeContainsPattern,
  intersectOrdered,
  orderByIds,
  withSearchFallback,
} from '../retrieval/search-logic.js';
import { logger } from '../utils/logger.js';

const SEARCH_ANNOTATION_QUOTE_CHARS = 140;
const SEARCH_ANNOTATION_NOTE_CHARS = 200;

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
        isNull(documents.deletedAt),
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
        acceptedCard(),
        topicEq(cards.topicId, topicId),
        or(ilike(cards.concept, pattern), ilike(cards.example, pattern), ilike(cards.confusionPoint, pattern)),
      ),
    )
    .orderBy(desc(cards.updatedAt), desc(cards.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function searchAnnotationIdsIlike(
  userId: string,
  query: string,
  limit: number,
  topicId?: string,
): Promise<string[]> {
  const pattern = ilikeContainsPattern(query);
  const rows = await getDb()
    .select({ id: annotations.id })
    .from(annotations)
    .innerJoin(documents, eq(documents.id, annotations.documentId))
    .where(
      and(
        eq(annotations.userId, userId),
        isNull(annotations.deletedAt),
        isNull(documents.deletedAt),
        topicEq(documents.topicId, topicId),
        or(ilike(annotations.note, pattern), ilike(annotations.quote, pattern)),
      ),
    )
    .orderBy(desc(annotations.updatedAt), desc(annotations.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function idsInTopic(
  kind: 'documents' | 'cards' | 'annotations',
  userId: string,
  ids: string[],
  topicId: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  if (kind === 'annotations') {
    const rows = await getDb()
      .select({ id: annotations.id })
      .from(annotations)
      .innerJoin(documents, eq(documents.id, annotations.documentId))
      .where(
        and(
          eq(annotations.userId, userId),
          isNull(annotations.deletedAt),
          isNull(documents.deletedAt),
          eq(documents.topicId, topicId),
          inArray(annotations.id, ids),
        ),
      );
    return intersectOrdered(ids, new Set(rows.map((row) => row.id)));
  }
  if (kind === 'cards') {
    const rows = await getDb()
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          acceptedCard(),
          eq(cards.topicId, topicId),
          inArray(cards.id, ids),
        ),
      );
    return intersectOrdered(ids, new Set(rows.map((row) => row.id)));
  }
  const rows = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.topicId, topicId),
        inArray(documents.id, ids),
        isNull(documents.deletedAt),
      ),
    );
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
    .where(and(eq(cards.userId, userId), acceptedCard(), inArray(cards.id, ids)));
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

/** Display-ready annotation rows in the given id order; also used by agent tools. */
export async function loadAnnotationsByIds(userId: string, ids: string[]): Promise<SearchAnnotation[]> {  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({
      annotation: annotations,
      docTitle: documents.title,
      docDescription: documents.description,
    })
    .from(annotations)
    .innerJoin(documents, eq(documents.id, annotations.documentId))
    .where(
      and(
        eq(annotations.userId, userId),
        isNull(annotations.deletedAt),
        isNull(documents.deletedAt),
        inArray(annotations.id, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.annotation.id, row]));
  const ordered: SearchAnnotation[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    ordered.push({
      id: row.annotation.id,
      documentId: row.annotation.documentId,
      documentTitle: docDisplayTitle({ title: row.docTitle, description: row.docDescription }),
      kind: row.annotation.kind,
      quote: clipChars(row.annotation.quote, SEARCH_ANNOTATION_QUOTE_CHARS),
      note: clipChars(row.annotation.note, SEARCH_ANNOTATION_NOTE_CHARS),
      pageIndex: row.annotation.pageIndex ?? null,
      createdAt: row.annotation.createdAt.toISOString(),
    });
  }
  return ordered;
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
  const annotationScope = topicId
    ? { filterIds: (ids: string[]) => idsInTopic('annotations', userId, ids, topicId) }
    : undefined;
  const [documentIds, cardIds, annotationIds] = await Promise.all([
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
    retrieveSearchIds(
      () => searchAnnotations(userId, q, limit, annotationScope),
      () => searchAnnotationIdsIlike(userId, q, limit, topicId),
      'annotations',
      scoped,
    ),
  ]);

  const [docs, cardRows, annotationRows] = await Promise.all([
    loadDocumentsByIds(userId, documentIds),
    loadCardsByIds(userId, cardIds),
    loadAnnotationsByIds(userId, annotationIds),
  ]);
  return { documents: docs, cards: cardRows, annotations: annotationRows };
}
