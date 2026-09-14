import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import { TOPIC_SUGGESTION_MIN_DOCS, topicJobPayloadFrom, type AgentExecutionStep } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { logLlmUsage } from '../llm/usage.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import {
  captureTopicMapSnapshot,
  TOPIC_MAP_SNAPSHOT_AFTER,
  TOPIC_MAP_SNAPSHOT_BEFORE,
} from '../maps/snapshot.js';
import { loadUnattributedPool } from '../topics/suggest.js';
import { logger } from '../utils/logger.js';
import {
  cleanupDocumentCards,
  loadDocumentCards,
} from './digest.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { isAssistantMessage } from './messages.js';
import {
  TOPIC_FILL_SYSTEM_PROMPT,
  TOPIC_ORGANIZE_SYSTEM_PROMPT,
  TOPIC_SUGGEST_SYSTEM_PROMPT,
  topicFillUserPrompt,
  topicOrganizeUserPrompt,
  topicSuggestUserPrompt,
} from './prompts.js';
import { runWithAgentContext } from './run-context.js';
import { suggestTools, type SuggestSession } from './suggest-tools.js';
import { fillTools, organizeTools } from './topic-tools.js';
import type { DigestSession } from './tools.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 24;

export class TopicTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'TopicTerminalError';
  }
}

async function markDocument(id: string, status: 'digested' | 'failed'): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status, updatedAt: new Date() })
    .where(eq(documents.id, id));
}

async function runTopicAgent(opts: {
  job: JobRow;
  executionId: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  steps: AgentExecutionStep[];
}): Promise<void> {
  const { job, executionId, systemPrompt, userPrompt, tools, steps } = opts;
  const persistSteps = () => saveExecutionSteps(executionId, steps);
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;

  const resolved = await resolveModelFor(job.userId);
  const agent = new Agent({
    streamFn: (model, context, options) =>
      resolved.models.streamSimple(model, context, {
        ...options,
        apiKey: resolved.apiKey,
      }),
    getApiKey: () => resolved.apiKey,
    initialState: {
      systemPrompt,
      model: resolved.model,
      tools,
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
    await agent.prompt(userPrompt);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    unsubscribe();
  }

  const assistant = agent.state.messages.filter(isAssistantMessage);
  const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
  if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');
}

async function processOrganize(job: JobRow, topicId: string): Promise<void> {
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'topic',
  });
  const steps: AgentExecutionStep[] = [];
  const session: DigestSession = {
    userId: job.userId,
    documentId: '',
    writtenCardIds: [],
    topicId,
  };

  try {
    await runWithAgentContext({ userId: job.userId, executionId, jobId: job.id, topicId }, async () => {
      const before = await captureTopicMapSnapshot({
        userId: job.userId,
        topicId,
        jobId: job.id,
        key: TOPIC_MAP_SNAPSHOT_BEFORE,
      });

      await runTopicAgent({
        job,
        executionId,
        systemPrompt: TOPIC_ORGANIZE_SYSTEM_PROMPT,
        userPrompt: topicOrganizeUserPrompt({ topicId }),
        tools: organizeTools(session),
        steps,
      });

      if (!session.mapUpdated) {
        await finishExecution({
          executionId,
          status: 'failed',
          error: 'organize did not call update_knowledge_map',
          resultSummary: `steps=${String(steps.length)}`,
        });
        throw new TopicTerminalError('organize did not call update_knowledge_map');
      }

      const after = await captureTopicMapSnapshot({
        userId: job.userId,
        topicId,
        jobId: job.id,
        key: TOPIC_MAP_SNAPSHOT_AFTER,
      });

      const dropped = before.attachedCardIds.filter((id) => !after.attachedCardIds.includes(id));
      await finishExecution({
        executionId,
        status: 'done',
        resultSummary: `action=organize nodes=${String(after.nodes.length)} cards_before=${String(before.cardCount)} cards_after=${String(after.cardCount)} dropped=${String(dropped.length)} blank=${String(after.nodes.filter((node) => node.cardIds.length === 0).length)}`,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof TopicTerminalError)) {
      await finishExecution({
        executionId,
        status: 'failed',
        error: message.slice(0, 2000),
        resultSummary: steps.length > 0 ? `steps=${String(steps.length)}` : null,
      });
    }
    throw err;
  }
}

async function processFill(job: JobRow, payload: { topicId: string; nodeId: string; documentId?: string }): Promise<void> {
  const documentId = payload.documentId;
  if (!documentId) throw new Error('fill job missing documentId');

  const [document] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, job.userId)))
    .limit(1);
  if (!document) {
    logger.warn('topic.fill.document_missing', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'topic',
  });
  const steps: AgentExecutionStep[] = [];
  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    topicId: payload.topicId,
    mapNodeId: payload.nodeId,
    dueImmediately: true,
    cardSource: 'agent',
  };

  try {
    await runWithAgentContext(
      {
        userId: job.userId,
        executionId,
        jobId: job.id,
        topicId: payload.topicId,
        documentId,
      },
      async () => {
        await runTopicAgent({
          job,
          executionId,
          systemPrompt: TOPIC_FILL_SYSTEM_PROMPT,
          userPrompt: topicFillUserPrompt({
            topicId: payload.topicId,
            nodeId: payload.nodeId,
            documentId,
          }),
          tools: fillTools(session),
          steps,
        });

        const produced = await loadDocumentCards(job.userId, documentId);
        if (produced.length === 0) {
          await markDocument(documentId, 'failed');
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'fill produced no cards',
            resultSummary: 'cards=0',
          });
          throw new TopicTerminalError('fill produced no cards');
        }
        const missingQuestions = produced.filter((card) => card.questionCount < 1);
        if (missingQuestions.length > 0) {
          throw new Error(`fill missing questions for ${String(missingQuestions.length)} card(s)`);
        }

        await markDocument(documentId, 'digested');
        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: `action=fill node=${payload.nodeId} cards=${String(produced.length)} questions=${String(
            produced.reduce((sum, card) => sum + card.questionCount, 0),
          )}`,
        });
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof TopicTerminalError)) {
      await finishExecution({
        executionId,
        status: 'failed',
        error: message.slice(0, 2000),
        resultSummary: steps.length > 0 ? `steps=${String(steps.length)}` : null,
      });
    }
    throw err;
  }
}

async function processSuggest(job: JobRow): Promise<void> {
  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'topic',
  });
  const steps: AgentExecutionStep[] = [];
  const session: SuggestSession = { userId: job.userId, wroteKey: null };

  try {
    await runWithAgentContext({ userId: job.userId, executionId, jobId: job.id }, async () => {
      const pool = await loadUnattributedPool(job.userId);
      if (pool.documents.length < TOPIC_SUGGESTION_MIN_DOCS) {
        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: `action=suggest skipped=too_few docs=${String(pool.documents.length)}`,
        });
        return;
      }

      await runTopicAgent({
        job,
        executionId,
        systemPrompt: TOPIC_SUGGEST_SYSTEM_PROMPT,
        userPrompt: topicSuggestUserPrompt(),
        tools: suggestTools(session),
        steps,
      });

      await finishExecution({
        executionId,
        status: 'done',
        resultSummary: session.wroteKey
          ? `action=suggest wrote=${session.wroteKey} docs=${String(pool.documents.length)}`
          : `action=suggest wrote=none docs=${String(pool.documents.length)}`,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof TopicTerminalError)) {
      await finishExecution({
        executionId,
        status: 'failed',
        error: message.slice(0, 2000),
        resultSummary: steps.length > 0 ? `steps=${String(steps.length)}` : null,
      });
    }
    throw err;
  }
}

export async function processTopic(job: JobRow): Promise<void> {
  const payload = topicJobPayloadFrom(job.payload);
  if (!payload) throw new Error('topic job missing action');

  if (payload.action === 'suggest') {
    await processSuggest(job);
    return;
  }
  if (payload.action === 'organize') {
    if (!payload.topicId) throw new Error('organize job missing topicId');
    await processOrganize(job, payload.topicId);
    return;
  }
  if (payload.action === 'fill') {
    if (!payload.topicId) throw new Error('fill job missing topicId');
    if (!payload.nodeId) throw new Error('fill job missing nodeId');
    await processFill(job, {
      topicId: payload.topicId,
      nodeId: payload.nodeId,
      ...(payload.documentId ? { documentId: payload.documentId } : {}),
    });
    return;
  }
  const exhaustive: never = payload.action;
  throw new Error(`unknown topic action: ${String(exhaustive)}`);
}
