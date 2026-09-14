import type { LlmCapability } from '@inwit/dto';
import { getDb } from '../db/index.js';
import { llmUsageLogs } from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  completeResolved,
  resolveModelFor,
  type CompleteChatInput,
  type ResolvedModel,
} from './pi.js';

export async function logLlmUsage(entry: {
  userId: string;
  executionId?: string | null;
  provider: string;
  model: string;
  capability: LlmCapability;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costEstimate?: number;
}): Promise<void> {
  try {
    await getDb()
      .insert(llmUsageLogs)
      .values({
        userId: entry.userId,
        executionId: entry.executionId ?? null,
        provider: entry.provider,
        model: entry.model,
        capability: entry.capability,
        promptTokens: entry.promptTokens ?? 0,
        completionTokens: entry.completionTokens ?? 0,
        totalTokens: entry.totalTokens ?? 0,
        costEstimate: entry.costEstimate ?? 0,
      });
  } catch (err) {
    // Usage must not mask the original LLM error.
    console.error('llm.usage.log_failed', err);
  }
}

export async function completeChat(
  userId: string,
  input: CompleteChatInput,
  opts: { resolved?: ResolvedModel; executionId?: string | null } = {},
): Promise<{ text: string; promptTokens: number; completionTokens: number; totalTokens: number; costEstimate: number }> {
  const resolved = opts.resolved ?? (await resolveModelFor(userId));
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let costEstimate = 0;
  try {
    const result = await completeResolved(resolved, input);
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
    totalTokens = result.totalTokens;
    costEstimate = result.costEstimate;
    return result;
  } catch (err) {
    throw err instanceof AppError ? err : AppError.of(502, 'LLM_UNAVAILABLE');
  } finally {
    await logLlmUsage({
      userId,
      executionId: opts.executionId ?? null,
      provider: resolved.provider,
      model: resolved.modelId,
      capability: 'chat',
      promptTokens,
      completionTokens,
      totalTokens,
      costEstimate,
    });
  }
}
