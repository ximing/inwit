import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import {
  evolveAnalyzeJobPayloadFrom,
  evolveJobPayloadFrom,
  type AgentExecutionStep,
  type EvolveReason,
} from '@inwit/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardQuestions, cards, reviewStates, type CardRow, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { logLlmUsage } from '../llm/usage.js';
import { logger } from '../utils/logger.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { processAnalyzePatterns } from './analyze.js';
import { addedQuestionIsNewAngle, evolveResultSummary } from './evolve-logic.js';
import { evolveTools, loadSplitChildren, type EvolveSession } from './evolve-tools.js';
import { isAssistantMessage } from './messages.js';
import { EVOLVE_SYSTEM_PROMPT, evolveUserPrompt } from './prompts.js';
import { runWithAgentContext } from './run-context.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 24;

export class EvolveTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'EvolveTerminalError';
  }
}

async function loadOwnedCard(userId: string, cardId: string): Promise<CardRow | null> {
  const [row] = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function loadQuestions(cardIds: string[]) {
  if (cardIds.length === 0) return [];
  return getDb()
    .select()
    .from(cardQuestions)
    .where(inArray(cardQuestions.cardId, cardIds));
}

async function countAddedQuestions(
  cardIds: string[],
  preexistingIds: Set<string>,
): Promise<{ added: number; addedTypes: string[]; allTypes: string[] }> {
  const questions = await loadQuestions(cardIds);
  const added = questions.filter((row) => !preexistingIds.has(row.id));
  return {
    added: added.length,
    addedTypes: added.map((row) => row.type),
    allTypes: questions.map((row) => row.type),
  };
}

async function childrenHaveQuestionsAndDue(userId: string, childIds: string[]): Promise<boolean> {
  if (childIds.length === 0) return false;
  const questionRows = await loadQuestions(childIds);
  const withQuestion = new Set(questionRows.map((row) => row.cardId));
  if (childIds.some((id) => !withQuestion.has(id))) return false;
  const states = await getDb()
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), inArray(reviewStates.cardId, childIds)));
  const now = Date.now();
  const dueByCard = new Map(states.map((row) => [row.cardId, row.dueAt]));
  return childIds.every((id) => {
    const due = dueByCard.get(id);
    return due !== undefined && due.getTime() > now;
  });
}

export async function processEvolve(job: JobRow): Promise<void> {
  if (evolveAnalyzeJobPayloadFrom(job.payload)) {
    await processAnalyzePatterns(job);
    return;
  }
  const payload = evolveJobPayloadFrom(job.payload);
  if (!payload) {
    throw new EvolveTerminalError('evolve job missing cardId/reason');
  }
  const { cardId, reason } = payload;
  logger.info('evolve.start', { jobId: job.id, cardId, reason, userId: job.userId });

  const card = await loadOwnedCard(job.userId, cardId);
  if (!card) {
    logger.warn('evolve.card_missing', { jobId: job.id, cardId });
    throw new EvolveTerminalError('card not found');
  }

  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'evolve',
  });
  const steps: AgentExecutionStep[] = [];
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;
  const persistSteps = () => saveExecutionSteps(executionId, steps);

  const preexistingQuestions = await loadQuestions([cardId]);
  const preexistingIds = new Set(preexistingQuestions.map((row) => row.id));
  const preexistingTypes = preexistingQuestions.map((row) => row.type);

  try {
    await runWithAgentContext(
      {
        userId: job.userId,
        executionId,
        jobId: job.id,
        ...(card.documentId ? { documentId: card.documentId } : {}),
      },
      async () => {
        const resolved = await resolveModelFor(job.userId);
        const session: EvolveSession = {
          userId: job.userId,
          cardId,
          reason,
          documentId: card.documentId,
          writtenCardIds: [],
          writtenQuestionIds: [],
          splitChildIds: [],
          memoryWritten: false,
        };

        const agent = new Agent({
          streamFn: (model, context, options) =>
            resolved.models.streamSimple(model, context, {
              ...options,
              apiKey: resolved.apiKey,
            }),
          getApiKey: () => resolved.apiKey,
          initialState: {
            systemPrompt: EVOLVE_SYSTEM_PROMPT,
            model: resolved.model,
            tools: evolveTools(session),
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
          await agent.prompt(evolveUserPrompt({ cardId, reason }));
        } finally {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          unsubscribe();
        }

        const assistant = agent.state.messages.filter(isAssistantMessage);
        const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
        if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

        await assertEvolveOutcome({
          userId: job.userId,
          cardId,
          reason,
          preexistingIds,
          preexistingTypes,
          session,
        });

        const parentStillThere = await loadOwnedCard(job.userId, cardId);
        if (!parentStillThere) throw new Error('evolve deleted the original card');

        const questionDelta = session.writtenQuestionIds.length;
        const childCount = (await loadSplitChildren(job.userId, cardId)).length;
        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: evolveResultSummary({
            reason,
            questionDelta,
            childCount,
            memoryWritten: session.memoryWritten,
          }),
        });
      },
    );
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

async function assertEvolveOutcome(input: {
  userId: string;
  cardId: string;
  reason: EvolveReason;
  preexistingIds: Set<string>;
  preexistingTypes: string[];
  session: EvolveSession;
}): Promise<void> {
  if (!input.session.memoryWritten) {
    throw new Error('evolve did not call write_memory');
  }

  if (input.reason === 'fuzzy') {
    const stats = await countAddedQuestions([input.cardId], input.preexistingIds);
    if (!addedQuestionIsNewAngle(input.preexistingTypes, stats.addedTypes)) {
      throw new Error('evolve fuzzy did not add a question with a different type');
    }
    return;
  }

  const children = await loadSplitChildren(input.userId, input.cardId);
  if (children.length < 1 || children.length > 2) {
    throw new Error(`evolve split expected 1-2 child cards, got ${String(children.length)}`);
  }
  const childIds = children.map((child) => child.id);
  const parent = await loadOwnedCard(input.userId, input.cardId);
  if (!parent) throw new Error('original card missing after split');
  for (const child of children) {
    if (child.documentId !== parent.documentId) {
      throw new Error('split child document_id mismatch');
    }
    if (child.source !== 'agent') {
      throw new Error('split child source must be agent');
    }
  }
  const ok = await childrenHaveQuestionsAndDue(input.userId, childIds);
  if (!ok) {
    throw new Error('split children must each have a question and a future due date');
  }
}
