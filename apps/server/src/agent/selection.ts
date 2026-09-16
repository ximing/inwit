import { docDisplayTitle, documentIdFromJobPayload, selectionJobPayloadFrom } from '@inwit/dto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cards, documents, type JobRow } from '../db/schema.js';
import { asPmJson } from '../documents/content-json.js';
import { heartbeatJob } from '../jobs/heartbeat.js';
import { completeChat } from '../llm/usage.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { deleteCard, indexCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { logger } from '../utils/logger.js';
import { inheritSelectionAnchor } from './card-anchor-logic.js';
import { finishExecution, startExecution } from './executions.js';
import { runWithAgentContext } from './run-context.js';
import {
  parseSelectionCards,
  SELECTION_MIN_CARDS,
  SELECTION_SYSTEM_PROMPT,
  selectionResultSummary,
  selectionUserPrompt,
  type SelectionCardDraft,
} from './selection-logic.js';

export class SelectionTerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'SelectionTerminalError';
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
        await deleteCard(row.id);
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
  if (selectionText.length === 0) throw new SelectionTerminalError('selection job missing selectionText');

  const document = await loadDocument(job.userId, documentId);
  if (!document) {
    logger.warn('selection.document_missing', { jobId: job.id, documentId });
    return;
  }

  const executionId = await startExecution({
    jobId: job.id,
    userId: job.userId,
    agentType: 'selection',
  });

  const heartbeat = setInterval(() => {
    void heartbeatJob(job.id);
  }, 15_000);
  heartbeat.unref();

  try {
    await runWithAgentContext(
      { userId: job.userId, executionId, jobId: job.id, documentId },
      async () => {
        const { text } = await completeChat(
          job.userId,
          {
            systemPrompt: SELECTION_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: selectionUserPrompt({
                  title: docDisplayTitle(document),
                  selectionText,
                }),
              },
            ],
          },
          { executionId },
        );

        const drafts = parseSelectionCards(text);
        if (drafts.length < SELECTION_MIN_CARDS) {
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'selection produced no cards',
            resultSummary: selectionResultSummary(0),
          });
          throw new SelectionTerminalError('selection produced no cards');
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
          await finishExecution({
            executionId,
            status: 'failed',
            error: 'selection produced no cards',
            resultSummary: selectionResultSummary(0),
          });
          throw new SelectionTerminalError('selection produced no cards');
        }

        await finishExecution({
          executionId,
          status: 'done',
          resultSummary: selectionResultSummary(written.length),
        });
        await tryIndexOwnedDocument(job.userId, documentId);
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof SelectionTerminalError)) {
      await finishExecution({
        executionId,
        status: 'failed',
        error: message.slice(0, 2000),
      });
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}
