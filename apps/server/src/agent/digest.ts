import { documentIdFromJobPayload } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { cardQuestions, cards, documents, topics, type JobRow } from '../db/schema.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { RescheduleJobError } from '../jobs/queue-logic.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { maybeEnqueueTopicSuggest } from '../topics/suggest.js';
import { logger } from '../utils/logger.js';
import {
  associationHintForCards,
  countOutgoingLinks,
  deleteProposedDocumentCards,
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
    // Skip documents in 回收站: a stale job must not resurrect them.
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
}

async function loadDigestAvoidance(userId: string, documentId: string) {
  const rows = await getDb()
    .select({
      concept: cards.concept,
      acceptance: cards.acceptance,
      rejectReason: cards.rejectReason,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, documentId),
        isNull(cards.deletedAt),
        inArray(cards.acceptance, ['accepted', 'rejected']),
      ),
    )
    .orderBy(desc(cards.createdAt), desc(cards.id));
  const accepted: { concept: string }[] = [];
  const rejected: { concept: string; reason: string | null }[] = [];
  for (const row of rows) {
    if (row.acceptance === 'accepted' && accepted.length < 20) accepted.push({ concept: row.concept });
    if (row.acceptance === 'rejected' && rejected.length < 20) {
      rejected.push({ concept: row.concept, reason: row.rejectReason });
    }
  }
  return { accepted, rejected };
}

async function verifyDigest(
  job: JobRow,
  documentId: string,
  session: DigestSession,
  executionId: string,
): Promise<string> {
  const required = session.cardAcceptance ?? 'accepted';
  const writtenIds = session.writtenCardIds;
  const rows =
    writtenIds.length === 0
      ? []
      : await getDb()
          .select({
            id: cards.id,
            acceptance: cards.acceptance,
            deletedAt: cards.deletedAt,
          })
          .from(cards)
          .where(
            and(
              eq(cards.userId, job.userId),
              eq(cards.documentId, documentId),
              inArray(cards.id, writtenIds),
            ),
          );
  const live = rows.filter((row) => row.deletedAt == null && row.acceptance === required);
  if (live.length === 0) {
    // Terminal: the queue settles the job as failed and marks the document.
    throw new AgentTerminalError('digest produced no cards', 'cards=0');
  }
  const liveIds = live.map((row) => row.id);
  const questionRows = await getDb()
    .select({ cardId: cardQuestions.cardId, n: count() })
    .from(cardQuestions)
    .where(inArray(cardQuestions.cardId, liveIds))
    .groupBy(cardQuestions.cardId);
  const questionsByCard = new Map(questionRows.map((row) => [row.cardId, Number(row.n)]));
  const missingQuestions = live.filter((row) => (questionsByCard.get(row.id) ?? 0) < 1);
  if (missingQuestions.length > 0) {
    throw new Error(`digest missing questions for ${String(missingQuestions.length)} card(s)`);
  }
  const questionTotal = live.reduce((sum, row) => sum + (questionsByCard.get(row.id) ?? 0), 0);

  const hint = await associationHintForCards(job.userId, liveIds);
  const linkN = await countOutgoingLinks(job.userId, liveIds);
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

  // Gate on: suggestions wait until the document has no proposed cards left.
  if (!config.DIGEST_CARD_GATE && !session.topicId) {
    try {
      await maybeEnqueueTopicSuggest(job.userId);
    } catch (err) {
      logger.warn('digest.suggest_enqueue_failed', {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return `cards=${String(live.length)} questions=${String(questionTotal)} links=${String(linkN)}${hint ? ' same_concept_hint=1' : ''}`;
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

  // Editor documents are digested only after an idle window. A save may have
  // landed after the job was claimed but before its runAt could be postponed;
  // hand the job back to the queue instead of digesting a draft.
  if (document.source === 'editor') {
    const deadline = new Date(document.updatedAt.getTime() + config.DIGEST_IDLE_DELAY_MS);
    if (deadline.getTime() > Date.now()) {
      throw new RescheduleJobError(deadline);
    }
  }

  // Retry must not wipe cards the user already accepted or rejected.
  await deleteProposedDocumentCards(job.userId, documentId);
  const avoid = await loadDigestAvoidance(job.userId, documentId);

  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    topicId: document.topicId,
    ...(config.DIGEST_CARD_GATE ? { cardAcceptance: 'proposed' as const } : {}),
  };
  const activeTopics = await listActiveTopics(job.userId);

  await runAgentJob({
    job,
    agentType: 'digest',
    systemPrompt: DIGEST_SYSTEM_PROMPT,
    userPrompt: digestUserPrompt({
      documentId,
      topicId: document.topicId,
      topics: activeTopics,
      avoid,
    }),
    tools: digestTools(session),
    context: { documentId },
    verify: ({ executionId }) => verifyDigest(job, documentId, session, executionId),
    nudgePrompt: (err) =>
      `流程验收未通过：${err instanceof Error ? err.message : String(err)}。请继续按工作流程执行——write_cards 写入至少 2 张卡片、对每张卡 write_questions、read_topic_map 后对每张卡 place_on_map、最后 set_document_meta。必须调用工具落库，不要只回复文字。`,
  });
}
