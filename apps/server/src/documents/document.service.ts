import type {
  CardQuestion,
  CreateChatInput,
  CreateDocumentInput,
  Document,
  DocumentDetail,
  DocumentListItem,
  ListDocumentsQuery,
  Paginated,
  UpdateDocumentInput,
} from '@inwit/dto';
import { titleFromContent } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { toPublicCard, toPublicQuestion } from '../cards/card.mapper.js';
import { getDb } from '../db/index.js';
import {
  cardQuestions,
  cards,
  documents,
  topics,
  type CardQuestionRow,
  type DocumentRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { cancelPendingDocumentJobs, enqueueJob } from '../jobs/queue.js';
import { requireWritableMapNode } from '../maps/map.service.js';
import { getOwnedTopic } from '../topics/topic.service.js';

export function toPublicDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    mapNodeId: row.mapNodeId,
    title: row.title,
    contentMd: row.contentMd,
    source: row.source,
    status: row.status,
    answer: row.answer ?? null,
    linkHint: row.linkHint ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOwnedDocument(userId: string, id: string): Promise<DocumentRow> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return row;
}

async function assertWritableTopic(userId: string, topicId: string | undefined): Promise<void> {
  if (topicId === undefined) return;
  const topic = await getOwnedTopic(userId, topicId);
  if (topic.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
}

export async function createDocument(
  userId: string,
  input: CreateDocumentInput,
): Promise<Document> {
  await assertWritableTopic(userId, input.topicId);

  return getDb().transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: input.topicId ?? null,
        title: input.title ?? titleFromContent(input.contentMd),
        contentMd: input.contentMd,
        source: input.source ?? 'paste',
        status: 'pending',
      })
      .returning();
    if (!document) throw AppError.of(500, 'INTERNAL_ERROR');
    await enqueueJob(tx, {
      userId,
      type: 'digest',
      payload: { documentId: document.id },
    });
    return toPublicDocument(document);
  });
}

export async function createChat(userId: string, input: CreateChatInput): Promise<Document> {
  await assertWritableTopic(userId, input.topicId);

  return getDb().transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: input.topicId ?? null,
        title: titleFromContent(input.question),
        contentMd: input.question,
        source: 'chat',
        answer: null,
        status: 'pending',
      })
      .returning();
    if (!document) throw AppError.of(500, 'INTERNAL_ERROR');
    await enqueueJob(tx, {
      userId,
      type: 'chat',
      payload: { documentId: document.id },
    });
    return toPublicDocument(document);
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

export async function updateDocument(
  userId: string,
  id: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const existing = await getOwnedDocument(userId, id);
  const contentMd = input.contentMd ?? existing.contentMd;
  const title =
    input.title ?? (input.contentMd !== undefined ? titleFromContent(contentMd) : existing.title);

  const [row] = await getDb()
    .update(documents)
    .set({
      title,
      contentMd,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .returning();
  if (!row) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
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

  return {
    ...toPublicDocument(document),
    topicTitle,
    cards: cardRows.map((row) => toPublicCard(row, questionsByCard.get(row.id) ?? [])),
  };
}

/**
 * Deletes the document. Cards keep their rows (`cards.document_id ON DELETE SET NULL`)
 * so review history is not destroyed. Pending digest/chat jobs for this document are cancelled.
 */
export async function deleteDocument(userId: string, id: string): Promise<void> {
  await getOwnedDocument(userId, id);
  await getDb().transaction(async (tx) => {
    await cancelPendingDocumentJobs(tx, userId, id);
    await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)));
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
