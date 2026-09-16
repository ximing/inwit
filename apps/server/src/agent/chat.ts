import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import { documentIdFromJobPayload, type AgentExecutionStep } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { logLlmUsage } from '../llm/usage.js';
import { modelResponseError, resolveModelFor } from '../llm/pi.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { logger } from '../utils/logger.js';
import {
  associationHintForCards,
  cleanupDocumentCards,
  countOutgoingLinks,
  loadDocumentCards,
} from './digest.js';
import { finishExecution, saveExecutionSteps, startExecution, summarizeValue } from './executions.js';
import { extractAssistantText, isAssistantMessage } from './messages.js';
import { ensureDocumentMeta } from './doc-meta.js';
import { CHAT_SYSTEM_PROMPT, chatUserPrompt } from './prompts.js';
import { runWithAgentContext } from './run-context.js';
import { chatTools, type DigestSession } from './tools.js';

const RUN_TIMEOUT_MS = 180_000;
const MAX_TURNS = 24;

export class ChatTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'ChatTerminalError';
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

async function markChatDocument(
  id: string,
  status: 'digested' | 'failed',
  answer: string | null,
  linkHint?: string | null,
): Promise<void> {
  await getDb()
    .update(documents)
    .set({
      status,
      answer,
      updatedAt: new Date(),
      ...(linkHint !== undefined ? { linkHint } : {}),
    })
    .where(eq(documents.id, id));
}

export async function processChat(job: JobRow): Promise<void> {
  const documentId = documentIdFromJobPayload(job.payload);
  if (!documentId) throw new Error('chat job missing documentId');

  const document = await loadDocument(job.userId, documentId);
  if (!document) {
    logger.warn('chat.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (document.status === 'digested') {
    logger.info('chat.already_done', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'chat',
  });
  const steps: AgentExecutionStep[] = [];
  const toolStarted = new Map<string, { name: string; args: unknown; t: number }>();
  let turnCount = 0;
  let answerText = '';

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
          cardSource: 'chat',
          dueImmediately: true,
        };

        const agent = new Agent({
          streamFn: (model, context, options) =>
            resolved.models.streamSimple(model, context, {
              ...options,
              apiKey: resolved.apiKey,
            }),
          getApiKey: () => resolved.apiKey,
          initialState: {
            systemPrompt: CHAT_SYSTEM_PROMPT,
            model: resolved.model,
            tools: chatTools(session),
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
            chatUserPrompt({ documentId, question: document.contentMd }),
          );
        } finally {
          clearTimeout(timeout);
          clearInterval(heartbeat);
          unsubscribe();
        }

        const assistant = agent.state.messages.filter(isAssistantMessage);
        const failed = assistant.find((m) => m.stopReason === 'error' || m.stopReason === 'aborted');
        if (failed) throw modelResponseError(failed.stopReason, failed.errorMessage ?? '');

        answerText = extractAssistantText(agent.state.messages);
        if (answerText.length === 0) {
          await markChatDocument(documentId, 'failed', null);
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'chat produced no answer',
            resultSummary: 'answer=0',
          });
          throw new ChatTerminalError('chat produced no answer');
        }

        const produced = await loadDocumentCards(job.userId, documentId);
        if (produced.length === 0) {
          await markChatDocument(documentId, 'failed', answerText);
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'chat produced no cards',
            resultSummary: 'cards=0',
          });
          throw new ChatTerminalError('chat produced no cards');
        }
        const missingQuestions = produced.filter((card) => card.questionCount < 1);
        if (missingQuestions.length > 0) {
          throw new Error(
            `chat missing questions for ${String(missingQuestions.length)} card(s)`,
          );
        }

        const cardIds = produced.map((card) => card.id);
        const hint = await associationHintForCards(job.userId, cardIds);
        const linkN = await countOutgoingLinks(job.userId, cardIds);
        await markChatDocument(documentId, 'digested', answerText, hint);
        try {
          await ensureDocumentMeta({
            userId: job.userId,
            documentId,
            executionId,
            alreadyWritten: session.documentMetaWritten === true,
          });
        } catch (err) {
          logger.warn('chat.meta_failed', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await tryIndexOwnedDocument(job.userId, documentId);
        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: `answer_chars=${String(answerText.length)} cards=${String(produced.length)} questions=${String(
            produced.reduce((sum, card) => sum + card.questionCount, 0),
          )} links=${String(linkN)}${hint ? ' same_concept_hint=1' : ''}`,
        });
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof ChatTerminalError)) {
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
