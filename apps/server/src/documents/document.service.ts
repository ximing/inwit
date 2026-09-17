import type {
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
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { toPublicCard, toPublicQuestion } from '../cards/card.mapper.js';
import { getDb } from '../db/index.js';
import {
  annotations,
  cardQuestions,
  cards,
  documents,
  jobs,
  reviewStates,
  topics,
  type CardQuestionRow,
  type DocumentRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { cancelPendingDocumentJobs, enqueueJob } from '../jobs/queue.js';
import { requireWritableMapNode } from '../maps/map.service.js';
import { ocrPayloadForRetry } from '../ocr/ocr-logic.js';
import {
  tryDeleteAnnotationFromIndex,
  tryDeleteDocumentFromIndex,
  tryIndexDocument,
} from '../retrieval/pipeline.js';
import { deletePrefix, isStorageConfigured, presignGet, presignPut } from '../storage/client.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { logger } from '../utils/logger.js';
import { EMPTY_PM_DOC, textToParagraphDoc } from './content-json.js';
import { isBlankDocumentContent, shouldEnqueueDigest } from './document-logic.js';
import { retryJobKindForDocument } from './extract-logic.js';
import { excerptKeyFor, validateExcerptUpload } from './excerpt-logic.js';
import { documentObjectPrefix } from './import-logic.js';

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
    status: row.status,
    answer: row.answer ?? null,
    linkHint: row.linkHint ?? null,
    fileMime: row.fileMime ?? null,
    pageCount: row.pageCount ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findOwnedDocument(userId: string, id: string): Promise<DocumentRow | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getOwnedDocument(userId: string, id: string): Promise<DocumentRow> {
  const row = await findOwnedDocument(userId, id);
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

  const blank = isBlankDocumentContent(input.contentJson);

  const document = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: input.topicId ?? null,
        title: input.title ?? null,
        contentJson: input.contentJson,
        source: input.source ?? 'paste',
        status: blank ? 'digested' : 'pending',
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    if (!blank) {
      await enqueueJob(tx, {
        userId,
        type: 'digest',
        payload: { documentId: row.id },
      });
    }
    return row;
  });
  if (!blank) await tryIndexDocument(document);
  return toPublicDocument(document);
}

export async function createChat(userId: string, input: CreateChatInput): Promise<Document> {
  await assertWritableTopic(userId, input.topicId);

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

export async function listDocuments(
  userId: string,
  query: ListDocumentsQuery,
): Promise<Paginated<DocumentListItem>> {
  const conditions: SQL[] = [eq(documents.userId, userId)];
  if (query.topicId !== undefined) conditions.push(eq(documents.topicId, query.topicId));
  if (query.status !== undefined) conditions.push(eq(documents.status, query.status));
  const where = and(...conditions);

  const [totalRow] = await getDb().select({ n: count() }).from(documents).where(where);
  const cardCounts = getDb()
    .select({
      documentId: cards.documentId,
      n: count().as('n'),
    })
    .from(cards)
    .groupBy(cards.documentId)
    .as('doc_card_counts');

  const rows = await getDb()
    .select({
      document: documents,
      cardCount: cardCounts.n,
      topicTitle: topics.title,
    })
    .from(documents)
    .leftJoin(cardCounts, eq(cardCounts.documentId, documents.id))
    .leftJoin(topics, eq(topics.id, documents.topicId))
    .where(where)
    .orderBy(desc(documents.updatedAt), desc(documents.id))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows.map((row) => ({
      ...toPublicDocument(row.document),
      cardCount: Number(row.cardCount ?? 0),
      topicTitle: row.topicTitle ?? null,
    })),
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
  const cardCounts = getDb()
    .select({
      documentId: cards.documentId,
      n: count().as('n'),
    })
    .from(cards)
    .groupBy(cards.documentId)
    .as('doc_card_counts');

  const rows = await getDb()
    .select({
      document: documents,
      cardCount: cardCounts.n,
      topicTitle: topics.title,
    })
    .from(documents)
    .leftJoin(cardCounts, eq(cardCounts.documentId, documents.id))
    .leftJoin(topics, eq(topics.id, documents.topicId))
    .where(and(eq(documents.userId, userId), inArray(documents.id, ids)));

  return rows.map((row) => ({
    ...toPublicDocument(row.document),
    cardCount: Number(row.cardCount ?? 0),
    topicTitle: row.topicTitle ?? null,
  }));
}

export async function updateDocument(
  userId: string,
  id: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const existing = await getOwnedDocument(userId, id);
  const contentJson = input.contentJson !== undefined ? input.contentJson : existing.contentJson;
  const title = input.title !== undefined ? input.title : existing.title;

  if (input.topicId) await assertWritableTopic(userId, input.topicId);

  const topicChanged = input.topicId !== undefined && input.topicId !== existing.topicId;
  const becameNonEmpty =
    input.contentJson !== undefined &&
    isBlankDocumentContent(existing.contentJson) &&
    !isBlankDocumentContent(input.contentJson);

  const row = await getDb().transaction(async (tx) => {
    let enqueueDigest = false;
    if (becameNonEmpty) {
      const [cardCountRow] = await tx
        .select({ n: count() })
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.documentId, id)));
      const [activeDigest] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.type, 'digest'),
            inArray(jobs.status, ['pending', 'running']),
            sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${id}`,
          ),
        )
        .limit(1);
      enqueueDigest = shouldEnqueueDigest(
        existing,
        input,
        Number(cardCountRow?.n ?? 0),
        activeDigest !== undefined,
      );
    }

    const [updated] = await tx
      .update(documents)
      .set({
        title,
        contentJson,
        updatedAt: new Date(),
        ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
        ...(topicChanged ? { mapNodeId: null } : {}),
        ...(enqueueDigest ? { status: 'pending' as const } : {}),
      })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();
    if (!updated) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    if (enqueueDigest) {
      await enqueueJob(tx, {
        userId,
        type: 'digest',
        payload: { documentId: id },
      });
    }
    return updated;
  });
  const titleChanged = input.title !== undefined && title !== existing.title;
  const contentChanged =
    input.contentJson !== undefined &&
    JSON.stringify(input.contentJson) !== JSON.stringify(existing.contentJson);
  if (titleChanged || contentChanged || topicChanged) await tryIndexDocument(row);
  return toPublicDocument(row);
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
    .where(and(eq(cards.userId, userId), eq(cards.documentId, document.id)))
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

  return {
    ...toPublicDocument(document),
    topicTitle,
    cards: cardRows.map((row) => {
      const state = reviewByCard.get(row.id);
      return {
        ...toPublicCard(row, questionsByCard.get(row.id) ?? []),
        review: state
          ? { dueAt: state.dueAt.toISOString(), intervalDays: state.intervalDays }
          : null,
      };
    }),
  };
}

/**
 * Deletes the document. Cards keep their rows (`cards.document_id ON DELETE SET NULL`)
 * so review history is not destroyed. Pending digest/chat/extract/ocr jobs for this document are cancelled.
 * S3 objects under docs/{userId}/{docId}/ are removed best-effort.
 */
export async function deleteDocument(userId: string, id: string): Promise<void> {
  await getOwnedDocument(userId, id);
  const annotationRows = await getDb()
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(eq(annotations.documentId, id), eq(annotations.userId, userId)));
  await getDb().transaction(async (tx) => {
    await cancelPendingDocumentJobs(tx, userId, id);
    await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)));
  });
  await tryDeleteDocumentFromIndex(id);
  for (const row of annotationRows) {
    await tryDeleteAnnotationFromIndex(row.id);
  }
  if (isStorageConfigured()) {
    try {
      await deletePrefix(documentObjectPrefix(userId, id));
    } catch (err) {
      logger.warn('document.storage_delete_failed', {
        documentId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)));

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
