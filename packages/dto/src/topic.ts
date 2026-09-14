import { z } from 'zod';
import { jobSchema } from './job.js';

export const TOPIC_STATUSES = ['active', 'archived'] as const;
export const topicStatusSchema = z.enum(TOPIC_STATUSES);
export type TopicStatus = z.infer<typeof topicStatusSchema>;

export const topicSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  goal: z.string().nullable(),
  status: topicStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Topic = z.infer<typeof topicSchema>;

export const createTopicInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  goal: z.string().max(4000).optional(),
});
export type CreateTopicInput = z.infer<typeof createTopicInputSchema>;

export const updateTopicInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    goal: z.string().max(4000).nullable().optional(),
    status: topicStatusSchema.optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.goal !== undefined || value.status !== undefined,
    { message: 'at least one of title, goal, status is required' },
  );
export type UpdateTopicInput = z.infer<typeof updateTopicInputSchema>;

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const listTopicsQuerySchema = z.object({
  status: z.preprocess(emptyToUndef, topicStatusSchema.optional()),
});
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;

export const TOPIC_SUGGESTION_KEY_PREFIX = 'topic_suggestion_';
export const TOPIC_SUGGESTION_MIN_DOCS = 4;
export const TOPIC_SUGGESTION_LOOKBACK_DAYS = 30;
export const TOPIC_SUGGESTION_DISMISS_DAYS = 30;
export const TOPIC_SUGGESTION_EXPIRE_DAYS = 7;

export const TOPIC_SUGGESTION_STATUSES = ['pending', 'accepted', 'dismissed'] as const;
export const topicSuggestionStatusSchema = z.enum(TOPIC_SUGGESTION_STATUSES);
export type TopicSuggestionStatus = z.infer<typeof topicSuggestionStatusSchema>;

export const topicSuggestionSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,78}$/, 'slug must be lowercase kebab-case');
export type TopicSuggestionSlug = z.infer<typeof topicSuggestionSlugSchema>;

export const topicSuggestionContentSchema = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  documentIds: z.array(z.string().uuid()).min(TOPIC_SUGGESTION_MIN_DOCS),
  status: topicSuggestionStatusSchema,
  slug: topicSuggestionSlugSchema.optional(),
  topicId: z.string().uuid().optional(),
  dismissedAt: z.string().optional(),
});
export type TopicSuggestionContent = z.infer<typeof topicSuggestionContentSchema>;

export const topicSuggestionSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  documentIds: z.array(z.string().uuid()),
  documentCount: z.number().int().nonnegative(),
  status: topicSuggestionStatusSchema,
  topicId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TopicSuggestion = z.infer<typeof topicSuggestionSchema>;

export const acceptTopicSuggestionResultSchema = z.object({
  topic: topicSchema,
  job: jobSchema,
  suggestion: topicSuggestionSchema,
});
export type AcceptTopicSuggestionResult = z.infer<typeof acceptTopicSuggestionResultSchema>;
