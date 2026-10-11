import { z } from 'zod';
import { optionalBaseUrlSchema } from './common.js';

/** Chat providers a user can save. Official endpoints are OpenAI-compatible except Claude. */
export const LLM_PROVIDERS = [
  'openai',
  'deepseek',
  'claude',
  'gemini',
  'xai',
  'mistral',
  'zhipu',
  'dashscope',
  'kimi',
  'minimax',
  'doubao',
  'groq',
  'openrouter',
] as const;
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  gemini: 'Gemini',
  xai: 'Grok',
  mistral: 'Mistral',
  zhipu: '智谱',
  dashscope: '通义百炼',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  doubao: '豆包',
  groq: 'Groq',
  openrouter: 'OpenRouter',
};

/** Filled in when the user picks a provider and has not typed their own model id. */
export const PROVIDER_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  xai: 'grok-4.7',
  mistral: 'mistral-small-latest',
  zhipu: 'glm-4',
  dashscope: 'qwen-plus',
  kimi: 'kimi-k3',
  minimax: 'MiniMax-M2.7',
  doubao: 'doubao-seed-2-1-pro-260628',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'google/gemini-2.5-flash',
};

/** Kimi's OpenAI-compatible chat models on https://api.moonshot.cn/v1. */
export const KIMI_MODELS = ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'] as const;

/** Suggestions for the model field. A single entry stays a plain text input. */
export const PROVIDER_MODEL_OPTIONS: Record<LlmProvider, readonly string[]> = {
  openai: ['gpt-4o-mini'],
  deepseek: ['deepseek-chat'],
  claude: ['claude-sonnet-4-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.8-flash'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3'],
  mistral: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'codestral-latest'],
  zhipu: ['glm-4'],
  dashscope: ['qwen-plus'],
  kimi: KIMI_MODELS,
  minimax: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3'],
  doubao: ['doubao-seed-2-1-pro-260628', 'doubao-seed-1-6-251015'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3.6-27b'],
  openrouter: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
};

/**
 * Official base URL when the user leaves the field empty.
 * OpenAI-compatible roots include the path the client appends `/chat/completions` to.
 */
export const PROVIDER_BASE_URLS: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimaxi.com/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

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
  baseUrl: optionalBaseUrlSchema,
});
export type CreateLlmConfigInput = z.infer<typeof createLlmConfigInputSchema>;

export const updateLlmConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(512).optional(),
  model: z.string().min(1).max(128).optional(),
  baseUrl: optionalBaseUrlSchema,
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
