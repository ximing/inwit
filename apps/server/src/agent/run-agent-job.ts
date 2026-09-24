import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentExecutionStep, AgentExecutionTurn, AgentTurnPhase, AgentType } from '@inwit/dto';
import type { JobRow } from '../db/schema.js';
import { heartbeatJob, isJobRunning } from '../jobs/heartbeat.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { logLlmUsage } from '../llm/usage.js';
import { logger } from '../utils/logger.js';
import { finishExecution, measureValue, saveExecutionSteps, saveExecutionTurns, startExecution, summarizeValue } from './executions.js';
import { auditMemoryToolPayload, auditMemoryToolValue, isMemoryAuditTool } from './memory-audit-logic.js';
import { extractAssistantText, isAssistantMessage } from './messages.js';
import { runWithAgentContext, type AgentRunContext } from './run-context.js';
import { AgentTerminalError } from './terminal-error.js';
import { outputLimitSummary, summarizeAssistantTurn } from './turn-audit-logic.js';

export { AgentTerminalError } from './terminal-error.js';

const RUN_TIMEOUT_MS = 600_000;
const HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_TURNS = 24;
const CLOSING_TAIL_MAX = 300;

/** The model's closing prose (truncated) — recorded when verify fails, so
 * "只说不做" failures show what the model said instead of calling tools. */
function closingTextTail(messages: readonly unknown[], max = CLOSING_TAIL_MAX): string | null {
  const text = extractAssistantText(messages).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const tail = text.length > max ? text.slice(-max) : text;
  return text.length > max ? `…${tail}` : tail;
}

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
  /**
   * Sent once when the agent loop ends normally but verify fails — gives the
   * model one chance to finish the job in the same conversation (it still has
   * the document in context) instead of failing the run outright.
   */
  nudgePrompt?: string | ((err: unknown) => string);
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
  const turns: AgentExecutionTurn[] = [];
  let phase: AgentTurnPhase = 'run';
  let closingTail: string | null = null;

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
        const maxTokens = typeof resolved.model.maxTokens === 'number' ? resolved.model.maxTokens : null;
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
            // Load/search keep the detailed projection. Organize tools use the shared walker.
            const project = (value: unknown, kind: 'args' | 'result') =>
              isMemoryAuditTool(event.toolName)
                ? auditMemoryToolPayload(event.toolName, value, kind, event.isError)
                : auditMemoryToolValue(event.toolName, value);
            const inputValue = project(started?.args, 'args');
            const outputValue = project(event.result, 'result');
            steps.push({
              tool: event.toolName,
              input_summary: summarizeValue(inputValue),
              output_summary: event.isError
                ? `error: ${summarizeValue(outputValue)}`
                : summarizeValue(outputValue),
              output_chars: measureValue(event.result),
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
            const turn = summarizeAssistantTurn({
              phase,
              index: turns.length,
              maxTokens,
              message: event.message,
            });
            turns.push(turn);
            logger.info('agent.turn', {
              jobId: job.id,
              executionId,
              agentType: run.agentType,
              turn,
            });
            await saveExecutionTurns(executionId, turns);
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

        let cancelled = false;
        const heartbeat = setInterval(() => {
          void heartbeatJob(job.id);
          // Cooperative cancellation: deleting a document (or a manual job
          // cancel) flips the row out of 'running'; abort the agent instead
          // of burning model calls on output nobody can use.
          void isJobRunning(job.id).then((running) => {
            if (!running && !cancelled) {
              cancelled = true;
              logger.info('agent.run_cancelled', { jobId: job.id, agentType: run.agentType });
              agent.abort();
            }
          });
        }, HEARTBEAT_MS);
        heartbeat.unref();
        const runPrompt = async (prompt: string) => {
          const timer = setTimeout(() => {
            agent.abort();
          }, RUN_TIMEOUT_MS);
          try {
            await agent.prompt(prompt);
          } finally {
            clearTimeout(timer);
          }
        };
        try {
          await runPrompt(run.userPrompt);

          const assistant = agent.state.messages.filter(isAssistantMessage);
          const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
          if (failed) {
            // Salvage: a timed-out run may already have produced its output
            // (cards written, answer given). Verify against the domain state
            // before failing — a passing verify settles the job as done.
            // A cancelled run never salvages: the job row is already settled
            // as cancelled, so there is nothing to rescue.
            if (failed.stopReason === 'aborted' && run.verify && !cancelled) {
              try {
                const salvaged = await run.verify({ agent, executionId });
                await finishExecution({
                  executionId,
                  status: 'done',
                  resultSummary: salvaged !== null ? `${salvaged} salvaged=1` : 'salvaged=1',
                });
                logger.info('agent.run_salvaged', { jobId: job.id, agentType: run.agentType });
                return;
              } catch {
                // Output didn't pass verification — fall through to the timeout
                // error, which stays retryable.
              }
            }
            throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');
          }

          const verifyOnce = async () => (await run.verify?.({ agent, executionId })) ?? null;
          let resultSummary: string | null;
          try {
            try {
              resultSummary = await verifyOnce();
            } catch (firstErr) {
              if (cancelled) throw firstErr;
              const nudge =
                run.nudgePrompt === undefined
                  ? null
                  : typeof run.nudgePrompt === 'function'
                    ? run.nudgePrompt(firstErr)
                    : run.nudgePrompt;
              if (!nudge) throw firstErr;
              logger.info('agent.verify_nudge', {
                jobId: job.id,
                agentType: run.agentType,
                error: firstErr instanceof Error ? firstErr.message : String(firstErr),
              });
              phase = 'nudge';
              await runPrompt(nudge);
              const nudgedFail = agent.state.messages
                .filter(isAssistantMessage)
                .find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
              if (nudgedFail) throw modelResponseError(nudgedFail.stopReason, nudgedFail.errorMessage ?? '');
              resultSummary = await verifyOnce();
            }
          } catch (err) {
            closingTail = closingTextTail(agent.state.messages);
            throw err;
          }
          await finishExecution({ executionId, status: 'done', resultSummary });
        } finally {
          clearInterval(heartbeat);
          unsubscribe();
        }
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const audit: string[] = [];
    if (err instanceof AgentTerminalError && err.resultSummary !== null) {
      audit.push(err.resultSummary);
    } else if (steps.length > 0) {
      audit.push(`steps=${String(steps.length)}`);
    }
    const limit = outputLimitSummary(turns);
    if (limit) audit.push(limit);
    if (closingTail) audit.push(`tail=${closingTail}`);
    await finishExecution({
      executionId,
      status: 'failed',
      error: message.slice(0, 2000),
      resultSummary: audit.length > 0 ? audit.join(' ') : null,
    });
    throw err;
  }
}
