import type { AcceptProposedResult, CardDetail, RejectCardInput } from '@inwit/dto';
import { codePointsAtMost } from '@inwit/dto';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  cardFeedback,
  cardQuestions,
  cards,
  documents,
  jobs,
  reviewLogs,
  reviewStates,
  type CardRow,
} from '../db/schema.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { indexCard, deleteCardFromIndex, type IndexableCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { maybeEnqueueTopicSuggest } from '../topics/suggest.js';
import { scheduleMemoryOrganizeSafely } from '../agent/memory-organize-enqueue.js';
import { logger } from '../utils/logger.js';
import { decideCardAcceptance, normalizeRejectReason } from './card-acceptance-logic.js';
import { getCard } from './card.service.js';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

function toIndexable(row: CardRow): IndexableCard {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    concept: row.concept,
    example: row.example,
    confusionPoint: row.confusionPoint,
    tags: row.tags,
  };
}

function storedReason(input: RejectCardInput | undefined): string | null {
  const reason = normalizeRejectReason(input?.reason);
  if (reason !== null && !codePointsAtMost(500)(reason)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return reason;
}

async function lockActiveCard(db: Db, userId: string, cardId: string): Promise<CardRow> {
  const [row] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .for('update')
    .limit(1);
  if (!row) throw AppError.of(404, 'CARD_NOT_FOUND');
  return row;
}

/** Digest still running must not confirm cards it may still be rewriting. */
async function assertNoActiveDigest(db: Db, userId: string, documentId: string | null): Promise<void> {
  if (!documentId) return;
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'digest'),
        inArray(jobs.status, ['pending', 'running']),
        sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${documentId}`,
      ),
    )
    .limit(1);
  if (job) throw AppError.of(409, 'DIGEST_IN_PROGRESS');
}

async function hasReviewLogs(db: Db, userId: string, cardId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.cardId, cardId)))
    .limit(1);
  return row !== undefined;
}

async function insertFeedback(
  db: Db,
  input: { userId: string; card: CardRow; verdict: 'accepted' | 'rejected'; reason: string | null },
): Promise<string> {
  const questionRows = await db
    .select({ type: cardQuestions.type, question: cardQuestions.question })
    .from(cardQuestions)
    .where(eq(cardQuestions.cardId, input.card.id))
    .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id));
  const [row] = await db
    .insert(cardFeedback)
    .values({
      userId: input.userId,
      cardId: input.card.id,
      documentId: input.card.documentId,
      verdict: input.verdict,
      reason: input.reason,
      snapshot: {
        concept: input.card.concept,
        example: input.card.example,
        confusionPoint: input.card.confusionPoint,
        tags: input.card.tags,
        questions: questionRows.map((question) => ({
          type: question.type,
          question: question.question,
        })),
      },
    })
    .returning({ id: cardFeedback.id });
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return row.id;
}

/** True only when this accept's row was still live and accepted, and is proposed again. */
async function rollbackAccept(
  userId: string,
  cardId: string,
  feedbackId: string,
  removeReview: boolean,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [reverted] = await tx
      .update(cards)
      .set({ acceptance: 'proposed', updatedAt: new Date() })
      .where(
        and(
          eq(cards.id, cardId),
          eq(cards.userId, userId),
          eq(cards.acceptance, 'accepted'),
          isNull(cards.deletedAt),
        ),
      )
      .returning({ id: cards.id, mapNodeId: cards.mapNodeId });
    if (!reverted) return false;
    if (removeReview) {
      const [log] = await tx
        .select({ id: reviewLogs.id })
        .from(reviewLogs)
        .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.cardId, cardId)))
        .limit(1);
      const [state] = await tx
        .select({ id: reviewStates.id, reps: reviewStates.reps })
        .from(reviewStates)
        .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
        .limit(1);
      if (state && state.reps === 0 && !log) {
        await tx.delete(reviewStates).where(eq(reviewStates.id, state.id));
      }
    }
    await tx
      .delete(cardFeedback)
      .where(and(eq(cardFeedback.id, feedbackId), eq(cardFeedback.userId, userId)));
    if (reverted.mapNodeId) await recalculateMapNodeStatus(reverted.mapNodeId, tx);
    return true;
  });
}

type AcceptOutcome =
  | { kind: 'accepted'; documentId: string | null }
  | { kind: 'noop' }
  | { kind: 'still_proposed' }
  | { kind: 'index_failed' };

async function acceptOne(userId: string, cardId: string): Promise<AcceptOutcome> {
  const prepared = await getDb().transaction(async (tx) => {
    const card = await lockActiveCard(tx, userId, cardId);
    await assertNoActiveDigest(tx, userId, card.documentId);
    const decision = decideCardAcceptance({
      acceptance: card.acceptance,
      action: 'accept',
      hasReviewLogs: false,
    });
    if (decision.kind === 'not_acceptable') throw AppError.of(409, 'CARD_NOT_ACCEPTABLE');
    if (decision.kind === 'noop') return { kind: 'noop' as const };
    if (decision.kind !== 'accept') throw AppError.of(500, 'INTERNAL_ERROR');

    const now = new Date();
    const [updated] = await tx
      .update(cards)
      .set({ acceptance: 'accepted', updatedAt: now })
      .where(
        and(
          eq(cards.id, cardId),
          eq(cards.userId, userId),
          eq(cards.acceptance, 'proposed'),
          isNull(cards.deletedAt),
        ),
      )
      .returning();
    if (!updated) {
      const [again] = await tx
        .select()
        .from(cards)
        .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
        .limit(1);
      if (again?.acceptance === 'proposed') return { kind: 'still_proposed' as const };
      if (again?.acceptance === 'accepted') return { kind: 'noop' as const };
      if (again?.acceptance === 'rejected') throw AppError.of(409, 'CARD_NOT_ACCEPTABLE');
      throw AppError.of(404, 'CARD_NOT_FOUND');
    }

    const [existingReview] = await tx
      .select({ id: reviewStates.id })
      .from(reviewStates)
      .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
      .limit(1);
    await insertInitialReviewState(userId, cardId, now, tx);
    const feedbackId = await insertFeedback(tx, {
      userId,
      card: updated,
      verdict: 'accepted',
      reason: null,
    });
    if (updated.mapNodeId) await recalculateMapNodeStatus(updated.mapNodeId, tx);
    return {
      kind: 'ready' as const,
      card: updated,
      feedbackId,
      removeReview: existingReview === undefined,
    };
  });

  if (prepared.kind === 'noop') return { kind: 'noop' };
  if (prepared.kind === 'still_proposed') return { kind: 'still_proposed' };

  try {
    await indexCard(toIndexable(prepared.card));
  } catch (err) {
    logger.error('card.index_failed', {
      cardId,
      phase: 'accept',
      error: err instanceof Error ? err.message : String(err),
    });
    let reverted = false;
    try {
      reverted = await rollbackAccept(userId, cardId, prepared.feedbackId, prepared.removeReview);
    } catch (rollbackErr) {
      logger.error('card.index_failed', {
        cardId,
        phase: 'accept_rollback',
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
      throw AppError.of(500, 'INTERNAL_ERROR');
    }
    if (reverted) {
      try {
        await deleteCardFromIndex(cardId);
      } catch (cleanupErr) {
        logger.error('card.index_failed', {
          cardId,
          phase: 'accept_cleanup',
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }
    return { kind: 'index_failed' };
  }

  logger.info('card.accept', { userId, cardId, reasonChars: 0 });
  return { kind: 'accepted', documentId: prepared.card.documentId };
}

async function maybeSuggestAfterAcceptance(userId: string, documentId: string | null): Promise<void> {
  if (!documentId) return;
  try {
    const [doc] = await getDb()
      .select({ topicId: documents.topicId })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc || doc.topicId) return;
    const rows = await getDb()
      .select({ acceptance: cards.acceptance, n: count() })
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.documentId, documentId),
          isNull(cards.deletedAt),
          inArray(cards.acceptance, ['proposed', 'accepted']),
        ),
      )
      .groupBy(cards.acceptance);
    let proposed = 0;
    let accepted = 0;
    for (const row of rows) {
      if (row.acceptance === 'proposed') proposed = Number(row.n);
      if (row.acceptance === 'accepted') accepted = Number(row.n);
    }
    if (proposed !== 0 || accepted < 1) return;
    await maybeEnqueueTopicSuggest(userId);
  } catch (err) {
    logger.warn('card.suggest_enqueue_failed', {
      userId,
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function acceptCard(userId: string, cardId: string): Promise<CardDetail> {
  const outcome = await acceptOne(userId, cardId);
  if (outcome.kind === 'index_failed') throw AppError.of(503, 'CARD_INDEX_FAILED');
  if (outcome.kind === 'still_proposed') throw AppError.of(500, 'INTERNAL_ERROR');
  if (outcome.kind === 'accepted') {
    await maybeSuggestAfterAcceptance(userId, outcome.documentId);
    await scheduleMemoryOrganizeSafely(userId);
  }
  return getCard(userId, cardId);
}

export async function acceptProposedCards(userId: string, documentId: string): Promise<AcceptProposedResult> {
  await getOwnedDocument(userId, documentId);
  await assertNoActiveDigest(getDb(), userId, documentId);
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, documentId),
        eq(cards.acceptance, 'proposed'),
        isNull(cards.deletedAt),
      ),
    )
    .orderBy(asc(cards.createdAt), asc(cards.id));

  const acceptedIds: string[] = [];
  const failedIds: string[] = [];
  for (const row of rows) {
    try {
      const outcome = await acceptOne(userId, row.id);
      if (outcome.kind === 'accepted') acceptedIds.push(row.id);
      else if (outcome.kind === 'index_failed' || outcome.kind === 'still_proposed') failedIds.push(row.id);
    } catch (err) {
      if (err instanceof AppError && err.code === 'DIGEST_IN_PROGRESS') throw err;
      if (err instanceof AppError && (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_NOT_ACCEPTABLE')) {
        continue;
      }
      throw err;
    }
  }
  await maybeSuggestAfterAcceptance(userId, documentId);
  if (acceptedIds.length > 0) await scheduleMemoryOrganizeSafely(userId);
  return { acceptedIds, failedIds };
}

async function restoreAcceptedIndex(card: CardRow): Promise<void> {
  try {
    await indexCard(toIndexable(card));
  } catch (err) {
    logger.error('card.index_failed', {
      cardId: card.id,
      phase: 'reject_compensate',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function rejectCard(userId: string, cardId: string, input: RejectCardInput): Promise<CardDetail> {
  const reason = storedReason(input);
  const preview = await getDb().transaction(async (tx) => {
    const card = await lockActiveCard(tx, userId, cardId);
    await assertNoActiveDigest(tx, userId, card.documentId);
    const decision = decideCardAcceptance({
      acceptance: card.acceptance,
      action: 'reject',
      hasReviewLogs: card.acceptance === 'accepted' ? await hasReviewLogs(tx, userId, cardId) : false,
    });
    return { card, decision };
  });
  if (preview.decision.kind === 'noop') return getCard(userId, cardId);
  if (preview.decision.kind === 'not_acceptable') throw AppError.of(409, 'CARD_NOT_ACCEPTABLE');
  if (preview.decision.kind === 'already_reviewed') throw AppError.of(409, 'CARD_ALREADY_REVIEWED');
  if (preview.decision.kind !== 'reject') throw AppError.of(500, 'INTERNAL_ERROR');

  try {
    await deleteCardFromIndex(cardId);
  } catch (err) {
    logger.error('card.index_failed', {
      cardId,
      phase: 'reject',
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.of(503, 'CARD_INDEX_FAILED');
  }

  let applied: CardRow;
  try {
    applied = await getDb().transaction(async (tx) => {
      const card = await lockActiveCard(tx, userId, cardId);
      await assertNoActiveDigest(tx, userId, card.documentId);
      const decision = decideCardAcceptance({
        acceptance: card.acceptance,
        action: 'reject',
        hasReviewLogs: card.acceptance === 'accepted' ? await hasReviewLogs(tx, userId, cardId) : false,
      });
      if (decision.kind === 'noop') return card;
      if (decision.kind === 'already_reviewed') throw AppError.of(409, 'CARD_ALREADY_REVIEWED');
      if (decision.kind !== 'reject') throw AppError.of(409, 'CARD_NOT_ACCEPTABLE');

      const now = new Date();
      const oldMapNodeId = card.mapNodeId;
      const [updated] = await tx
        .update(cards)
        .set({
          acceptance: 'rejected',
          rejectReason: reason,
          mapNodeId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(cards.id, cardId),
            eq(cards.userId, userId),
            eq(cards.acceptance, decision.from),
            isNull(cards.deletedAt),
          ),
        )
        .returning();
      if (!updated) {
        const [again] = await tx
          .select()
          .from(cards)
          .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
          .limit(1);
        if (again?.acceptance === 'rejected') return again;
        throw AppError.of(500, 'INTERNAL_ERROR');
      }
      if (decision.from === 'accepted') {
        await tx
          .delete(reviewStates)
          .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)));
      }
      await insertFeedback(tx, { userId, card: updated, verdict: 'rejected', reason });
      if (oldMapNodeId) await recalculateMapNodeStatus(oldMapNodeId, tx);
      return updated;
    });
  } catch (err) {
    if (preview.card.acceptance === 'accepted') await restoreAcceptedIndex(preview.card);
    throw err;
  }

  if (applied.acceptance !== 'rejected') {
    if (applied.acceptance === 'accepted') await restoreAcceptedIndex(applied);
    return getCard(userId, cardId);
  }

  if (preview.card.acceptance !== 'rejected') {
    logger.info('card.reject', {
      userId,
      cardId,
      reasonChars: reason ? [...reason].length : 0,
    });
    await scheduleMemoryOrganizeSafely(userId);
  }
  return getCard(userId, cardId);
}