import { z } from 'zod';
import { agentExecutionStatusSchema, agentExecutionStepSchema, agentTypeSchema } from './agent.js';
import { jobSchema, jobStatusSchema, jobTypeSchema } from './job.js';
import { llmCapabilitySchema } from './llm.js';

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const adminPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminPageQuery = z.infer<typeof adminPageQuerySchema>;

export const listAdminJobsQuerySchema = adminPageQuerySchema.extend({
  status: z.preprocess(emptyToUndef, jobStatusSchema.optional()),
  type: z.preprocess(emptyToUndef, jobTypeSchema.optional()),
});
export type ListAdminJobsQuery = z.infer<typeof listAdminJobsQuerySchema>;

export function pagedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  });
}

export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export const pagedJobsSchema = pagedSchema(jobSchema);
export type PagedJobs = z.infer<typeof pagedJobsSchema>;

export const usageSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type UsageSummaryQuery = z.infer<typeof usageSummaryQuerySchema>;

export const usageTotalsSchema = z.object({
  calls: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costEstimate: z.number(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const usageGroupSchema = usageTotalsSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  capability: llmCapabilitySchema,
});
export type UsageGroup = z.infer<typeof usageGroupSchema>;

export const usageDaySchema = z.object({
  date: z.string().min(1),
  calls: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costEstimate: z.number(),
  chatTokens: z.number().int().nonnegative(),
  embedTokens: z.number().int().nonnegative(),
  rerankTokens: z.number().int().nonnegative(),
  ocrTokens: z.number().int().nonnegative(),
});
export type UsageDay = z.infer<typeof usageDaySchema>;

export const usageSummarySchema = z.object({
  days: z.number().int().positive(),
  from: z.string().min(1),
  to: z.string().min(1),
  totals: usageTotalsSchema.extend({
    byCapability: z.object({
      chat: usageTotalsSchema,
      embed: usageTotalsSchema,
      rerank: usageTotalsSchema,
      ocr: usageTotalsSchema,
    }),
  }),
  byModel: z.array(usageGroupSchema),
  daily: z.array(usageDaySchema),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const listAdminExecutionsQuerySchema = adminPageQuerySchema.extend({
  agentType: z.preprocess(emptyToUndef, agentTypeSchema.optional()),
  status: z.preprocess(emptyToUndef, agentExecutionStatusSchema.optional()),
});
export type ListAdminExecutionsQuery = z.infer<typeof listAdminExecutionsQuerySchema>;

export const adminExecutionListItemSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  userEmail: z.string().min(1),
  agentType: agentTypeSchema,
  status: agentExecutionStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  stepCount: z.number().int().nonnegative(),
  resultSummary: z.string().nullable(),
  error: z.string().nullable(),
  jobType: jobTypeSchema.nullable(),
  documentId: z.string().uuid().nullable(),
  documentPreview: z.string().nullable(),
});
export type AdminExecutionListItem = z.infer<typeof adminExecutionListItemSchema>;

export const adminExecutionDetailSchema = adminExecutionListItemSchema.extend({
  steps: z.array(agentExecutionStepSchema),
});
export type AdminExecutionDetail = z.infer<typeof adminExecutionDetailSchema>;

export const pagedAdminExecutionsSchema = pagedSchema(adminExecutionListItemSchema);
export type PagedAdminExecutions = z.infer<typeof pagedAdminExecutionsSchema>;
