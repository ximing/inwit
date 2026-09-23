import {
  contentText,
  createModels,
  createProvider,
  type Api,
  type Context,
  type Model,
  type MutableModels,
  type Provider,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import type { LlmProvider } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { llmConfigs, type LlmConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { decryptSecret } from './crypto.js';
import { resolveModelLimits } from './model-limits-logic.js';

export const DASHSCOPE_COMPATIBLE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DASHSCOPE_FALLBACK_MODEL = 'qwen-plus';

const DEFAULT_BASE_URL: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  claude: 'https://api.anthropic.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  dashscope: DASHSCOPE_COMPATIBLE_BASE_URL,
};

const COMPLETE_TIMEOUT_MS = 60_000;

function dummyApiKeyAuth(name: string) {
  return {
    name,
    resolve: () => Promise.resolve({ auth: {} }),
  };
}

function openaiCompatModel(
  providerId: LlmProvider,
  modelId: string,
  baseUrl: string,
): Model<'openai-completions'> {
  const limits = resolveModelLimits(modelId);
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxOutputTokens,
  };
}

function openaiCompatProvider(
  providerId: LlmProvider,
  modelId: string,
  baseUrl: string,
): Provider {
  return createProvider({
    id: providerId,
    name: providerId,
    baseUrl,
    auth: { apiKey: dummyApiKeyAuth(`${providerId} API key`) },
    models: [openaiCompatModel(providerId, modelId, baseUrl)],
    api: openAICompletionsApi(),
  });
}

function claudeProvider(modelId: string, baseUrl: string): Provider {
  const source = anthropicProvider();
  const known = source.getModels();
  const template = known.find((item) => item.id === modelId) ?? known[0];
  const model: Model<Api> = template
    ? {
        ...template,
        id: modelId,
        name: modelId,
        provider: 'claude',
        baseUrl: baseUrl || template.baseUrl,
      }
    : {
        id: modelId,
        name: modelId,
        api: 'anthropic-messages',
        provider: 'claude',
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192,
      };
  return {
    ...source,
    id: 'claude',
    name: 'Claude',
    getModels: () => [model],
  };
}

function buildProvider(providerId: LlmProvider, modelId: string, baseUrl: string): Provider {
  if (providerId === 'claude') return claudeProvider(modelId, baseUrl);
  return openaiCompatProvider(providerId, modelId, baseUrl);
}

export interface ResolvedModel {
  models: MutableModels;
  model: Model<Api>;
  apiKey: string;
  provider: LlmProvider;
  modelId: string;
  source: 'user' | 'system';
  configId: string | null;
}

function resolvedOf(
  provider: LlmProvider,
  modelId: string,
  apiKey: string,
  baseUrl: string | null,
  source: 'user' | 'system',
  configId: string | null,
): ResolvedModel {
  const url = baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URL[provider];
  const piProvider = buildProvider(provider, modelId, url);
  const models = createModels();
  models.setProvider(piProvider);
  const model = models.getModel(piProvider.id, modelId);
  if (!model) throw AppError.of(400, 'LLM_REQUEST_INVALID');
  return { models, model, apiKey, provider, modelId, source, configId };
}

export function resolvedFromRow(row: LlmConfigRow, apiKey: string): ResolvedModel {
  return resolvedOf(row.provider, row.model, apiKey, row.baseUrl, 'user', row.id);
}

export function systemDashscopeModel(): ResolvedModel {
  return resolvedOf(
    'dashscope',
    DASHSCOPE_FALLBACK_MODEL,
    config.DASHSCOPE_API_KEY,
    DASHSCOPE_COMPATIBLE_BASE_URL,
    'system',
    null,
  );
}

/** User default llm_config, or system DashScope (qwen-plus, OpenAI-compatible). */
export async function resolveModelFor(userId: string): Promise<ResolvedModel> {
  const [row] = await getDb()
    .select()
    .from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)))
    .limit(1);
  if (!row) return systemDashscopeModel();
  const apiKey = decryptSecret(row.apiKeyEncrypted);
  if (!apiKey) return systemDashscopeModel();
  return resolvedFromRow(row, apiKey);
}

export function modelResponseError(stopReason: string, detail = ''): AppError {
  if (stopReason === 'aborted') return AppError.of(504, 'LLM_TIMEOUT');
  if (stopReason === 'length') return AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
  if (/\b(401|403)\b|unauthorized|invalid.{0,15}api.?key|authentication failed/i.test(detail)) {
    return AppError.of(401, 'LLM_AUTH_FAILED');
  }
  if (/\b400\b|model.{0,30}not found|unknown model/i.test(detail)) {
    return AppError.of(400, 'LLM_REQUEST_INVALID');
  }
  return AppError.of(502, 'LLM_UNAVAILABLE');
}

export interface CompleteChatInput {
  systemPrompt?: string;
  messages: { role: 'user'; content: string }[];
  timeoutMs?: number;
  maxTokens?: number;
}

export async function completeResolved(
  resolved: ResolvedModel,
  input: CompleteChatInput,
): Promise<{ text: string; promptTokens: number; completionTokens: number; totalTokens: number; costEstimate: number }> {
  const context: Context = {
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    messages: input.messages.map((m) => ({ ...m, timestamp: Date.now() })),
  };
  try {
    const res = await resolved.models.completeSimple(resolved.model, context, {
      apiKey: resolved.apiKey,
      signal: AbortSignal.timeout(input.timeoutMs ?? COMPLETE_TIMEOUT_MS),
      ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
    });
    if (res.stopReason === 'error') throw modelResponseError(res.stopReason, res.errorMessage ?? '');
    if (res.stopReason === 'aborted') throw AppError.of(504, 'LLM_TIMEOUT');
    if (res.stopReason === 'length') throw AppError.of(502, 'LLM_OUTPUT_TRUNCATED');
    const text = contentText(res.content).trim();
    if (!text) throw AppError.of(502, 'LLM_UNAVAILABLE');
    const promptTokens = res.usage.input + res.usage.cacheRead + res.usage.cacheWrite;
    const completionTokens = res.usage.output;
    const totalTokens = res.usage.totalTokens || promptTokens + completionTokens;
    return {
      text,
      promptTokens,
      completionTokens,
      totalTokens,
      costEstimate: res.usage.cost.total,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw AppError.of(504, 'LLM_TIMEOUT');
    }
    const detail = err instanceof Error ? err.message : undefined;
    throw AppError.of(502, 'LLM_UNAVAILABLE', detail);
  }
}
