import type { CreateDocumentInput, DocumentSource, UpdateDocumentInput } from '@inwit/dto';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { shouldIndexCard } from '../cards/card-acceptance-logic.js';
import { updateCards } from '../cards/card-write.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { cards, documents, jobs, type CardRow, type DocumentRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { resolveModelFor } from '../llm/pi.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { tryIndexCard, tryIndexDocument } from '../retrieval/pipeline.js';
import { isBlankDocumentContent, planDigestOnSave, type DigestPlan } from './document-logic.js';
import { planDocumentInsert, planDocumentSave } from './document-write-logic.js';

export async function insertUserDocument(
  userId: string,
  input: Omit<CreateDocumentInput, 'source'> & { source?: DocumentSource | undefined },
): Promise<DocumentRow> {
  const source = input.source ?? 'paste';
  const plan = planDocumentInsert({
    reason: 'create_user',
    blank: isBlankDocumentContent(input.contentJson),
    source,
    idleDelayMs: config.DIGEST_IDLE_DELAY_MS,
  });
  if (plan.resolveModel) await resolveModelFor(userId);

  const document = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: input.topicId ?? null,
        title: input.title ?? null,
        contentJson: input.contentJson,
        source: plan.source,
        status: plan.status,
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    if (plan.enqueueDigest) {
      await enqueueJob(tx, {
        userId,
        type: 'digest',
        payload: { documentId: row.id },
        ...(plan.digestDelayMs > 0 ? { runAt: new Date(Date.now() + plan.digestDelayMs) } : {}),
      });
    }
    return row;
  });
  if (plan.indexAfterInsert) await tryIndexDocument(document);
  return document;
}

export async function saveUserDocument(
  userId: string,
  id: string,
  existing: DocumentRow,
  input: UpdateDocumentInput,
): Promise<DocumentRow> {
  const policy = planDocumentSave('save_user');
  const contentJson = input.contentJson !== undefined ? input.contentJson : existing.contentJson;
  const title = input.title !== undefined ? input.title : existing.title;
  const topicChanged = input.topicId !== undefined && input.topicId !== existing.topicId;
  const contentChanged =
    input.contentJson !== undefined &&
    JSON.stringify(input.contentJson) !== JSON.stringify(existing.contentJson);
  // Digest planning only matters while a first digest can still be scheduled:
  // blank content gaining text, or an editor draft with a pending digest job.
  const needsDigestPlan =
    input.contentJson !== undefined &&
    (isBlankDocumentContent(existing.contentJson) || existing.source === 'editor');

  const { row, digestPlanned, movedCards } = await getDb().transaction(async (tx) => {
    let plan: DigestPlan = { kind: 'none' };
    let pendingDigestId: string | null = null;
    if (policy.digest === 'plan_on_save' && needsDigestPlan) {
      const [cardCountRow] = await tx
        .select({ n: count() })
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.documentId, id), isNull(cards.deletedAt)));
      const digestJobs = await tx
        .select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.type, 'digest'),
            inArray(jobs.status, ['pending', 'running']),
            sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${id}`,
          ),
        );
      pendingDigestId = digestJobs.find((job) => job.status === 'pending')?.id ?? null;
      plan = planDigestOnSave({
        source: existing.source,
        existing,
        input,
        contentChanged,
        cardCount: Number(cardCountRow?.n ?? 0),
        hasPendingDigest: pendingDigestId !== null,
        hasRunningDigest: digestJobs.some((job) => job.status === 'running'),
        idleDelayMs: config.DIGEST_IDLE_DELAY_MS,
      });
    }

    if (plan.kind === 'enqueue') await resolveModelFor(userId);

    const now = new Date();
    const [updated] = await tx
      .update(documents)
      .set({
        title,
        contentJson,
        updatedAt: now,
        ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
        ...(topicChanged ? { mapNodeId: null } : {}),
        ...(policy.maySetPending && plan.kind === 'enqueue'
          ? { status: 'pending' as const, failReason: null }
          : {}),
      })
      .where(and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)))
      .returning();
    if (!updated) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    if (plan.kind === 'enqueue') {
      await enqueueJob(tx, {
        userId,
        type: 'digest',
        payload: { documentId: id },
        ...(plan.delayMs > 0 ? { runAt: new Date(now.getTime() + plan.delayMs) } : {}),
      });
    } else if (plan.kind === 'postpone' && pendingDigestId !== null) {
      // Conditional update: if the worker claimed the job first, the digest
      // handler re-checks freshness and reschedules itself.
      await tx
        .update(jobs)
        .set({ runAt: new Date(now.getTime() + plan.delayMs), updatedAt: now })
        .where(and(eq(jobs.id, pendingDigestId), eq(jobs.status, 'pending')));
    }
    let movedCards: CardRow[] = [];
    if (topicChanged) {
      const attached = await tx
        .select({ mapNodeId: cards.mapNodeId })
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.documentId, id), isNull(cards.deletedAt)));
      movedCards = await updateCards(tx)
        .set({ topicId: input.topicId ?? null, mapNodeId: null, updatedAt: now })
        .where(and(eq(cards.userId, userId), eq(cards.documentId, id), isNull(cards.deletedAt)))
        .returning();
      const nodeIds = [
        ...new Set(
          attached.map((row) => row.mapNodeId).filter((nodeId): nodeId is string => nodeId !== null),
        ),
      ];
      for (const nodeId of nodeIds) {
        await recalculateMapNodeStatus(nodeId, tx);
      }
    }
    return { row: updated, digestPlanned: plan.kind !== 'none', movedCards };
  });
  const titleChanged = input.title !== undefined && title !== existing.title;
  // While a digest is pending it re-indexes on completion; embedding every
  // intermediate save would burn tokens on drafts.
  if (topicChanged) {
    for (const card of movedCards) {
      if (!shouldIndexCard(card)) continue;
      await tryIndexCard({
        id: card.id,
        userId: card.userId,
        topicId: card.topicId,
        concept: card.concept,
        example: card.example,
        confusionPoint: card.confusionPoint,
        tags: card.tags,
      });
    }
  }
  if (policy.index === 'always') {
    await tryIndexDocument(row);
  } else if ((titleChanged || contentChanged || topicChanged) && !digestPlanned) {
    await tryIndexDocument(row);
  }
  return row;
}

/** Conversation create: digested, source editor, no digest job, then index. */
export async function insertAgentDocument(args: {
  userId: string;
  title: string | null;
  contentJson: Record<string, unknown>;
}): Promise<{ id: string; title: string | null } | null> {
  const plan = planDocumentInsert({
    reason: 'create_agent',
    blank: false,
    source: 'editor',
    idleDelayMs: config.DIGEST_IDLE_DELAY_MS,
  });
  if (plan.resolveModel) await resolveModelFor(args.userId);

  const [row] = await getDb()
    .insert(documents)
    .values({
      userId: args.userId,
      title: args.title,
      contentJson: args.contentJson,
      source: plan.source,
      status: plan.status,
    })
    .returning({ id: documents.id, title: documents.title });
  if (!row) return null;
  if (plan.enqueueDigest) {
    await getDb().transaction(async (tx) => {
      await enqueueJob(tx, {
        userId: args.userId,
        type: 'digest',
        payload: { documentId: row.id },
        ...(plan.digestDelayMs > 0 ? { runAt: new Date(Date.now() + plan.digestDelayMs) } : {}),
      });
    });
  }
  if (plan.indexAfterInsert) await tryIndexOwnedDocument(args.userId, row.id);
  return row;
}

/** Conversation replace: body and optional title only. No digest, status stays. */
export async function replaceAgentDocumentContent(args: {
  userId: string;
  documentId: string;
  contentJson: Record<string, unknown>;
  title?: string | undefined;
}): Promise<void> {
  const policy = planDocumentSave('save_agent');
  await getDb()
    .update(documents)
    .set({
      contentJson: args.contentJson,
      updatedAt: new Date(),
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(policy.maySetPending ? { status: 'pending' as const, failReason: null } : {}),
    })
    .where(and(eq(documents.id, args.documentId), eq(documents.userId, args.userId)));
  if (policy.digest === 'none' && policy.index === 'always') {
    await tryIndexOwnedDocument(args.userId, args.documentId);
  }
}
