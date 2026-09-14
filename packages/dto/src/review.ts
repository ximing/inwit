import { z } from 'zod';
import { cardWithQuestionsSchema } from './card.js';

export const REVIEW_FEEDBACKS = ['forgot', 'fuzzy', 'remembered'] as const;
export const reviewFeedbackSchema = z.enum(REVIEW_FEEDBACKS);
export type ReviewFeedback = z.infer<typeof reviewFeedbackSchema>;

export const reviewStateSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  cardId: z.string().uuid(),
  ease: z.number(),
  intervalDays: z.number().int().nonnegative(),
  dueAt: z.string(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  lastFeedback: reviewFeedbackSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const reviewLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  cardId: z.string().uuid(),
  feedback: reviewFeedbackSchema,
  reviewedAt: z.string(),
});
export type ReviewLog = z.infer<typeof reviewLogSchema>;

export const submitReviewFeedbackSchema = z.object({
  feedback: reviewFeedbackSchema,
});
export type SubmitReviewFeedback = z.infer<typeof submitReviewFeedbackSchema>;

export const mapPlacementSchema = z.object({
  topicTitle: z.string(),
  nodePath: z.string(),
});
export type MapPlacement = z.infer<typeof mapPlacementSchema>;

export const reviewQueueItemSchema = z.object({
  card: cardWithQuestionsSchema,
  reviewState: reviewStateSchema,
  mapPlacement: mapPlacementSchema.nullable(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

export const reviewTodaySchema = z.object({
  items: z.array(reviewQueueItemSchema),
  reviewedToday: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ReviewToday = z.infer<typeof reviewTodaySchema>;

export const reviewFeedbackResultSchema = z.object({
  reviewState: reviewStateSchema,
  log: reviewLogSchema,
  evolveJobId: z.string().uuid().optional(),
});
export type ReviewFeedbackResult = z.infer<typeof reviewFeedbackResultSchema>;

export const reviewStatsSchema = z.object({
  last7Days: z.object({
    forgot: z.number().int().nonnegative(),
    fuzzy: z.number().int().nonnegative(),
    remembered: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  overdueCount: z.number().int().nonnegative(),
});
export type ReviewStats = z.infer<typeof reviewStatsSchema>;
