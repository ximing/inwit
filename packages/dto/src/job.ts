import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

export const JOB_TYPES = [
  'digest',
  'evolve',
  'weekly_report',
  'topic',
  'chat',
  'selection',
  'extract',
  'ocr',
  'annotation_resurface',
] as const;
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
  summary: z.string(),
  description: z.string(),
  /** Actual models recorded in usage logs across this job's executions. */
  modelNames: z.array(z.string()).optional(),
  /** Present on running items from `GET /api/jobs/queue`. */
  startedElapsedSec: z.number().int().nonnegative().optional(),
  /** Present on pending items from `GET /api/jobs/queue` (`runAt` ISO). */
  scheduledFor: z.string().optional(),
});
export type Job = z.infer<typeof jobSchema>;

export const digestJobPayloadSchema = z.object({
  documentId: z.string().uuid(),
});
export type DigestJobPayload = z.infer<typeof digestJobPayloadSchema>;

export const extractJobPayloadSchema = digestJobPayloadSchema;
export type ExtractJobPayload = DigestJobPayload;

export const ocrJobPayloadSchema = z.object({
  documentId: z.string().uuid(),
  totalPages: z.number().int().nonnegative().optional(),
  donePages: z.array(z.number().int().nonnegative()).optional(),
  failedPages: z.array(z.number().int().nonnegative()).optional(),
});
export type OcrJobPayload = z.infer<typeof ocrJobPayloadSchema>;

export function ocrJobPayloadFrom(payload: JobPayload): OcrJobPayload | undefined {
  const parsed = ocrJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

export const chatJobPayloadSchema = digestJobPayloadSchema.extend({
  question: z.string().optional(),
});
export type ChatJobPayload = z.infer<typeof chatJobPayloadSchema>;

export const selectionJobPayloadSchema = z.object({
  documentId: z.string().uuid(),
  selectionText: z.string().min(1),
  blockIndex: z.number().int().positive().optional(),
});
export type SelectionJobPayload = z.infer<typeof selectionJobPayloadSchema>;

export function selectionJobPayloadFrom(payload: JobPayload): SelectionJobPayload | undefined {
  const parsed = selectionJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

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

export const EVOLVE_REASONS = ['fuzzy', 'repeated_forgot'] as const;
export const evolveReasonSchema = z.enum(EVOLVE_REASONS);
export type EvolveReason = z.infer<typeof evolveReasonSchema>;

export const evolveJobPayloadSchema = z.object({
  cardId: z.string().uuid(),
  reason: evolveReasonSchema,
});
export type EvolveJobPayload = z.infer<typeof evolveJobPayloadSchema>;

/** Map historical `reason: 'forgot'` (T6) onto `repeated_forgot`. */
export function evolveJobPayloadFrom(payload: JobPayload): EvolveJobPayload | undefined {
  if (typeof payload.cardId !== 'string' || payload.cardId.length === 0) return undefined;
  const rawReason = payload.reason === 'forgot' ? 'repeated_forgot' : payload.reason;
  const parsed = evolveJobPayloadSchema.safeParse({ cardId: payload.cardId, reason: rawReason });
  return parsed.success ? parsed.data : undefined;
}

export const EVOLVE_ANALYZE_ACTION = 'analyze_patterns' as const;
export const EVOLVE_ACTIONS = [EVOLVE_ANALYZE_ACTION] as const;
export const evolveActionSchema = z.enum(EVOLVE_ACTIONS);
export type EvolveAction = z.infer<typeof evolveActionSchema>;

/** Local calendar day `YYYY-MM-DD` used to dedupe one analyze job per user per day. */
export const evolveAnalyzeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const evolveAnalyzeJobPayloadSchema = z.object({
  action: z.literal(EVOLVE_ANALYZE_ACTION),
  date: evolveAnalyzeDateSchema,
});
export type EvolveAnalyzeJobPayload = z.infer<typeof evolveAnalyzeJobPayloadSchema>;

export function evolveAnalyzeJobPayloadFrom(
  payload: JobPayload,
): EvolveAnalyzeJobPayload | undefined {
  const parsed = evolveAnalyzeJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

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

/** Local calendar Monday `YYYY-MM-DD` used to dedupe one weekly_report job per user per week. */
export const weeklyReportWeekStartSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart must be YYYY-MM-DD');

export const weeklyReportJobPayloadSchema = z.object({
  weekStart: weeklyReportWeekStartSchema,
});
export type WeeklyReportJobPayload = z.infer<typeof weeklyReportJobPayloadSchema>;

export function weeklyReportJobPayloadFrom(
  payload: JobPayload,
): WeeklyReportJobPayload | undefined {
  const parsed = weeklyReportJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

/** Local date `YYYY-MM-DD` used to dedupe one annotation_resurface job per user per day. */
export const annotationResurfaceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const annotationResurfaceJobPayloadSchema = z.object({
  date: annotationResurfaceDateSchema,
});
export type AnnotationResurfaceJobPayload = z.infer<typeof annotationResurfaceJobPayloadSchema>;

export function annotationResurfaceJobPayloadFrom(
  payload: JobPayload,
): AnnotationResurfaceJobPayload | undefined {
  const parsed = annotationResurfaceJobPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const listJobsQuerySchema = paginationQuerySchema.extend({
  status: z.preprocess(emptyToUndef, jobStatusSchema.optional()),
  type: z.preprocess(emptyToUndef, jobTypeSchema.optional()),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const jobQueueCountsSchema = z.object({
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  doneToday: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type JobQueueCounts = z.infer<typeof jobQueueCountsSchema>;

export const jobQueueSchema = z.object({
  running: z.array(jobSchema),
  pending: z.array(jobSchema),
  counts: jobQueueCountsSchema,
});
export type JobQueue = z.infer<typeof jobQueueSchema>;

export const jobUsageDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tokens: z.number().int().nonnegative(),
});
export type JobUsageDay = z.infer<typeof jobUsageDaySchema>;

export const jobUsageByTypeSchema = z.object({
  type: z.string().min(1),
  tokens: z.number().int().nonnegative(),
});
export type JobUsageByType = z.infer<typeof jobUsageByTypeSchema>;

export const jobUsageSchema = z.object({
  daily: z.array(jobUsageDaySchema),
  byType: z.array(jobUsageByTypeSchema),
  total: z.number().int().nonnegative(),
});
export type JobUsage = z.infer<typeof jobUsageSchema>;
