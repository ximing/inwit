import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import { documentIdFromJobPayload, type AgentExecutionStep } from '@inwit/dto';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  cardLinks,
  cardQuestions,
  cards,
  documents,
  topics,
  type JobRow,
} from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { logLlmUsage } from '../llm/usage.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { deleteCard } from '../retrieval/pipeline.js';
import { maybeEnqueueTopicSuggest } from '../topics/suggest.js';
import { logger } from '../utils/logger.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { isAssistantMessage } from './messages.js';
import { buildAssociationHint } from './anchors.js';
import { ensureDocumentMeta } from './doc-meta.js';
import { DIGEST_SYSTEM_PROMPT, digestUserPrompt } from './prompts.js';
import { runWithAgentContext } from './run-context.js';
import { digestTools, type DigestSession } from './tools.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 24;

export class DigestTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'DigestTerminalError';
  }
}

async function loadDocument(userId: string, documentId: string) {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function listActiveTopics(userId: string) {
  return getDb()
    .select({ id: topics.id, title: topics.title, goal: topics.goal })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, 'active')))
    .orderBy(asc(topics.createdAt));
}

export async function cleanupDocumentCards(userId: string, documentId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId)));
  for (const row of rows) {
    try {
      await deleteCard(row.id);
    } catch (err) {
      logger.warn('digest.cleanup_index_failed', { cardId: row.id, err: String(err) });
    }
  }
  if (rows.length > 0) {
    await getDb()
      .delete(cards)
      .where(
        inArray(
          cards.id,
          rows.map((row) => row.id),
        ),
      );
  }
}

async function markDocument(
  id: string,
  status: 'digested' | 'failed',
  extra?: { linkHint?: string | null },
): Promise<void> {
  await getDb()
    .update(documents)
    .set({
      status,
      updatedAt: new Date(),
      ...(extra && 'linkHint' in extra ? { linkHint: extra.linkHint ?? null } : {}),
    })
    .where(eq(documents.id, id));
}

export async function associationHintForCards(
  userId: string,
  cardIds: string[],
): Promise<string | null> {
  if (cardIds.length === 0) return null;
  const rows = await getDb()
    .select({ concept: cards.concept })
    .from(cardLinks)
    .innerJoin(cards, eq(cards.id, cardLinks.toCardId))
    .where(
      and(
        eq(cardLinks.userId, userId),
        eq(cardLinks.type, 'same_concept'),
        eq(cardLinks.origin, 'agent'),
        inArray(cardLinks.fromCardId, cardIds),
      ),
    );
  return buildAssociationHint(rows.map((row) => row.concept));
}

export async function countOutgoingLinks(userId: string, cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const [row] = await getDb()
    .select({ n: count() })
    .from(cardLinks)
    .where(and(eq(cardLinks.userId, userId), inArray(cardLinks.fromCardId, cardIds)));
  return Number(row?.n ?? 0);
}

export async function loadDocumentCards(userId: string, documentId: string) {
  const cardRows = await getDb()
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId)))
    .orderBy(asc(cards.createdAt), asc(cards.id));
  const questionRows =
    cardRows.length === 0
      ? []
      : await getDb()
          .select()
          .from(cardQuestions)
          .where(
            inArray(
              cardQuestions.cardId,
              cardRows.map((row) => row.id),
            ),
          );
  const questionsByCard = new Map<string, number>();
  for (const row of questionRows) {
    questionsByCard.set(row.cardId, (questionsByCard.get(row.cardId) ?? 0) + 1);
  }
  return cardRows.map((row) => ({
    id: row.id,
    concept: row.concept,
    questionCount: questionsByCard.get(row.id) ?? 0,
  }));
}

export async function processDigest(job: JobRow): Promise<void> {
  const documentId = documentIdFromJobPayload(job.payload);
  if (!documentId) throw new Error('digest job missing documentId');

  const document = await loadDocument(job.userId, documentId);
  if (!document) {
    logger.warn('digest.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (document.status === 'digested') {
    logger.info('digest.already_done', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'digest',
  });
  const steps: AgentExecutionStep[] = [];
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;

  const persistSteps = () => saveExecutionSteps(executionId, steps);

  try {
    await runWithAgentContext(
      { userId: job.userId, executionId, jobId: job.id, documentId },
      async () => {
        const resolved = await resolveModelFor(job.userId);
        const session: DigestSession = {
          userId: job.userId,
          documentId,
          writtenCardIds: [],
          topicId: document.topicId,
        };
        const activeTopics = await listActiveTopics(job.userId);

        const agent = new Agent({
          streamFn: (model, context, options) =>
            resolved.models.streamSimple(model, context, {
              ...options,
              apiKey: resolved.apiKey,
            }),
          getApiKey: () => resolved.apiKey,
          initialState: {
            systemPrompt: DIGEST_SYSTEM_PROMPT,
            model: resolved.model,
            tools: digestTools(session),
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
          await agent.prompt(
            digestUserPrompt({ documentId, topicId: document.topicId, topics: activeTopics }),
          );
        } finally {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          unsubscribe();
        }

        const assistant = agent.state.messages.filter(isAssistantMessage);
        const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
        if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

        const produced = await loadDocumentCards(job.userId, documentId);
        if (produced.length === 0) {
          await markDocument(documentId, 'failed');
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'digest produced no cards',
            resultSummary: 'cards=0',
          });
          throw new DigestTerminalError('digest produced no cards');
        }
        const missingQuestions = produced.filter((card) => card.questionCount < 1);
        if (missingQuestions.length > 0) {
          throw new Error(
            `digest missing questions for ${String(missingQuestions.length)} card(s)`,
          );
        }

        const cardIds = produced.map((card) => card.id);
        const hint = await associationHintForCards(job.userId, cardIds);
        const linkN = await countOutgoingLinks(job.userId, cardIds);
        await markDocument(documentId, 'digested', { linkHint: hint });
        try {
          await ensureDocumentMeta({
            userId: job.userId,
            documentId,
            executionId,
            alreadyWritten: session.documentMetaWritten === true,
          });
        } catch (err) {
          logger.warn('digest.meta_failed', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await tryIndexOwnedDocument(job.userId, documentId);
        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: `cards=${String(produced.length)} questions=${String(
            produced.reduce((sum, card) => sum + card.questionCount, 0),
          )} links=${String(linkN)}${hint ? ' same_concept_hint=1' : ''}`,
        });

        if (!session.topicId) {
          try {
            await maybeEnqueueTopicSuggest(job.userId);
          } catch (err) {
            logger.warn('digest.suggest_enqueue_failed', {
              jobId: job.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof DigestTerminalError)) {
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
