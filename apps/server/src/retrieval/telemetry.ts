import { logLlmUsage } from '../llm/usage.js';
import { currentAgentRun } from '../agent/run-context.js';
import { logger } from '../utils/logger.js';

export interface RetrievalTelemetryOptions {
  userId: string | undefined;
  capability: 'embed' | 'rerank';
  model: string;
  provider?: string;
}

/**
 * Best-effort usage accounting for DashScope retrieval calls.
 * Never breaks the retrieval call if logging fails.
 */
export async function withRetrievalTelemetry<T>(
  opts: RetrievalTelemetryOptions,
  run: () => Promise<{ result: T; promptTokens: number }>,
): Promise<T> {
  try {
    const { result, promptTokens } = await run();
    if (opts.userId) {
      const executionId = currentAgentRun()?.executionId ?? null;
      await logLlmUsage({
        userId: opts.userId,
        executionId,
        provider: opts.provider ?? 'dashscope',
        model: opts.model,
        capability: opts.capability,
        promptTokens,
        completionTokens: 0,
        totalTokens: promptTokens,
      });
    }
    return result;
  } catch (err) {
    if (opts.userId) {
      try {
        await logLlmUsage({
          userId: opts.userId,
          executionId: currentAgentRun()?.executionId ?? null,
          provider: opts.provider ?? 'dashscope',
          model: opts.model,
          capability: opts.capability,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
      } catch (logErr) {
        logger.debug('retrieval.telemetry.log_failed', { err: String(logErr) });
      }
    }
    throw err;
  }
}
