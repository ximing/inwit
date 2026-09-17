import type {
  Card,
  CardDetail,
  CardImageResponse,
  CardLink,
  CardLinksResponse,
  CardLinkWithCard,
  CardSummary,
  CreateCardInput,
} from '@inwit/dto';
import { and, asc, desc, eq } from 'drizzle-orm';
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
import { isExcerptKeyFor } from '../documents/excerpt-logic.js';
import { AppError } from '../errors.js';
import { recalculateMapNodeStatus, requireWritableMapNode } from '../maps/map.service.js';
import { tryIndexCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { presignGet } from '../storage/client.js';
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
  if (!row.documentId || !isExcerptKeyFor(row.imageKey, userId, row.documentId)) {
    throw AppError.of(404, 'CARD_IMAGE_NOT_FOUND');
  }
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
    .select({ dueAt: reviewStates.dueAt, intervalDays: reviewStates.intervalDays })
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
      ? { dueAt: state.dueAt.toISOString(), intervalDays: state.intervalDays }
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
