import { z } from 'zod';

export const CARD_SOURCES = ['manual', 'agent', 'chat'] as const;
export const cardSourceSchema = z.enum(CARD_SOURCES);
export type CardSource = z.infer<typeof cardSourceSchema>;

export const CARD_QUESTION_TYPES = ['cloze', 'compare', 'judge'] as const;
export const cardQuestionTypeSchema = z.enum(CARD_QUESTION_TYPES);
export type CardQuestionType = z.infer<typeof cardQuestionTypeSchema>;

export const CARD_LINK_TYPES = ['same_concept', 'confusable', 'prerequisite', 'related'] as const;
export const cardLinkTypeSchema = z.enum(CARD_LINK_TYPES);
export type CardLinkType = z.infer<typeof cardLinkTypeSchema>;

export const CARD_LINK_ORIGINS = ['agent', 'user'] as const;
export const cardLinkOriginSchema = z.enum(CARD_LINK_ORIGINS);
export type CardLinkOrigin = z.infer<typeof cardLinkOriginSchema>;

export const cardSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  topicId: z.string().uuid().nullable(),
  mapNodeId: z.string().uuid().nullable(),
  concept: z.string().min(1),
  example: z.string(),
  confusionPoint: z.string(),
  tags: z.array(z.string()),
  source: cardSourceSchema,
  anchorText: z.string().nullable(),
  anchorBlock: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof cardSchema>;

export const cardQuestionSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  type: cardQuestionTypeSchema,
  question: z.string().min(1),
  answer: z.string().min(1),
  createdAt: z.string(),
});
export type CardQuestion = z.infer<typeof cardQuestionSchema>;

export const cardWithQuestionsSchema = cardSchema.extend({
  questions: z.array(cardQuestionSchema),
});
export type CardWithQuestions = z.infer<typeof cardWithQuestionsSchema>;

export const cardSummarySchema = z.object({
  id: z.string().uuid(),
  concept: z.string(),
  tags: z.array(z.string()),
});
export type CardSummary = z.infer<typeof cardSummarySchema>;

export const cardLinkSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  fromCardId: z.string().uuid(),
  toCardId: z.string().uuid(),
  type: cardLinkTypeSchema,
  origin: cardLinkOriginSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type CardLink = z.infer<typeof cardLinkSchema>;

export const cardLinkWithCardSchema = cardLinkSchema.extend({
  card: cardSummarySchema,
});
export type CardLinkWithCard = z.infer<typeof cardLinkWithCardSchema>;

export const cardLinksResponseSchema = z.object({
  outgoing: z.array(cardLinkWithCardSchema),
  incoming: z.array(cardLinkWithCardSchema),
});
export type CardLinksResponse = z.infer<typeof cardLinksResponseSchema>;

/** Slim review fields for the card detail page — avoids a cycle with review.ts. */
export const cardReviewSummarySchema = z.object({
  dueAt: z.string(),
  intervalDays: z.number().int().nonnegative(),
});
export type CardReviewSummary = z.infer<typeof cardReviewSummarySchema>;

export const cardDetailSchema = cardWithQuestionsSchema.extend({
  documentTitle: z.string().nullable(),
  review: cardReviewSummarySchema.nullable(),
});
export type CardDetail = z.infer<typeof cardDetailSchema>;
