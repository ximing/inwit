import type {
  ArchivedCardsResponse,
  ArchiveListQuery,
  Card,
  CardDetail,
  CardImageResponse,
  CardLink,
  CardLinksResponse,
  CardLinkWithCard,
  CardSummary,
  CreateCardInput,
  UpdateCardInput,
} from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  annotations,
  cardLinks,
  cardQuestions,
  cards,
  documents,
  reviewStates,
  type CardLinkRow,
  type CardRow,
} from '../db/schema.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { isExcerptKeyFor, isExcerptKeyOwnedBy } from '../documents/excerpt-logic.js';
import { AppError } from '../errors.js';
import { recalculateMapNodeStatus, requireWritableMapNode } from '../maps/map.service.js';
import { tryDeleteCardFromIndex, tryIndexCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { presignGet } from '../storage/client.js';
import { diffCardQuestions, normalizeTags } from './card-logic.js';
import { toCardSummary, toPublicCard, toPublicCardBase, toPublicQuestion } from './card.mapper.js';

function toPublicLink(row: CardLinkRow): CardLink {
  return {
    id: row.id,
    userId: row.userId,
    fromCardId: row.fromCardId,
    toCardId: row.toCardId,
    type: row.type,
    origin: row.origin,
    reason: row.reason ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function withCard(row: CardLinkRow, card: CardSummary): CardLinkWithCard {
  return { ...toPublicLink(row), card };
}

async function getOwnedCard(userId: string, id: string): Promise<CardRow> {
  const [row] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
  return row;
}

/** Ownership check that also sees archived cards (回收站 restore/destroy paths). */
async function getOwnedCardAny(userId: string, id: string): Promise<CardRow> {
  const [row] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
  return row;
}

export async function createCard(userId: string, input: CreateCardInput): Promise<Card> {
  const document = await getOwnedDocument(userId, input.documentId);
  if (input.imageKey && !isExcerptKeyFor(input.imageKey, userId, document.id)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.annotationId) {
    const [annotation] = await getDb()
      .select({ id: annotations.id, documentId: annotations.documentId })
      .from(annotations)
      .where(and(eq(annotations.id, input.annotationId), eq(annotations.userId, userId)))
      .limit(1);
    if (!annotation || annotation.documentId !== document.id) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  }
  const now = new Date();
  const anchorText = input.anchorText !== undefined ? input.anchorText : null;
  const anchorBlockIndex = input.anchorBlockIndex !== undefined ? input.anchorBlockIndex : null;
  const imageKey = input.imageKey !== undefined ? input.imageKey : null;

  const created = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(cards)
      .values({
        userId,
        documentId: document.id,
        topicId: document.topicId,
        concept: input.concept,
        example: input.example,
        confusionPoint: '',
        tags: [],
        source: 'manual',
        anchorText,
        anchorBlockIndex,
        imageKey,
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    await insertInitialReviewState(userId, row.id, now, tx, now);
    if (input.annotationId) {
      await tx
        .update(annotations)
        .set({ convertedCardId: row.id, updatedAt: now })
        .where(and(eq(annotations.id, input.annotationId), eq(annotations.userId, userId)));
    }
    return row;
  });
  await tryIndexCard(created);
  return toPublicCardBase(created);
}

export async function getCardImage(userId: string, id: string): Promise<CardImageResponse> {
  const row = await getOwnedCard(userId, id);
  if (!row.imageKey) throw AppError.of(404, 'CARD_IMAGE_NOT_FOUND');
  // Cards survive their document (documentId set to NULL on permanent delete);
  // fall back to an ownership-scoped key check so their excerpts keep working.
  const keyOk = row.documentId
    ? isExcerptKeyFor(row.imageKey, userId, row.documentId)
    : isExcerptKeyOwnedBy(row.imageKey, userId);
  if (!keyOk) throw AppError.of(404, 'CARD_IMAGE_NOT_FOUND');
  const url = await presignGet(row.imageKey);
  return { url };
}

export async function getCard(userId: string, id: string): Promise<CardDetail> {
  const row = await getOwnedCard(userId, id);
  const questionRows = await getDb()
    .select()
    .from(cardQuestions)
    .where(eq(cardQuestions.cardId, id))
    .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id));

  let documentTitle: string | null = null;
  if (row.documentId) {
    const [doc] = await getDb()
      .select({ title: documents.title })
      .from(documents)
      .where(and(eq(documents.id, row.documentId), eq(documents.userId, userId)))
      .limit(1);
    documentTitle = doc?.title ?? null;
  }

  const [state] = await getDb()
    .select({
      dueAt: reviewStates.dueAt,
      intervalDays: reviewStates.intervalDays,
      suspendedAt: reviewStates.suspendedAt,
    })
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, id)))
    .limit(1);

  return {
    ...toPublicCard(
      row,
      questionRows.map((question) => toPublicQuestion(question)),
    ),
    documentTitle,
    review: state
      ? {
          dueAt: state.dueAt.toISOString(),
          intervalDays: state.intervalDays,
          suspendedAt: state.suspendedAt ? state.suspendedAt.toISOString() : null,
        }
      : null,
  };
}

export async function listCardLinks(userId: string, cardId: string): Promise<CardLinksResponse> {
  await getOwnedCard(userId, cardId);

  const outgoingRows = await getDb()
    .select({ link: cardLinks, card: cards })
    .from(cardLinks)
    .innerJoin(cards, eq(cards.id, cardLinks.toCardId))
    .where(and(eq(cardLinks.userId, userId), eq(cardLinks.fromCardId, cardId)))
    .orderBy(desc(cardLinks.createdAt), desc(cardLinks.id));

  const incomingRows = await getDb()
    .select({ link: cardLinks, card: cards })
    .from(cardLinks)
    .innerJoin(cards, eq(cards.id, cardLinks.fromCardId))
    .where(and(eq(cardLinks.userId, userId), eq(cardLinks.toCardId, cardId)))
    .orderBy(desc(cardLinks.createdAt), desc(cardLinks.id));

  return {
    outgoing: outgoingRows.map((row) => withCard(row.link, toCardSummary(row.card))),
    incoming: incomingRows.map((row) => withCard(row.link, toCardSummary(row.card))),
  };
}

export async function deleteCardLink(userId: string, id: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: cardLinks.id })
    .from(cardLinks)
    .where(and(eq(cardLinks.id, id), eq(cardLinks.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_LINK_NOT_FOUND');
  await getDb().delete(cardLinks).where(and(eq(cardLinks.id, id), eq(cardLinks.userId, userId)));
}

export async function setCardMapNode(
  userId: string,
  cardId: string,
  nodeId: string | null,
): Promise<Card> {
  const card = await getOwnedCard(userId, cardId);
  const node = nodeId === null ? null : await requireWritableMapNode(userId, nodeId);
  if (node && card.topicId !== null && card.topicId !== node.topicId) {
    throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
  }
  if (nodeId === null && card.mapNodeId) {
    await requireWritableMapNode(userId, card.mapNodeId);
  }

  const oldNodeId = card.mapNodeId;
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(cards)
      .set({
        mapNodeId: nodeId,
        ...(node && card.topicId === null ? { topicId: node.topicId } : {}),
        updatedAt: now,
      })
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
      .returning();
    if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');

    const touched = new Set<string>();
    if (oldNodeId) touched.add(oldNodeId);
    if (nodeId) touched.add(nodeId);
    for (const id of touched) {
      await recalculateMapNodeStatus(id, tx);
    }
    return toPublicCardBase(row);
  });
}

export async function updateCard(
  userId: string,
  id: string,
  input: UpdateCardInput,
): Promise<CardDetail> {
  await getOwnedCard(userId, id);
  const now = new Date();

  await getDb().transaction(async (tx) => {
    const fields: Partial<typeof cards.$inferInsert> = { updatedAt: now };
    if (input.concept !== undefined) fields.concept = input.concept;
    if (input.example !== undefined) fields.example = input.example;
    if (input.confusionPoint !== undefined) fields.confusionPoint = input.confusionPoint;
    if (input.tags !== undefined) fields.tags = normalizeTags(input.tags);
    await tx
      .update(cards)
      .set(fields)
      .where(and(eq(cards.id, id), eq(cards.userId, userId)));

    if (input.questions !== undefined) {
      const existingRows = await tx
        .select()
        .from(cardQuestions)
        .where(eq(cardQuestions.cardId, id));
      const diff = diffCardQuestions(
        existingRows.map((row) => toPublicQuestion(row)),
        input.questions,
      );
      if (diff.unknownIds.length > 0) throw AppError.of(400, 'VALIDATION_ERROR');
      for (const question of diff.toCreate) {
        await tx.insert(cardQuestions).values({
          cardId: id,
          type: question.type,
          question: question.question,
          answer: question.answer,
        });
      }
      for (const { id: questionId, input: question } of diff.toUpdate) {
        await tx
          .update(cardQuestions)
          .set({ type: question.type, question: question.question, answer: question.answer })
          .where(eq(cardQuestions.id, questionId));
      }
      if (diff.toDelete.length > 0) {
        await tx.delete(cardQuestions).where(
          and(eq(cardQuestions.cardId, id), inArray(cardQuestions.id, diff.toDelete)),
        );
      }
    }
  });

  const detail = await getCard(userId, id);
  await tryIndexCard({
    id: detail.id,
    userId: detail.userId,
    topicId: detail.topicId,
    concept: detail.concept,
    example: detail.example,
    confusionPoint: detail.confusionPoint,
    tags: detail.tags,
  });
  return detail;
}

/** Soft delete (idempotent): hidden everywhere, restorable from 回收站. */
export async function archiveCard(userId: string, id: string): Promise<void> {
  const card = await getOwnedCardAny(userId, id);
  if (card.deletedAt) return;
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx
      .update(cards)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(cards.id, id), eq(cards.userId, userId)));
    if (card.mapNodeId) await recalculateMapNodeStatus(card.mapNodeId, tx);
  });
  await tryDeleteCardFromIndex(id);
}

export async function restoreCard(userId: string, id: string): Promise<Card> {
  const card = await getOwnedCardAny(userId, id);
  if (!card.deletedAt) return toPublicCardBase(card);
  const now = new Date();
  const restored = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(cards)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(cards.id, id), eq(cards.userId, userId)))
      .returning();
    if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
    if (row.mapNodeId) await recalculateMapNodeStatus(row.mapNodeId, tx);
    return row;
  });
  await tryIndexCard(restored);
  return toPublicCardBase(restored);
}

/** Permanent delete from 回收站; cardLinks/questions/review rows cascade. */
export async function destroyCard(userId: string, id: string): Promise<void> {
  await getOwnedCardAny(userId, id);
  await getDb()
    .delete(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, userId)));
  await tryDeleteCardFromIndex(id);
}

export async function listArchivedCards(
  userId: string,
  query: ArchiveListQuery,
): Promise<ArchivedCardsResponse> {
  const offset = (query.page - 1) * query.limit;
  const where = and(eq(cards.userId, userId), isNotNull(cards.deletedAt));
  const [rows, [totalRow]] = await Promise.all([
    getDb()
      .select({ card: cards, documentTitle: documents.title })
      .from(cards)
      .leftJoin(documents, eq(documents.id, cards.documentId))
      .where(where)
      .orderBy(desc(cards.deletedAt), desc(cards.id))
      .limit(query.limit)
      .offset(offset),
    getDb().select({ value: count() }).from(cards).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...toPublicCardBase(row.card),
      documentTitle: row.documentTitle ?? null,
    })),
    total: totalRow?.value ?? 0,
  };
}
