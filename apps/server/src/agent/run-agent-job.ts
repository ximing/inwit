import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentExecutionStep, AgentType } from '@inwit/dto';
import type { JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { logLlmUsage } from '../llm/usage.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { isAssistantMessage } from './messages.js';
import { runWithAgentContext, type AgentRunContext } from './run-context.js';
import { AgentTerminalError } from './terminal-error.js';

export { AgentTerminalError } from './terminal-error.js';

const RUN_TIMEOUT_MS = 180_000;
const HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_TURNS = 24;

export interface AgentJobRun {
  job: JobRow;
  agentType: AgentType;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  maxTurns?: number;
  /** Extra AsyncLocalStorage context fields (documentId / topicId). */
  context?: Partial<Pick<AgentRunContext, 'documentId' | 'topicId'>> | undefined;
  /**
   * Runs inside the agent context before the agent loop. Return a result
   * summary to finish the execution as done without running the agent.
   */
  beforeRun?: () => string | void | Promise<string | void>;
  /**
   * Runs after a successful agent loop; return the done result summary.
   * Throw to fail the execution (AgentTerminalError carries its own summary).
   */
  verify?: (input: { agent: Agent; executionId: string }) => Promise<string | null>;
}

/**
 * Runs one agent job end to end: execution bookkeeping, model resolution,
 * step/usage recording, timeout + heartbeat, and terminal-error classification.
 * Callers supply only the domain pieces (prompts, tools, outcome verification).
 */
export async function runAgentJob(run: AgentJobRun): Promise<void> {
  const { job } = run;
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: run.agentType,
  });
  const steps: AgentExecutionStep[] = [];

  try {
    await runWithAgentContext(
      {
        userId: job.userId,
        executionId,
        jobId: job.id,
        ...(run.context?.documentId ? { documentId: run.context.documentId } : {}),
        ...(run.context?.topicId ? { topicId: run.context.topicId } : {}),
      },
      async () => {
        const early = await run.beforeRun?.();
        if (typeof early === 'string') {
          await finishExecution({ executionId, status: 'done', resultSummary: early });
          return;
        }

        const resolved = await resolveModelFor(job.userId);
        const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
        const maxTurns = run.maxTurns ?? DEFAULT_MAX_TURNS;
        let turnCount = 0;

        const agent = new Agent({
          streamFn: (model, context, options) =>
            resolved.models.streamSimple(model, context, {
              ...options,
              apiKey: resolved.apiKey,
            }),
          getApiKey: () => resolved.apiKey,
          initialState: {
            systemPrompt: run.systemPrompt,
            model: resolved.model,
            tools: run.tools,
          },
          shouldStopAfterTurn: () => {
            turnCount += 1;
            return turnCount >= maxTurns;
          },
          toolExecution: 'sequential',
        });

        const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
          if (event.type === 'tool_execution_start') {
            toolStarted.set(event.toolCallId, {
              name: event.toolName,
              args: event.args,
              t: Date.now(),
            });
            return;
          }
          if (event.type === 'tool_execution_end') {
            const started = toolStarted.get(event.toolCallId);
            steps.push({
              tool: event.toolName,
              input_summary: summarizeValue(started?.args),
              output_summary: event.isError
                ? `error: ${summarizeValue(event.result)}`
                : summarizeValue(event.result),
              duration_ms: started ? Math.max(0, Date.now() - started.t) : 0,
            });
            await saveExecutionSteps(executionId, steps);
            await heartbeatJob(job.id);
            return;
          }
          if (event.type === 'message_end' && isAssistantMessage(event.message)) {
            const usage = event.message.usage;
            const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
            const completionTokens = usage.output;
            await logLlmUsage({
              userId: job.userId,
              executionId,
              provider: resolved.provider,
              model: resolved.modelId,
              capability: 'chat',
              promptTokens,
              completionTokens,
              totalTokens: usage.totalTokens || promptTokens + completionTokens,
              costEstimate: usage.cost.total,
            });
            await heartbeatJob(job.id);
          }
        });

        const timeout = setTimeout(() => {
          agent.abort();
        }, RUN_TIMEOUT_MS);
        const heartbeat = setInterval(() => {
          void heartbeatJob(job.id);
        }, HEARTBEAT_MS);
        heartbeat.unref();
        try {
          await agent.prompt(run.userPrompt);
        } finally {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          unsubscribe();
        }

        const assistant = agent.state.messages.filter(isAssistantMessage);
        const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
        if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

        const resultSummary = (await run.verify?.({ agent, executionId })) ?? null;
        await finishExecution({ executionId, status: 'done', resultSummary });
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishExecution({
      executionId,
      status: 'failed',
      error: message.slice(0, 2000),
      resultSummary:
        err instanceof AgentTerminalError && err.resultSummary !== null
          ? err.resultSummary
          : steps.length > 0
            ? `steps=${String(steps.length)}`
            : null,
    });
    throw err;
  }
}
