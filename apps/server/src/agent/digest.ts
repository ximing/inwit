import { documentIdFromJobPayload } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { annotations, cardQuestions, cards, documents, topics, type JobRow } from '../db/schema.js';
import { asPmJson } from '../documents/content-json.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { RescheduleJobError } from '../jobs/queue-logic.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { maybeEnqueueTopicSuggest } from '../topics/suggest.js';
import { assignUnscopedDigestedDocument } from '../topics/topic-assign.js';
import { logger } from '../utils/logger.js';
import {
  associationHintForCards,
  countOutgoingLinks,
  deleteProposedDocumentCards,
} from './card-harvest.js';
import { numberedBlocksFromDoc } from './card-anchor-logic.js';
import { digestCoverageGap } from './digest-coverage-logic.js';
import { digestRunTimeoutMs, documentTextChars, DOCUMENT_READ_MAX_CHARS } from './document-read-logic.js';
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

/**
 * 重消化清理：硬删这篇文档的大纲批注（含软删行）。
 * canvas 行靠 FK 级联删除，挂在大纲下的卡片 parentId 置空回落为根。
 * outline 不进检索索引，无需清索引。
 */
async function deleteOutlineAnnotations(userId: string, documentId: string): Promise<void> {
  await getDb()
    .delete(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        eq(annotations.documentId, documentId),
        eq(annotations.kind, 'outline'),
      ),
    );
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
  salvaging = false,
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
            anchorBlockIndex: cards.anchorBlockIndex,
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
  const coverageGap =
    session.lastBlockIndex === undefined
      ? null
      : digestCoverageGap({
          lastBlockIndex: session.lastBlockIndex,
          readThrough: session.readThrough ?? null,
          truncated: session.truncated === true,
          anchors: live.map((row) => row.anchorBlockIndex),
        });
  if (coverageGap && !salvaging && session.coverageNudged !== true) {
    session.coverageNudged = true;
    throw new Error(coverageGap);
  }
  const questionTotal = live.reduce((sum, row) => sum + (questionsByCard.get(row.id) ?? 0), 0);

  if ((session.outlineNodeIds?.length ?? 0) === 0) {
    throw new Error('digest wrote no outline nodes');
  }
  // 挂载是软验收：没挂上的卡留在脑图根部，不挡消化完成。
  const placedCount = session.placedCardIds?.length ?? 0;
  if (placedCount !== live.length) {
    logger.warn('digest.place_cards_incomplete', {
      jobId: job.id,
      documentId,
      placed: placedCount,
      live: live.length,
    });
  }

  const hint = await associationHintForCards(job.userId, liveIds);
  const linkN = await countOutgoingLinks(job.userId, liveIds);
  // Title and summary make the topic match sharper than the raw body alone.
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
  if (!session.topicId) {
    try {
      const assigned = await assignUnscopedDigestedDocument(job.userId, documentId);
      if (assigned.topicId && (assigned.assigned || assigned.reason === 'existing')) {
        session.topicId = assigned.topicId;
      }
      if (assigned.assigned) {
        logger.info('digest.topic_assigned', {
          jobId: job.id,
          documentId,
          topicId: assigned.topicId,
          reason: assigned.reason,
          relevance: assigned.relevance,
          abstain: assigned.abstain,
          hitCount: assigned.hitCount,
        });
      } else if (assigned.reason === 'none') {
        logger.info('digest.topic_skipped', {
          jobId: job.id,
          documentId,
          relevance: assigned.relevance,
          abstain: assigned.abstain,
          runnerUp: assigned.runnerUp,
          hitCount: assigned.hitCount,
        });
      }
    } catch (err) {
      logger.warn('digest.topic_assign_failed', {
        jobId: job.id,
        documentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await markDigested(documentId, { linkHint: hint });
  await tryIndexOwnedDocument(job.userId, documentId);

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

  const topicPart = session.topicId ? ` topic=${session.topicId}` : ' topic=none';
  const coveragePart = coverageGap ? ' coverage=partial' : '';
  return `cards=${String(live.length)} questions=${String(questionTotal)} links=${String(linkN)}${topicPart}${hint ? ' same_concept_hint=1' : ''}${coveragePart}`;
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
  await deleteOutlineAnnotations(job.userId, documentId);
  const avoid = await loadDigestAvoidance(job.userId, documentId);

  const sourceBlocks = numberedBlocksFromDoc(asPmJson(document.contentJson)).blocks;
  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    outlineNodeIds: [],
    topicId: document.topicId,
    lastBlockIndex: sourceBlocks.at(-1)?.index ?? sourceBlocks.length,
    readThrough: null,
    truncated: documentTextChars(sourceBlocks) > DOCUMENT_READ_MAX_CHARS,
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
    maxTurns: 72,
    timeoutMs: digestRunTimeoutMs(documentTextChars(sourceBlocks)),
    context: { documentId },
    verify: ({ executionId, salvaging }) =>
      verifyDigest(job, documentId, session, executionId, salvaging === true),
    nudgePrompt: (err) =>
      `流程验收未通过：${err instanceof Error ? err.message : String(err)}。请继续按工作流程执行——write_outline 建两级大纲（只能调用一次）、write_cards 写入至少 2 张卡片、对每张卡 write_questions、place_cards 把每张卡挂到所属大纲节点、read_topic_map 后对每张卡 place_on_map、最后 set_document_meta。必须调用工具落库，不要只回复文字。`,
  });
}
