import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import type { AgentExecutionStep } from '@inwit/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardQuestions, cards, reviewStates, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { logLlmUsage } from '../llm/usage.js';
import { logger } from '../utils/logger.js';
import {
  ANALYZE_MAX_CARDS,
  ANALYZE_MIN_CARDS,
  analyzeResultSummary,
  confusableMemoryKey,
  eligibleContrastPairs,
} from './analyze-logic.js';
import {
  analyzeTools,
  createAnalyzeSession,
  loadConfusableMemories,
  loadStrugglingCards,
  type AnalyzeSession,
} from './analyze-tools.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { isAssistantMessage } from './messages.js';
import { ANALYZE_SYSTEM_PROMPT, analyzeUserPrompt } from './prompts.js';
import { runWithAgentContext } from './run-context.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 24;

export async function processAnalyzePatterns(job: JobRow): Promise<void> {
  logger.info('evolve.analyze.start', { jobId: job.id, userId: job.userId });

  const struggling = await loadStrugglingCards(job.userId);
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'evolve',
  });
  const steps: AgentExecutionStep[] = [];

  if (struggling.length < 2) {
    await finishExecution({
      executionId,
      status: 'done',
      resultSummary: analyzeResultSummary({
        skipped: 'too_few',
        struggling: struggling.length,
        pairs: 0,
        document: false,
        cards: 0,
        memory: 0,
      }),
    });
    return;
  }

  const session = createAnalyzeSession(job.userId);
  const persistSteps = () => saveExecutionSteps(executionId, steps);
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;

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
          systemPrompt: ANALYZE_SYSTEM_PROMPT,
          model: resolved.model,
          tools: analyzeTools(session),
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
        await agent.prompt(analyzeUserPrompt());
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        unsubscribe();
      }

      const assistant = agent.state.messages.filter(isAssistantMessage);
      const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
      if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

      await assertAnalyzeOutcome(job.userId, session, struggling.map((card) => card.id));

      await finishExecution({
        executionId,
        status: 'done',
        resultSummary: analyzeResultSummary({
          ...(session.skippedDocument && !session.wroteDocument ? { skipped: 'cooldown' as const } : {}),
          struggling: struggling.length,
          pairs: session.linkedPairKeys.length || session.memoryKeys.length,
          document: session.wroteDocument,
          cards: session.digest.writtenCardIds.length,
          memory: session.memoryKeys.length,
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

async function assertAnalyzeOutcome(
  userId: string,
  session: AnalyzeSession,
  strugglingIds: string[],
): Promise<void> {
  const memories = await loadConfusableMemories(userId);
  const cooldownKeys = new Set(memories.filter((row) => row.onCooldown).map((row) => row.key));
  const eligible = eligibleContrastPairs(strugglingIds, cooldownKeys);

  if (session.wroteDocument) {
    await assertContrastCards(userId, session);
    return;
  }

  if (session.skippedDocument || eligible.length === 0) return;

  if (!session.memoryWritten) {
    throw new Error('analyze did not call write_memory');
  }
  throw new Error('analyze did not write a contrast document');
}

async function assertContrastCards(userId: string, session: AnalyzeSession): Promise<void> {
  const documentId = session.digest.documentId;
  if (!documentId) throw new Error('analyze wrote a document but session has no documentId');
  const childCards = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId)));
  if (childCards.length < ANALYZE_MIN_CARDS || childCards.length > ANALYZE_MAX_CARDS) {
    throw new Error(
      `analyze contrast doc expected ${String(ANALYZE_MIN_CARDS)}-${String(ANALYZE_MAX_CARDS)} cards, got ${String(childCards.length)}`,
    );
  }
  const childIds = childCards.map((row) => row.id);
  const [questionRows, stateRows] = await Promise.all([
    getDb().select().from(cardQuestions).where(inArray(cardQuestions.cardId, childIds)),
    getDb()
      .select()
      .from(reviewStates)
      .where(and(eq(reviewStates.userId, userId), inArray(reviewStates.cardId, childIds))),
  ]);
  const questionsByCard = new Map<string, typeof questionRows>();
  for (const row of questionRows) {
    const list = questionsByCard.get(row.cardId) ?? [];
    list.push(row);
    questionsByCard.set(row.cardId, list);
  }
  const stateByCard = new Set(stateRows.map((row) => row.cardId));
  for (const card of childCards) {
    if (card.source !== 'agent') throw new Error('contrast card source must be agent');
    const qs = questionsByCard.get(card.id) ?? [];
    if (qs.length < 1) throw new Error('contrast cards must each have a question');
    if (qs.some((q) => q.type !== 'compare' && q.type !== 'judge')) {
      throw new Error('contrast questions must be compare or judge');
    }
    if (!stateByCard.has(card.id)) throw new Error('contrast cards must have review_states');
  }
  if (session.pairCardIds) {
    const key = confusableMemoryKey(session.pairCardIds[0], session.pairCardIds[1]);
    if (!session.memoryKeys.includes(key)) {
      throw new Error('analyze did not write confusable memory for the contrast pair');
    }
  }
}
