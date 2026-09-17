import { docDisplayTitle, documentIdFromJobPayload, selectionJobPayloadFrom } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cards, type JobRow } from '../db/schema.js';
import { asPmJson } from '../documents/content-json.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { deleteCardFromIndex, indexCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { logger } from '../utils/logger.js';
import { inheritSelectionAnchor } from './card-anchor-logic.js';
import { extractAssistantText } from './messages.js';
import { AgentTerminalError, runAgentJob } from './run-agent-job.js';
import {
  parseSelectionCards,
  SELECTION_MIN_CARDS,
  SELECTION_SYSTEM_PROMPT,
  selectionResultSummary,
  selectionUserPrompt,
  type SelectionCardDraft,
} from './selection-logic.js';

async function persistDrafts(input: {
  userId: string;
  documentId: string;
  topicId: string | null;
  mapNodeId: string | null;
  contentJson: unknown;
  selectionText: string;
  blockIndex: number | undefined;
  drafts: SelectionCardDraft[];
}): Promise<string[]> {
  const written: string[] = [];
  const resolved = inheritSelectionAnchor(asPmJson(input.contentJson), {
    blockIndex: input.blockIndex,
    quote: input.selectionText,
  });
  for (const draft of input.drafts) {
    const now = new Date();
    const [row] = await getDb()
      .insert(cards)
      .values({
        userId: input.userId,
        documentId: input.documentId,
        topicId: input.topicId,
        mapNodeId: input.mapNodeId,
        concept: draft.concept,
        example: draft.example,
        confusionPoint: draft.confusionPoint,
        tags: draft.tags,
        source: 'agent',
        anchorText: resolved.anchorText,
        anchorBlockIndex: resolved.anchorBlockIndex,
      })
      .returning();
    if (!row) throw new Error('failed to insert card');
    await insertInitialReviewState(input.userId, row.id, now);
    try {
      await indexCard({
        id: row.id,
        userId: row.userId,
        topicId: row.topicId,
        concept: row.concept,
        example: row.example,
        confusionPoint: row.confusionPoint,
        tags: row.tags,
      });
    } catch (err) {
      logger.error('selection.index_card_failed', err);
      try {
        await deleteCardFromIndex(row.id);
      } catch (cleanupErr) {
        logger.warn('selection.index_card_cleanup_failed', cleanupErr);
      }
      await getDb().delete(cards).where(eq(cards.id, row.id));
      throw err instanceof Error ? err : new Error('indexCard failed');
    }
    written.push(row.id);
  }
  if (input.mapNodeId && written.length > 0) {
    await recalculateMapNodeStatus(input.mapNodeId);
  }
  return written;
}

export async function processSelection(job: JobRow): Promise<void> {
  const payload = selectionJobPayloadFrom(job.payload);
  const documentId = payload?.documentId ?? documentIdFromJobPayload(job.payload);
  const selectionText = payload?.selectionText?.trim() ?? '';
  if (!documentId) throw new Error('selection job missing documentId');
  if (selectionText.length === 0) throw new AgentTerminalError('selection job missing selectionText');

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('selection.document_missing', { jobId: job.id, documentId });
    return;
  }

  await runAgentJob({
    job,
    agentType: 'selection',
    systemPrompt: SELECTION_SYSTEM_PROMPT,
    userPrompt: selectionUserPrompt({
      title: docDisplayTitle(document),
      selectionText,
    }),
    tools: [],
    maxTurns: 1,
    context: { documentId },
    verify: async ({ agent }) => {
      const text = extractAssistantText(agent.state.messages);

      const drafts = parseSelectionCards(text);
      if (drafts.length < SELECTION_MIN_CARDS) {
        throw new AgentTerminalError('selection produced no cards', selectionResultSummary(0));
      }

      const written = await persistDrafts({
        userId: job.userId,
        documentId,
        topicId: document.topicId,
        mapNodeId: document.mapNodeId,
        contentJson: document.contentJson,
        selectionText,
        blockIndex: payload?.blockIndex,
        drafts,
      });
      if (written.length < SELECTION_MIN_CARDS) {
        throw new AgentTerminalError('selection produced no cards', selectionResultSummary(0));
      }

      await tryIndexOwnedDocument(job.userId, documentId);
      return selectionResultSummary(written.length);
    },
  });
}
