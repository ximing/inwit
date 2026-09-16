import { z } from 'zod';

export const LLM_PROVIDERS = ['openai', 'deepseek', 'claude', 'zhipu', 'dashscope'] as const;
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const LLM_CAPABILITIES = ['chat', 'embed', 'rerank', 'ocr'] as const;
export const llmCapabilitySchema = z.enum(LLM_CAPABILITIES);
export type LlmCapability = z.infer<typeof llmCapabilitySchema>;

/** Public LLM config — encrypted key never leaves the server. */
export const llmConfigSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: llmProviderSchema,
  model: z.string().min(1).max(128),
  isDefault: z.boolean(),
  baseUrl: z.string().max(512).nullable(),
  /** First 6 chars of the key + ****. Never the full secret. */
  apiKeyPreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LlmConfig = z.infer<typeof llmConfigSchema>;

export const createLlmConfigInputSchema = z.object({
  provider: llmProviderSchema,
  apiKey: z.string().min(1).max(512),
  model: z.string().min(1).max(128),
  isDefault: z.boolean().optional(),
  baseUrl: z.string().url().max(512).nullable().optional(),
});
export type CreateLlmConfigInput = z.infer<typeof createLlmConfigInputSchema>;

export const updateLlmConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(512).optional(),
  model: z.string().min(1).max(128).optional(),
  baseUrl: z.string().url().max(512).nullable().optional(),
});
export type UpdateLlmConfigInput = z.infer<typeof updateLlmConfigInputSchema>;

export const llmTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type LlmTestResult = z.infer<typeof llmTestResultSchema>;

export const llmUsageLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  executionId: z.string().uuid().nullable(),
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(128),
  capability: llmCapabilitySchema,
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costEstimate: z.number(),
  createdAt: z.string(),
});
export type LlmUsageLog = z.infer<typeof llmUsageLogSchema>;
