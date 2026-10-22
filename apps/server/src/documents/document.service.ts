import type {
  ArchiveListQuery,
  ArchivedDocumentsResponse,
  CardQuestion,
  CreateChatInput,
  CreateDocumentInput,
  CreateSelectionCardsInput,
  Document,
  DocumentDetail,
  DocumentFileResponse,
  DocumentListItem,
  DocumentSource,
  ExcerptUploadInput,
  ExcerptUploadResponse,
  Job,
  JobPayload,
  ListDocumentsQuery,
  Paginated,
  UpdateDocumentInput,
} from '@inwit/dto';
import { toDocumentListItem } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { shouldIndexCard } from '../cards/card-acceptance-logic.js';
import { updateCards } from '../cards/card-write.js';
import { toPublicCard, toPublicQuestion } from '../cards/card.mapper.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  annotations,
  cardQuestions,
  cards,
  concepts,
  documentKnowledgeRefs,
  documents,
  jobs,
  reviewStates,
  topics,
  type CardQuestionRow,
  type DocumentRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { cancelDocumentJobs, enqueueJob } from '../jobs/queue.js';
import { resolveModelFor } from '../llm/pi.js';
import { recalculateMapNodeStatus, requireWritableMapNode } from '../maps/map.service.js';
import { ocrPayloadForRetry } from '../ocr/ocr-logic.js';
import { resolveOcrFor } from '../ocr/ocr.service.js';
import {
  tryDeleteAnnotationFromIndex,
  tryDeleteCardFromIndex,
  tryDeleteDocumentFromIndex,
  tryIndexAnnotation,
  tryIndexCard,
  tryIndexDocument,
} from '../retrieval/pipeline.js';
import { deletePrefixExcept, isStorageConfigured, presignGet, presignPut } from '../storage/client.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { logger } from '../utils/logger.js';
import { EMPTY_PM_DOC, textToParagraphDoc } from './content-json.js';
import {
  documentDetailEtag,
  ifNoneMatchSatisfied,
  type DocumentDetailStamp,
} from './document-etag-logic.js';
import { insertUserDocument, saveUserDocument } from './document-write.js';
import { retryJobKindForDocument } from './extract-logic.js';
import { excerptKeyFor, validateExcerptUpload } from './excerpt-logic.js';
import { documentObjectPrefix } from './import-logic.js';
import { resolveDocumentAssets } from './document-assets.js';

export function toPublicDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    mapNodeId: row.mapNodeId,
    title: row.title ?? null,
    description: row.description ?? null,
    contentJson: (row.contentJson ?? EMPTY_PM_DOC) as Document['contentJson'],
    source: row.source,
    kind: row.kind,
    reportWeekStart: row.reportWeekStart,
    status: row.status,
    failReason: row.failReason ?? null,
    answer: row.answer ?? null,
    linkHint: row.linkHint ?? null,
    fileMime: row.fileMime ?? null,
    pageCount: row.pageCount ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function findOwnedDocument(userId: string, id: string): Promise<DocumentRow | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getOwnedDocument(userId: string, id: string): Promise<DocumentRow> {
  const row = await findOwnedDocument(userId, id);
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return row;
}

/** Ownership check that also sees archived documents (回收站 restore/destroy paths). */
export async function getOwnedDocumentAny(userId: string, id: string): Promise<DocumentRow> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return row;
}

export async function assertWritableTopic(userId: string, topicId: string | undefined): Promise<void> {
  if (topicId === undefined) return;
  const topic = await getOwnedTopic(userId, topicId);
  if (topic.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
}

export async function createDocument(
  userId: string,
  input: Omit<CreateDocumentInput, 'source'> & { source?: DocumentSource | undefined },
): Promise<Document> {
  await assertWritableTopic(userId, input.topicId);
  return toPublicDocument(await insertUserDocument(userId, input));
}

export async function createChat(userId: string, input: CreateChatInput): Promise<Document> {
  await assertWritableTopic(userId, input.topicId);
  await resolveModelFor(userId);

  const document = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: input.topicId ?? null,
        title: null,
        contentJson: textToParagraphDoc(input.question),
        source: 'chat',
        answer: null,
        status: 'pending',
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    await enqueueJob(tx, {
      userId,
      type: 'chat',
      payload: { documentId: row.id, question: input.question },
    });
    return row;
  });
  await tryIndexDocument(document);
  return toPublicDocument(document);
}

export async function enqueueSelectionCards(
  userId: string,
  documentId: string,
  input: CreateSelectionCardsInput,
): Promise<Job> {
  const document = await getOwnedDocument(userId, documentId);
  return getDb().transaction(async (tx) => {
    const row = await enqueueJob(tx, {
      userId,
      type: 'selection',
      payload: { documentId, selectionText: input.text, blockIndex: input.blockIndex },
    });
    return toPublicJob(row, { documentTitle: document.title });
  });
}

function documentAcceptanceCounts() {
  return getDb()
    .select({
      documentId: cards.documentId,
      acceptedCount: sql<number>`count(*) filter (where ${cards.acceptance} = 'accepted')::int`.as(
        'accepted_count',
      ),
      proposedCount: sql<number>`count(*) filter (where ${cards.acceptance} = 'proposed')::int`.as(
        'proposed_count',
      ),
    })
    .from(cards)
    .where(isNull(cards.deletedAt))
    .groupBy(cards.documentId)
    .as('doc_card_counts');
}

/** 文章列表上的概念数：本文直接引用、未移除、且概念本身未归档。 */
function documentConceptCounts() {
  return getDb()
    .select({
      documentId: documentKnowledgeRefs.documentId,
      conceptCount: sql<number>`count(*)::int`.as('concept_count'),
    })
    .from(documentKnowledgeRefs)
    .innerJoin(concepts, eq(concepts.id, documentKnowledgeRefs.conceptId))
    .where(
      and(
        isNull(documentKnowledgeRefs.removedAt),
        isNotNull(documentKnowledgeRefs.conceptId),
        isNull(concepts.archivedAt),
      ),
    )
    .groupBy(documentKnowledgeRefs.documentId)
    .as('doc_concept_counts');
}

export async function listDocuments(
  userId: string,
  query: ListDocumentsQuery,
  kind: 'document' | 'weekly_report' = 'document',
): Promise<Paginated<DocumentListItem>> {
  const conditions: SQL[] = [
    eq(documents.userId, userId),
    eq(documents.kind, kind),
    isNull(documents.deletedAt),
  ];
  if (query.topicId !== undefined) conditions.push(eq(documents.topicId, query.topicId));
  if (query.status !== undefined) conditions.push(eq(documents.status, query.status));
  const where = and(...conditions);

  const [totalRow] = await getDb().select({ n: count() }).from(documents).where(where);
  const cardCounts = documentAcceptanceCounts();
  const conceptCounts = documentConceptCounts();

  const rows = await getDb()
    .select({
      document: documents,
      cardCount: cardCounts.acceptedCount,
      proposedCount: cardCounts.proposedCount,
      conceptCount: conceptCounts.conceptCount,
      topicTitle: topics.title,
    })
    .from(documents)
    .leftJoin(cardCounts, eq(cardCounts.documentId, documents.id))
    .leftJoin(conceptCounts, eq(conceptCounts.documentId, documents.id))
    .leftJoin(topics, eq(topics.id, documents.topicId))
    .where(where)
    .orderBy(...(kind === 'weekly_report' ? [desc(documents.reportWeekStart), desc(documents.createdAt)] : [desc(documents.updatedAt)]), desc(documents.id))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows.map((row) =>
      toDocumentListItem(toPublicDocument(row.document), {
        cardCount: Number(row.cardCount ?? 0),
        proposedCount: Number(row.proposedCount ?? 0),
        conceptCount: Number(row.conceptCount ?? 0),
        topicTitle: row.topicTitle ?? null,
      }),
    ),
    total: Number(totalRow?.n ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getDocumentListItemsByIds(
  userId: string,
  ids: string[],
): Promise<DocumentListItem[]> {
  if (ids.length === 0) return [];
  const cardCounts = documentAcceptanceCounts();
  const conceptCounts = documentConceptCounts();

  const rows = await getDb()
    .select({
      document: documents,
      cardCount: cardCounts.acceptedCount,
      proposedCount: cardCounts.proposedCount,
      conceptCount: conceptCounts.conceptCount,
      topicTitle: topics.title,
    })
    .from(documents)
    .leftJoin(cardCounts, eq(cardCounts.documentId, documents.id))
    .leftJoin(conceptCounts, eq(conceptCounts.documentId, documents.id))
    .leftJoin(topics, eq(topics.id, documents.topicId))
    .where(and(eq(documents.userId, userId), inArray(documents.id, ids), isNull(documents.deletedAt)));

  return rows.map((row) =>
    toDocumentListItem(toPublicDocument(row.document), {
      cardCount: Number(row.cardCount ?? 0),
      proposedCount: Number(row.proposedCount ?? 0),
      conceptCount: Number(row.conceptCount ?? 0),
      topicTitle: row.topicTitle ?? null,
    }),
  );
}

export async function updateDocument(
  userId: string,
  id: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const existing = await getOwnedDocument(userId, id);
  if (input.topicId) await assertWritableTopic(userId, input.topicId);
  return toPublicDocument(await saveUserDocument(userId, id, existing, input));
}

function stampText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && value.includes('T')) return parsed.toISOString();
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function stampCount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'bigint') return value.toString();
  return '0';
}

async function loadDocumentDetailStamp(
  userId: string,
  id: string,
): Promise<DocumentDetailStamp | null> {
  const result = await getDb().execute<{
    updated_at: Date | string;
    status: string;
    fail_reason: string | null;
    title: string | null;
    description: string | null;
    topic_id: string | null;
    topic_title: string | null;
    topic_updated_at: Date | string | null;
    answer: string | null;
    link_hint: string | null;
    file_mime: string | null;
    file_size: string | number | null;
    page_count: number | null;
    source: string;
    kind: string;
    content_hash: string;
    card_count: number | string;
    proposed_count: number | string;
    card_updated_at: Date | string | null;
    card_hash: string | null;
    question_hash: string | null;
    review_updated_at: Date | string | null;
    review_count: number | string;
  }>(sql`
    SELECT
      d.updated_at AS updated_at,
      d.status AS status,
      d.fail_reason AS fail_reason,
      d.title AS title,
      d.description AS description,
      d.topic_id AS topic_id,
      t.title AS topic_title,
      t.updated_at AS topic_updated_at,
      d.answer AS answer,
      d.link_hint AS link_hint,
      d.file_mime AS file_mime,
      d.file_size AS file_size,
      d.page_count AS page_count,
      d.source AS source,
      d.kind AS kind,
      md5(d.content_json::text) AS content_hash,
      coalesce(card_rev.card_count, 0) AS card_count,
      coalesce(card_rev.proposed_count, 0) AS proposed_count,
      card_rev.card_updated_at AS card_updated_at,
      coalesce(card_rev.card_hash, '') AS card_hash,
      coalesce(question_rev.question_hash, '') AS question_hash,
      review_rev.review_updated_at AS review_updated_at,
      coalesce(review_rev.review_count, 0) AS review_count
    FROM ${documents} AS d
    LEFT JOIN ${topics} AS t ON t.id = d.topic_id
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS card_count,
        count(*) FILTER (WHERE c.acceptance = 'proposed')::int AS proposed_count,
        max(c.updated_at) AS card_updated_at,
        md5(coalesce(string_agg(
          c.id::text || '|' || c.updated_at::text || '|' || c.acceptance || '|' ||
          c.outline_position::text || '|' || coalesce(c.review_revision::text, '') || '|' ||
          coalesce(c.outline_parent_id::text, ''),
          ',' ORDER BY c.id
        ), '')) AS card_hash
      FROM ${cards} AS c
      WHERE c.document_id = d.id
        AND c.user_id = d.user_id
        AND c.deleted_at IS NULL
        AND c.acceptance <> 'rejected'
    ) AS card_rev ON true
    LEFT JOIN LATERAL (
      SELECT md5(coalesce(string_agg(
        q.id::text || '|' || q.type || '|' || q.question || '|' || q.answer,
        ',' ORDER BY q.id
      ), '')) AS question_hash
      FROM ${cardQuestions} AS q
      JOIN ${cards} AS c ON c.id = q.card_id
      WHERE c.document_id = d.id
        AND c.user_id = d.user_id
        AND c.deleted_at IS NULL
        AND c.acceptance <> 'rejected'
    ) AS question_rev ON true
    LEFT JOIN LATERAL (
      SELECT max(r.updated_at) AS review_updated_at, count(*)::int AS review_count
      FROM ${reviewStates} AS r
      JOIN ${cards} AS c ON c.id = r.card_id
      WHERE c.document_id = d.id
        AND c.user_id = d.user_id
        AND r.user_id = d.user_id
        AND c.deleted_at IS NULL
        AND c.acceptance <> 'rejected'
    ) AS review_rev ON true
    WHERE d.id = ${id}::uuid
      AND d.user_id = ${userId}::uuid
      AND d.deleted_at IS NULL
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  const updatedAt = stampText(row.updated_at);
  if (!updatedAt) return null;
  return {
    updatedAt,
    status: row.status,
    failReason: row.fail_reason,
    title: row.title,
    description: row.description,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    topicUpdatedAt: stampText(row.topic_updated_at),
    answer: row.answer,
    linkHint: row.link_hint,
    fileMime: row.file_mime,
    fileSize: stampText(row.file_size),
    pageCount: row.page_count === null || row.page_count === undefined ? null : String(row.page_count),
    source: row.source,
    kind: row.kind,
    contentHash: row.content_hash,
    cardCount: stampCount(row.card_count),
    proposedCount: stampCount(row.proposed_count),
    cardUpdatedAt: stampText(row.card_updated_at),
    cardHash: row.card_hash ?? '',
    questionHash: row.question_hash ?? '',
    reviewUpdatedAt: stampText(row.review_updated_at),
    reviewCount: stampCount(row.review_count),
  };
}

export type DocumentRead =
  | { etag: string; notModified: true }
  | { etag: string; notModified: false; detail: DocumentDetail };

/**
 * Conditional read for polls. A matching If-None-Match returns before the
 * content JSON, cards, and signed asset URLs are loaded.
 */
export async function getDocumentIfModified(
  userId: string,
  id: string,
  ifNoneMatch: string | undefined,
): Promise<DocumentRead> {
  const stamp = await loadDocumentDetailStamp(userId, id);
  if (!stamp) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  const etag = documentDetailEtag(stamp);
  if (ifNoneMatchSatisfied(ifNoneMatch, etag)) return { etag, notModified: true };
  return { etag, notModified: false, detail: await getDocument(userId, id) };
}

export async function getDocument(userId: string, id: string): Promise<DocumentDetail> {
  const document = await getOwnedDocument(userId, id);
  const topicTitle = document.topicId
    ? ((
        await getDb()
          .select({ title: topics.title })
          .from(topics)
          .where(eq(topics.id, document.topicId))
          .limit(1)
      )[0]?.title ?? null)
    : null;
  const cardRows = await getDb()
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, document.id),
        isNull(cards.deletedAt),
        ne(cards.acceptance, 'rejected'),
      ),
    )
    .orderBy(asc(cards.createdAt), asc(cards.id));

  const questionRows: CardQuestionRow[] =
    cardRows.length === 0
      ? []
      : await getDb()
          .select()
          .from(cardQuestions)
          .where(
            inArray(
              cardQuestions.cardId,
              cardRows.map((row) => row.id),
            ),
          )
          .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id));

  const questionsByCard = new Map<string, CardQuestion[]>();
  for (const row of questionRows) {
    const list = questionsByCard.get(row.cardId) ?? [];
    list.push(toPublicQuestion(row));
    questionsByCard.set(row.cardId, list);
  }

  const reviewRows =
    cardRows.length === 0
      ? []
      : await getDb()
          .select({
            cardId: reviewStates.cardId,
            dueAt: reviewStates.dueAt,
            intervalDays: reviewStates.intervalDays,
            suspendedAt: reviewStates.suspendedAt,
          })
          .from(reviewStates)
          .where(
            and(
              eq(reviewStates.userId, userId),
              inArray(
                reviewStates.cardId,
                cardRows.map((row) => row.id),
              ),
            ),
          );
  const reviewByCard = new Map(reviewRows.map((row) => [row.cardId, row]));
  const publicDocument = toPublicDocument(document);
  const assets = await resolveDocumentAssets(userId, publicDocument.contentJson);

  return {
    ...publicDocument,
    ...assets,
    topicTitle,
    cards: cardRows.map((row) => {
      const state = reviewByCard.get(row.id);
      return {
        ...toPublicCard(row, questionsByCard.get(row.id) ?? []),
        review: state
          ? {
              dueAt: state.dueAt.toISOString(),
              intervalDays: state.intervalDays,
              suspendedAt: state.suspendedAt ? state.suspendedAt.toISOString() : null,
            }
          : null,
      };
    }),
  };
}

/**
 * Soft delete (回收站): the document, its annotations and its cards are hidden
 * everywhere and can be restored together. Pipeline jobs for the document —
 * pending and running — are cancelled (running ones settle cooperatively via
 * the worker heartbeat probe). S3 objects stay put until permanent deletion.
 */
export async function archiveDocument(userId: string, id: string): Promise<void> {
  await getOwnedDocument(userId, id);
  const annotationRows = await getDb()
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.documentId, id),
        eq(annotations.userId, userId),
        isNull(annotations.deletedAt),
      ),
    );
  const cardRows = await getDb()
    .select({ id: cards.id, mapNodeId: cards.mapNodeId })
    .from(cards)
    .where(and(eq(cards.documentId, id), eq(cards.userId, userId), isNull(cards.deletedAt)));
  // One shared timestamp: restore uses it to revive exactly the annotations
  // and cards archived by this call, leaving earlier user-deleted ones in 回收站.
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await cancelDocumentJobs(tx, userId, id, now);
    await tx
      .update(annotations)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(annotations.documentId, id),
          eq(annotations.userId, userId),
          isNull(annotations.deletedAt),
        ),
      );
    await updateCards(tx)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(cards.documentId, id), eq(cards.userId, userId), isNull(cards.deletedAt)));
    // Document update stays last: sync coalesce needs that delete to win.
    await tx
      .update(documents)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)));
    const nodeIds = [...new Set(cardRows.map((row) => row.mapNodeId).filter((v): v is string => v !== null))];
    for (const nodeId of nodeIds) {
      await recalculateMapNodeStatus(nodeId, tx);
    }
  });
  await tryDeleteDocumentFromIndex(id);
  for (const row of annotationRows) {
    await tryDeleteAnnotationFromIndex(row.id);
  }
  for (const row of cardRows) {
    await tryDeleteCardFromIndex(row.id);
  }
}

/** Restore from 回收站: brings back the annotations and cards archived with the document. */
export async function restoreDocument(userId: string, id: string): Promise<Document> {
  const row = await getOwnedDocumentAny(userId, id);
  if (!row.deletedAt) return toPublicDocument(row);
  const archivedAt = row.deletedAt;
  const now = new Date();
  const { restored, restoredAnnotations, restoredCards } = await getDb().transaction(async (tx) => {
    const [doc] = await tx
      .update(documents)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();
    if (!doc) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    const annotationRows = await tx
      .update(annotations)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(annotations.documentId, id),
          eq(annotations.userId, userId),
          eq(annotations.deletedAt, archivedAt),
        ),
      )
      .returning();
    const cardRows = await updateCards(tx)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(cards.documentId, id),
          eq(cards.userId, userId),
          eq(cards.deletedAt, archivedAt),
        ),
      )
      .returning();
    const nodeIds = [...new Set(cardRows.map((card) => card.mapNodeId).filter((v): v is string => v !== null))];
    for (const nodeId of nodeIds) {
      await recalculateMapNodeStatus(nodeId, tx);
    }
    return { restored: doc, restoredAnnotations: annotationRows, restoredCards: cardRows };
  });
  await tryIndexDocument(restored);
  for (const annotation of restoredAnnotations) {
    await tryIndexAnnotation(annotation);
  }
  for (const card of restoredCards) {
    if (shouldIndexCard(card)) await tryIndexCard(card);
  }
  return toPublicDocument(restored);
}

/**
 * Excerpt keys under the document prefix referenced by cards that survive
 * the destroy — i.e. orphan cards from an earlier deletion whose documentId
 * was already set to NULL. The document's own cards are destroyed with it.
 */
async function excerptKeysReferencedByCards(
  userId: string,
  documentId: string,
): Promise<Set<string>> {
  const prefix = `${documentObjectPrefix(userId, documentId)}excerpts/`;
  const rows = await getDb()
    .select({ imageKey: cards.imageKey })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        like(cards.imageKey, `${prefix}%`),
        or(isNull(cards.documentId), ne(cards.documentId, documentId)),
      ),
    );
  return new Set(rows.map((row) => row.imageKey).filter((key): key is string => key !== null));
}

/**
 * Permanent delete from 回收站 (also used for aborted imports). The document's
 * cards — including their questions, links and review history — are deleted
 * with it; annotations and OCR pages cascade away. S3 objects under
 * docs/{userId}/{docId}/ are removed best-effort, except excerpts still
 * referenced by surviving orphan cards.
 */
export async function destroyDocument(userId: string, id: string): Promise<void> {
  await getOwnedDocumentAny(userId, id);
  const annotationRows = await getDb()
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(eq(annotations.documentId, id), eq(annotations.userId, userId)));
  const cardRows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.documentId, id), eq(cards.userId, userId)));
  // Snapshot surviving references before the transaction removes the cards.
  const keepKeys = isStorageConfigured() ? await excerptKeysReferencedByCards(userId, id) : new Set<string>();
  await getDb().transaction(async (tx) => {
    await cancelDocumentJobs(tx, userId, id);
    // Delete the cards first: the FK is ON DELETE SET NULL, so removing the
    // document row first would orphan them instead of deleting them.
    await tx.delete(cards).where(and(eq(cards.documentId, id), eq(cards.userId, userId)));
    await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)));
  });
  await tryDeleteDocumentFromIndex(id);
  for (const row of annotationRows) {
    await tryDeleteAnnotationFromIndex(row.id);
  }
  for (const row of cardRows) {
    await tryDeleteCardFromIndex(row.id);
  }
  if (isStorageConfigured()) {
    try {
      await deletePrefixExcept(documentObjectPrefix(userId, id), keepKeys);
    } catch (err) {
      logger.warn('document.storage_delete_failed', {
        documentId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function listArchivedDocuments(
  userId: string,
  query: ArchiveListQuery,
): Promise<ArchivedDocumentsResponse> {
  const offset = (query.page - 1) * query.limit;
  const where = and(eq(documents.userId, userId), isNotNull(documents.deletedAt));
  const cardCounts = getDb()
    .select({
      documentId: cards.documentId,
      n: count().as('n'),
    })
    .from(cards)
    .where(isNotNull(cards.deletedAt))
    .groupBy(cards.documentId)
    .as('doc_archived_card_counts');
  const [rows, [totalRow]] = await Promise.all([
    getDb()
      .select({ document: documents, cardCount: cardCounts.n })
      .from(documents)
      .leftJoin(cardCounts, eq(cardCounts.documentId, documents.id))
      .where(where)
      .orderBy(desc(documents.deletedAt), desc(documents.id))
      .limit(query.limit)
      .offset(offset),
    getDb().select({ value: count() }).from(documents).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...toPublicDocument(row.document),
      cardCount: Number(row.cardCount ?? 0),
    })),
    total: totalRow?.value ?? 0,
  };
}

/** Worker sweep: permanently destroy documents whose 回收站 stay expired. */
export async function purgeExpiredDocuments(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({ id: documents.id, userId: documents.userId })
    .from(documents)
    .where(and(isNotNull(documents.deletedAt), lte(documents.deletedAt, cutoff)));
  let purged = 0;
  for (const row of rows) {
    try {
      await destroyDocument(row.userId, row.id);
      purged += 1;
    } catch (err) {
      logger.error('document.purge_failed', {
        documentId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return purged;
}

export async function getDocumentFile(userId: string, id: string): Promise<DocumentFileResponse> {
  const document = await getOwnedDocument(userId, id);
  if (!document.fileKey) throw AppError.of(404, 'DOCUMENT_FILE_NOT_FOUND');
  const prefix = documentObjectPrefix(userId, id);
  if (!document.fileKey.startsWith(prefix) || document.fileKey.includes('..')) {
    throw AppError.of(404, 'DOCUMENT_FILE_NOT_FOUND');
  }
  const url = await presignGet(document.fileKey);
  return { url, mime: document.fileMime ?? 'application/octet-stream' };
}

export async function requestExcerptUpload(
  userId: string,
  documentId: string,
  input: ExcerptUploadInput,
): Promise<ExcerptUploadResponse> {
  await getOwnedDocument(userId, documentId);
  const { mime } = validateExcerptUpload(input.contentType, input.sizeBytes);
  const key = excerptKeyFor(userId, documentId, mime);
  const uploadUrl = await presignPut(key, mime);
  return { uploadUrl, key };
}

export async function retryDocument(userId: string, id: string): Promise<Job> {
  const document = await getOwnedDocument(userId, id);
  const kind = retryJobKindForDocument({
    status: document.status,
    contentJson: document.contentJson,
    fileKey: document.fileKey ?? null,
    fileMime: document.fileMime ?? null,
    pageCount: document.pageCount ?? null,
  });
  if (!kind) throw AppError.of(409, 'DOCUMENT_NOT_RETRYABLE');
  if (kind === 'digest') await resolveModelFor(userId);
  if (kind === 'ocr') await resolveOcrFor(userId);

  return getDb().transaction(async (tx) => {
    const [active] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          eq(jobs.type, kind),
          inArray(jobs.status, ['pending', 'running']),
          sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${id}`,
        ),
      )
      .limit(1);
    if (active) throw AppError.of(409, 'DOCUMENT_NOT_RETRYABLE');

    await tx
      .update(documents)
      .set({ status: 'pending', failReason: null, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)));

    let payload: JobPayload;
    if (kind === 'ocr') {
      const [prev] = await tx
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.type, 'ocr'),
            sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${id}`,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      payload = ocrPayloadForRetry(id, document.pageCount ?? 0, prev?.payload);
    } else if (kind === 'extract') {
      const [prev] = await tx
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.type, 'extract'),
            sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${id}`,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      const importTitle = prev && typeof prev.payload.importTitle === 'string' ? prev.payload.importTitle : undefined;
      payload = importTitle !== undefined ? { documentId: id, importTitle } : { documentId: id };
    } else {
      payload = { documentId: id };
    }

    const row = await enqueueJob(tx, { userId, type: kind, payload });
    return toPublicJob(row, { documentTitle: document.title });
  });
}

export async function setDocumentMapNode(
  userId: string,
  documentId: string,
  nodeId: string | null,
): Promise<Document> {
  const document = await getOwnedDocument(userId, documentId);
  const node = nodeId === null ? null : await requireWritableMapNode(userId, nodeId);
  if (node && document.topicId !== null && document.topicId !== node.topicId) {
    throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
  }
  if (nodeId === null && document.mapNodeId) {
    await requireWritableMapNode(userId, document.mapNodeId);
  }

  const [row] = await getDb()
    .update(documents)
    .set({
      mapNodeId: nodeId,
      ...(node && document.topicId === null ? { topicId: node.topicId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .returning();
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return toPublicDocument(row);
}
