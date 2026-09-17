import { documentIdFromJobPayload } from '@inwit/dto';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, topics, type JobRow } from '../db/schema.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { maybeEnqueueTopicSuggest } from '../topics/suggest.js';
import { logger } from '../utils/logger.js';
import {
  associationHintForCards,
  cleanupDocumentCards,
  countOutgoingLinks,
  loadDocumentCards,
} from './card-harvest.js';
import { ensureDocumentMeta } from './doc-meta.js';
import { DIGEST_SYSTEM_PROMPT, digestUserPrompt } from './prompts.js';
import { AgentTerminalError, runAgentJob } from './run-agent-job.js';
import { digestTools, type DigestSession } from './tools.js';

async function listActiveTopics(userId: string) {
  return getDb()
    .select({ id: topics.id, title: topics.title, goal: topics.goal })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, 'active')))
    .orderBy(asc(topics.createdAt));
}

async function markDigested(id: string, extra?: { linkHint?: string | null }): Promise<void> {
  await getDb()
    .update(documents)
    .set({
      status: 'digested',
      failReason: null,
      updatedAt: new Date(),
      ...(extra && 'linkHint' in extra ? { linkHint: extra.linkHint ?? null } : {}),
    })
    .where(eq(documents.id, id));
}

async function verifyDigest(
  job: JobRow,
  documentId: string,
  session: DigestSession,
  executionId: string,
): Promise<string> {
  const produced = await loadDocumentCards(job.userId, documentId);
  if (produced.length === 0) {
    // Terminal: the queue settles the job as failed and marks the document.
    throw new AgentTerminalError('digest produced no cards', 'cards=0');
  }
  const missingQuestions = produced.filter((card) => card.questionCount < 1);
  if (missingQuestions.length > 0) {
    throw new Error(`digest missing questions for ${String(missingQuestions.length)} card(s)`);
  }

  const cardIds = produced.map((card) => card.id);
  const hint = await associationHintForCards(job.userId, cardIds);
  const linkN = await countOutgoingLinks(job.userId, cardIds);
  await markDigested(documentId, { linkHint: hint });
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

  return `cards=${String(produced.length)} questions=${String(
    produced.reduce((sum, card) => sum + card.questionCount, 0),
  )} links=${String(linkN)}${hint ? ' same_concept_hint=1' : ''}`;
}

export async function processDigest(job: JobRow): Promise<void> {
  const documentId = documentIdFromJobPayload(job.payload);
  if (!documentId) throw new Error('digest job missing documentId');

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('digest.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (document.status === 'digested') {
    logger.info('digest.already_done', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    topicId: document.topicId,
  };
  const activeTopics = await listActiveTopics(job.userId);

  await runAgentJob({
    job,
    agentType: 'digest',
    systemPrompt: DIGEST_SYSTEM_PROMPT,
    userPrompt: digestUserPrompt({ documentId, topicId: document.topicId, topics: activeTopics }),
    tools: digestTools(session),
    context: { documentId },
    verify: ({ executionId }) => verifyDigest(job, documentId, session, executionId),
    nudgePrompt: (err) =>
      `流程验收未通过：${err instanceof Error ? err.message : String(err)}。请继续按工作流程执行——write_cards 写入至少 2 张卡片、对每张卡 write_questions、read_topic_map 后对每张卡 place_on_map、最后 set_document_meta。必须调用工具落库，不要只回复文字。`,
  });
}
