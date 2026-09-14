import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import { weeklyReportJobPayloadFrom, type AgentExecutionStep } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { logLlmUsage } from '../llm/usage.js';
import { loadUserMasteryMemory } from '../review/mastery-memory.js';
import { logger } from '../utils/logger.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { isAssistantMessage } from './messages.js';
import { WEEKLY_SYSTEM_PROMPT, weeklyUserPrompt } from './prompts.js';
import { runWithAgentContext } from './run-context.js';
import {
  parseWeeklyReportMemory,
  startOfWeekMonday,
  weeklyReportMemoryKey,
  weeklyResultSummary,
} from './weekly-logic.js';
import { createWeeklySession, loadWeekStats, weeklyTools, type WeeklySession } from './weekly-tools.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 16;

export class WeeklyTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'WeeklyTerminalError';
  }
}

function sessionFromJob(job: JobRow): WeeklySession {
  const payload = weeklyReportJobPayloadFrom(job.payload);
  const now = new Date();
  if (!payload) return createWeeklySession(job.userId, now);
  const [y, m, d] = payload.weekStart.split('-').map((part) => Number(part));
  if (!y || !m || !d) return createWeeklySession(job.userId, now);
  const pinned = new Date(y, m - 1, d, 12, 0, 0);
  return createWeeklySession(job.userId, startOfWeekMonday(pinned));
}

export async function processWeeklyReport(job: JobRow): Promise<void> {
  const session = sessionFromJob(job);
  logger.info('weekly.start', {
    jobId: job.id,
    userId: job.userId,
    weekStart: session.weekStart,
  });

  const stats = await loadWeekStats(session);
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'weekly_report',
  });
  const steps: AgentExecutionStep[] = [];
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;
  const persistSteps = () => saveExecutionSteps(executionId, steps);

  try {
    await runWithAgentContext({ userId: job.userId, executionId, jobId: job.id }, async () => {
      const resolved = await resolveModelFor(job.userId);
      const agent = new Agent({
        streamFn: (model, context, options) =>
          resolved.models.streamSimple(model, context, {
            ...options,
            apiKey: resolved.apiKey,
          }),
        getApiKey: () => resolved.apiKey,
        initialState: {
          systemPrompt: WEEKLY_SYSTEM_PROMPT,
          model: resolved.model,
          tools: weeklyTools(session),
        },
        shouldStopAfterTurn: () => {
          turnCount += 1;
          return turnCount >= MAX_TURNS;
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
          await persistSteps();
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
      }, 15_000);
      heartbeat.unref();
      try {
        await agent.prompt(weeklyUserPrompt({ weekStart: session.weekStart, weekEnd: session.weekEnd }));
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        unsubscribe();
      }

      const assistant = agent.state.messages.filter(isAssistantMessage);
      const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
      if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

      await assertWeeklyOutcome(job.userId, session);

      await finishExecution({
        executionId,
        status: 'done',
        resultSummary: weeklyResultSummary({
          document: session.wroteDocument,
          memory: session.memoryWritten,
          relearn: stats.relearn.length,
          reviews: stats.reviews.total,
        }),
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishExecution({
      executionId,
      status: 'failed',
      error: message.slice(0, 2000),
      resultSummary: steps.length > 0 ? `steps=${String(steps.length)}` : null,
    });
    throw err;
  }
}

async function assertWeeklyOutcome(userId: string, session: WeeklySession): Promise<void> {
  if (!session.wroteDocument || !session.documentId) {
    throw new Error('weekly report did not write a document');
  }
  const [doc] = await getDb()
    .select({ id: documents.id, source: documents.source, title: documents.title, contentMd: documents.contentMd })
    .from(documents)
    .where(and(eq(documents.id, session.documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!doc) throw new Error('weekly report document missing');
  if (doc.source !== 'agent') throw new Error('weekly report document source must be agent');
  if (!doc.title.includes('学习复盘')) throw new Error('weekly report title must include 学习复盘');
  if (!/想起来了/.test(doc.contentMd) || !/模糊/.test(doc.contentMd) || !/忘了/.test(doc.contentMd)) {
    throw new Error('weekly report document missing 三档分布');
  }
  const stats = session.stats;
  if (stats && stats.relearn.length > 0) {
    const missing = stats.relearn.filter((item) => !doc.contentMd.includes(`/cards/${item.cardId}`));
    if (missing.length > 0) {
      throw new Error('weekly report document missing card links for relearn concepts');
    }
  }
  const memory = await loadUserMasteryMemory(
    getDb(),
    userId,
    weeklyReportMemoryKey(session.weekStart),
  );
  const parsed = parseWeeklyReportMemory(memory?.content);
  if (!parsed.documentId) throw new Error('weekly report did not write memory');
}
