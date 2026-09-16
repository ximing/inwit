import type { Card, CardQuestion, CardSummary, CardWithQuestions } from '@inwit/dto';
import type { CardQuestionRow, CardRow } from '../db/schema.js';

export function toPublicQuestion(row: CardQuestionRow): CardQuestion {
  return {
    id: row.id,
    cardId: row.cardId,
    type: row.type,
    question: row.question,
    answer: row.answer,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPublicCard(row: CardRow, questions: CardQuestion[] = []): CardWithQuestions {
  return {
    ...toPublicCardBase(row),
    questions,
  };
}

export function toPublicCardBase(row: CardRow): Card {
  return {
    id: row.id,
    userId: row.userId,
    documentId: row.documentId,
    topicId: row.topicId,
    mapNodeId: row.mapNodeId,
    concept: row.concept,
    example: row.example,
    confusionPoint: row.confusionPoint,
    tags: row.tags,
    source: row.source,
    anchorText: row.anchorText ?? null,
    anchorBlock: row.anchorBlock ?? null,
    hasImage: Boolean(row.imageKey),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCardSummary(
  row: Pick<CardRow, 'id' | 'documentId' | 'concept' | 'tags'>,
): CardSummary {
  return {
    id: row.id,
    documentId: row.documentId ?? null,
    concept: row.concept,
    tags: row.tags,
  };
}
