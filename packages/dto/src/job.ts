import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

export const JOB_TYPES = ['digest', 'evolve', 'weekly_report', 'topic', 'chat'] as const;
export const jobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof jobTypeSchema>;

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobPayloadSchema = z.record(z.string(), z.unknown());
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const jobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: jobTypeSchema,
  status: jobStatusSchema,
  payload: jobPayloadSchema,
  runAt: z.string(),
  finishedAt: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof jobSchema>;

export const digestJobPayloadSchema = z.object({
  documentId: z.string().uuid(),
});
export type DigestJobPayload = z.infer<typeof digestJobPayloadSchema>;

export const chatJobPayloadSchema = digestJobPayloadSchema;
export type ChatJobPayload = DigestJobPayload;

/** New jobs store `documentId`. Historical digest/chat jobs used `captureId` (same uuid after T11). */
export function documentIdFromJobPayload(payload: JobPayload): string | undefined {
  if (typeof payload.documentId === 'string' && payload.documentId.length > 0) {
    return payload.documentId;
  }
  if (typeof payload.captureId === 'string' && payload.captureId.length > 0) {
    return payload.captureId;
  }
  return undefined;
}

export const evolveJobPayloadSchema = z.object({
  cardId: z.string().uuid(),
  reason: z.string().optional(),
});
export type EvolveJobPayload = z.infer<typeof evolveJobPayloadSchema>;

export const TOPIC_JOB_ACTIONS = ['organize', 'fill', 'suggest'] as const;
export const topicJobActionSchema = z.enum(TOPIC_JOB_ACTIONS);
export type TopicJobAction = z.infer<typeof topicJobActionSchema>;

export const topicJobPayloadSchema = z
  .object({
    action: topicJobActionSchema,
    topicId: z.string().uuid().optional(),
    nodeId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'organize' && !value.topicId) {
      ctx.addIssue({ code: 'custom', path: ['topicId'], message: 'topicId required for organize' });
    }
    if (value.action === 'fill') {
      if (!value.topicId) {
        ctx.addIssue({ code: 'custom', path: ['topicId'], message: 'topicId required for fill' });
      }
      if (!value.nodeId) {
        ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'nodeId required for fill' });
      }
    }
  });
export type TopicJobPayload = z.infer<typeof topicJobPayloadSchema>;

export function topicJobPayloadFrom(payload: JobPayload): TopicJobPayload | undefined {
  const parsed = topicJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const listJobsQuerySchema = paginationQuerySchema.extend({
  status: z.preprocess(emptyToUndef, jobStatusSchema.optional()),
  type: z.preprocess(emptyToUndef, jobTypeSchema.optional()),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;
