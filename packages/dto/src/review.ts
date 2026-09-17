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
  truncated: z.number().int().nonnegative(),
});
export type ReviewToday = z.infer<typeof reviewTodaySchema>;

export const reviewFeedbackResultSchema = z.object({
  reviewState: reviewStateSchema,
  log: reviewLogSchema,
  evolveJobId: z.string().uuid().optional(),
  analyzeJobId: z.string().uuid().optional(),
});
export type ReviewFeedbackResult = z.infer<typeof reviewFeedbackResultSchema>;

export const reviewDailyBucketSchema = z.object({
  date: z.string(),
  forgot: z.number().int().nonnegative(),
  fuzzy: z.number().int().nonnegative(),
  remembered: z.number().int().nonnegative(),
});
export type ReviewDailyBucket = z.infer<typeof reviewDailyBucketSchema>;

export const reviewForecastBucketSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
});
export type ReviewForecastBucket = z.infer<typeof reviewForecastBucketSchema>;

export const reviewStatsSchema = z.object({
  last7Days: z.object({
    forgot: z.number().int().nonnegative(),
    fuzzy: z.number().int().nonnegative(),
    remembered: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  overdueCount: z.number().int().nonnegative(),
  streak: z.object({
    current: z.number().int().nonnegative(),
    longest: z.number().int().nonnegative(),
  }),
  totalCards: z.number().int().nonnegative(),
  masteredCount: z.number().int().nonnegative(),
  retention7d: z.number().int().min(0).max(100).nullable(),
  reviews7d: z.number().int().nonnegative(),
  daily: z.array(reviewDailyBucketSchema),
  forecast: z.array(reviewForecastBucketSchema),
});
export type ReviewStats = z.infer<typeof reviewStatsSchema>;

/** 近 30 天忘记/模糊次数达到阈值的卡片（薄弱卡片 Top N）。 */
export const reviewStrugglingCardSchema = z.object({
  id: z.string().uuid(),
  concept: z.string(),
  struggleCount: z.number().int().nonnegative(),
  forgotCount: z.number().int().nonnegative(),
  fuzzyCount: z.number().int().nonnegative(),
  topicId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
});
export type ReviewStrugglingCard = z.infer<typeof reviewStrugglingCardSchema>;

/** 单个主题近 7 天的复习量与想起率。 */
export const reviewTopicStatSchema = z.object({
  topicId: z.string().uuid(),
  title: z.string(),
  reviews7d: z.number().int().nonnegative(),
  retention7d: z.number().int().min(0).max(100).nullable(),
});
export type ReviewTopicStat = z.infer<typeof reviewTopicStatSchema>;

export const learningStepsSchema = z
  .array(z.number().int().min(1).max(30))
  .min(1)
  .max(4)
  .superRefine((steps, ctx) => {
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]! <= steps[i - 1]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'learningSteps must be strictly increasing',
          path: [i],
        });
      }
    }
  });

export const reviewSettingsSchema = z.object({
  dailyReviewLimit: z.number().int().min(5).max(100),
  dailyNewLimit: z.number().int().min(0).max(30),
  startingEase: z.number().min(1.3).max(3),
  fuzzyScale: z.number().min(1).max(1.5),
  learningSteps: learningStepsSchema,
});
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  dailyReviewLimit: 20,
  dailyNewLimit: 5,
  startingEase: 2.5,
  fuzzyScale: 1.2,
  learningSteps: [1, 3, 6],
};

function asSettingsObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function pickSettingsField<K extends keyof ReviewSettings>(
  key: K,
  raw: Record<string, unknown>,
): ReviewSettings[K] {
  const parsed = reviewSettingsSchema.shape[key].safeParse(raw[key]);
  return (parsed.success ? parsed.data : DEFAULT_REVIEW_SETTINGS[key]) as ReviewSettings[K];
}

/** NULL / partial / invalid stored JSON falls back to defaults per field. */
export function mergeReviewSettings(raw: unknown): ReviewSettings {
  const obj = asSettingsObject(raw);
  return {
    dailyReviewLimit: pickSettingsField('dailyReviewLimit', obj),
    dailyNewLimit: pickSettingsField('dailyNewLimit', obj),
    startingEase: pickSettingsField('startingEase', obj),
    fuzzyScale: pickSettingsField('fuzzyScale', obj),
    learningSteps: [...pickSettingsField('learningSteps', obj)],
  };
}
