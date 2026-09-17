import { TOPIC_SUGGESTION_MIN_DOCS, topicJobPayloadFrom } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { findOwnedDocument } from '../documents/document.service.js';
import {
  captureTopicMapSnapshot,
  TOPIC_MAP_SNAPSHOT_AFTER,
  TOPIC_MAP_SNAPSHOT_BEFORE,
} from '../maps/snapshot.js';
import { loadUnattributedPool } from '../topics/suggest.js';
import { logger } from '../utils/logger.js';
import { cleanupDocumentCards, loadDocumentCards } from './card-harvest.js';
import {
  TOPIC_FILL_SYSTEM_PROMPT,
  TOPIC_ORGANIZE_SYSTEM_PROMPT,
  TOPIC_SUGGEST_SYSTEM_PROMPT,
  topicFillUserPrompt,
  topicOrganizeUserPrompt,
  topicSuggestUserPrompt,
} from './prompts.js';
import { AgentTerminalError, runAgentJob } from './run-agent-job.js';
import { suggestTools, type SuggestSession } from './suggest-tools.js';
import { fillTools, organizeTools } from './topic-tools.js';
import type { DigestSession } from './tools.js';

async function markDocument(id: string, status: 'digested' | 'failed'): Promise<void> {
  await getDb()
    .update(documents)
    .set({ status, updatedAt: new Date() })
    .where(eq(documents.id, id));
}

async function processOrganize(job: JobRow, topicId: string): Promise<void> {
  const session: DigestSession = {
    userId: job.userId,
    documentId: '',
    writtenCardIds: [],
    topicId,
  };

  let before: Awaited<ReturnType<typeof captureTopicMapSnapshot>> | null = null;

  await runAgentJob({
    job,
    agentType: 'topic',
    systemPrompt: TOPIC_ORGANIZE_SYSTEM_PROMPT,
    userPrompt: topicOrganizeUserPrompt({ topicId }),
    tools: organizeTools(session),
    context: { topicId },
    beforeRun: async () => {
      before = await captureTopicMapSnapshot({
        userId: job.userId,
        topicId,
        jobId: job.id,
        key: TOPIC_MAP_SNAPSHOT_BEFORE,
      });
    },
    verify: async () => {
      if (!session.mapUpdated) {
        throw new AgentTerminalError('organize did not call update_knowledge_map');
      }
      if (!before) throw new Error('organize missing before snapshot');

      const after = await captureTopicMapSnapshot({
        userId: job.userId,
        topicId,
        jobId: job.id,
        key: TOPIC_MAP_SNAPSHOT_AFTER,
      });
      const dropped = before.attachedCardIds.filter((id) => !after.attachedCardIds.includes(id));
      return `action=organize nodes=${String(after.nodes.length)} cards_before=${String(before.cardCount)} cards_after=${String(after.cardCount)} dropped=${String(dropped.length)} blank=${String(after.nodes.filter((node) => node.cardIds.length === 0).length)}`;
    },
  });
}

async function processFill(
  job: JobRow,
  payload: { topicId: string; nodeId: string; documentId?: string },
): Promise<void> {
  const documentId = payload.documentId;
  if (!documentId) throw new Error('fill job missing documentId');

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('topic.fill.document_missing', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    topicId: payload.topicId,
    mapNodeId: payload.nodeId,
    dueImmediately: true,
    cardSource: 'agent',
  };

  await runAgentJob({
    job,
    agentType: 'topic',
    systemPrompt: TOPIC_FILL_SYSTEM_PROMPT,
    userPrompt: topicFillUserPrompt({
      topicId: payload.topicId,
      nodeId: payload.nodeId,
      documentId,
    }),
    tools: fillTools(session),
    context: { topicId: payload.topicId, documentId },
    verify: async () => {
      const produced = await loadDocumentCards(job.userId, documentId);
      if (produced.length === 0) {
        await markDocument(documentId, 'failed');
        throw new AgentTerminalError('fill produced no cards', 'cards=0');
      }
      const missingQuestions = produced.filter((card) => card.questionCount < 1);
      if (missingQuestions.length > 0) {
        throw new Error(`fill missing questions for ${String(missingQuestions.length)} card(s)`);
      }

      await markDocument(documentId, 'digested');
      return `action=fill node=${payload.nodeId} cards=${String(produced.length)} questions=${String(
        produced.reduce((sum, card) => sum + card.questionCount, 0),
      )}`;
    },
  });
}

async function processSuggest(job: JobRow): Promise<void> {
  const session: SuggestSession = { userId: job.userId, wroteKey: null };
  let docCount = 0;

  await runAgentJob({
    job,
    agentType: 'topic',
    systemPrompt: TOPIC_SUGGEST_SYSTEM_PROMPT,
    userPrompt: topicSuggestUserPrompt(),
    tools: suggestTools(session),
    beforeRun: async () => {
      const pool = await loadUnattributedPool(job.userId);
      docCount = pool.documents.length;
      if (pool.documents.length < TOPIC_SUGGESTION_MIN_DOCS) {
        return `action=suggest skipped=too_few docs=${String(pool.documents.length)}`;
      }
    },
    verify: () => {
      return Promise.resolve(
        session.wroteKey
          ? `action=suggest wrote=${session.wroteKey} docs=${String(docCount)}`
          : `action=suggest wrote=none docs=${String(docCount)}`,
      );
    },
  });
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
