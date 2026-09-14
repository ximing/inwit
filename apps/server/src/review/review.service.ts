import type {
  CardQuestion,
  MapPlacement,
  ReviewFeedback,
  ReviewFeedbackResult,
  ReviewLog,
  ReviewQueueItem,
  ReviewState,
  ReviewStats,
  ReviewToday,
} from '@inwit/dto';
import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { toPublicCard, toPublicQuestion } from '../cards/card.mapper.js';
import { getDb } from '../db/index.js';
import {
  cards,
  cardQuestions,
  mapNodes,
  reviewLogs,
  reviewStates,
  topics,
  type ReviewLogRow,
  type ReviewStateRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { scheduleReview } from './sm2.js';
import { insertInitialReviewState } from './state-init.js';

export function startOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfLocalDayDaysAgo(now: Date, days: number): Date {
  const d = startOfLocalDay(now);
  d.setDate(d.getDate() - days);
  return d;
}

export function toPublicReviewState(row: ReviewStateRow): ReviewState {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    ease: row.ease,
    intervalDays: row.intervalDays,
    dueAt: row.dueAt.toISOString(),
    reps: row.reps,
    lapses: row.lapses,
    lastFeedback: row.lastFeedback,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicLog(row: ReviewLogRow): ReviewLog {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    feedback: row.feedback,
    reviewedAt: row.reviewedAt.toISOString(),
  };
}

async function loadMapPlacements(
  cardsWithNode: Array<{ id: string; mapNodeId: string | null }>,
): Promise<Map<string, MapPlacement>> {
  const placements = new Map<string, MapPlacement>();
  const nodeIds = [
    ...new Set(
      cardsWithNode
        .map((card) => card.mapNodeId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (nodeIds.length === 0) return placements;

  const seedNodes = await getDb()
    .select({
      id: mapNodes.id,
      topicId: mapNodes.topicId,
      parentId: mapNodes.parentId,
      title: mapNodes.title,
    })
    .from(mapNodes)
    .where(inArray(mapNodes.id, nodeIds));
  const topicIds = [...new Set(seedNodes.map((node) => node.topicId))];
  if (topicIds.length === 0) return placements;

  const [allNodes, topicRows] = await Promise.all([
    getDb()
      .select({
        id: mapNodes.id,
        topicId: mapNodes.topicId,
        parentId: mapNodes.parentId,
        title: mapNodes.title,
      })
      .from(mapNodes)
      .where(inArray(mapNodes.topicId, topicIds)),
    getDb()
      .select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(inArray(topics.id, topicIds)),
  ]);

  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const topicTitleById = new Map(topicRows.map((topic) => [topic.id, topic.title]));

  const pathOf = (nodeId: string): string => {
    const titles: string[] = [];
    let current: string | null = nodeId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = byId.get(current);
      if (!node) break;
      titles.unshift(node.title);
      current = node.parentId;
    }
    return titles.join(' / ');
  };

  for (const card of cardsWithNode) {
    if (!card.mapNodeId) continue;
    const node = byId.get(card.mapNodeId);
    if (!node) continue;
    const topicTitle = topicTitleById.get(node.topicId);
    if (!topicTitle) continue;
    placements.set(card.id, { topicTitle, nodePath: pathOf(node.id) });
  }
  return placements;
}

async function loadQuestionsByCard(cardIds: string[]): Promise<Map<string, CardQuestion[]>> {
  const questionsByCard = new Map<string, CardQuestion[]>();
  if (cardIds.length === 0) return questionsByCard;
  const questionRows = await getDb()
    .select()
    .from(cardQuestions)
    .where(inArray(cardQuestions.cardId, cardIds))
    .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id));
  for (const row of questionRows) {
    const list = questionsByCard.get(row.cardId) ?? [];
    list.push(toPublicQuestion(row));
    questionsByCard.set(row.cardId, list);
  }
  return questionsByCard;
}

export async function getReviewToday(userId: string, now = new Date()): Promise<ReviewToday> {
  const dayStart = startOfLocalDay(now);
  const dayEnd = endOfLocalDay(now);

  const dueRows = await getDb()
    .select({ state: reviewStates, card: cards })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(eq(reviewStates.userId, userId), eq(cards.userId, userId), lte(reviewStates.dueAt, dayEnd)),
    )
    .orderBy(asc(reviewStates.dueAt), asc(reviewStates.cardId));

  const [reviewedRow] = await getDb()
    .select({ n: sql<number>`count(distinct ${reviewLogs.cardId})::int` })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, dayStart),
        lte(reviewLogs.reviewedAt, dayEnd),
      ),
    );

  const questionsByCard = await loadQuestionsByCard(dueRows.map((row) => row.card.id));
  const placements = await loadMapPlacements(dueRows.map((row) => row.card));
  const items: ReviewQueueItem[] = dueRows.map((row) => ({
    card: toPublicCard(row.card, questionsByCard.get(row.card.id) ?? []),
    reviewState: toPublicReviewState(row.state),
    mapPlacement: placements.get(row.card.id) ?? null,
  }));

  const reviewedToday = Number(reviewedRow?.n ?? 0);
  return {
    items,
    reviewedToday,
    total: reviewedToday + items.length,
  };
}

function shouldEnqueueEvolve(feedback: ReviewFeedback, lapses: number): boolean {
  return feedback === 'fuzzy' || (feedback === 'forgot' && lapses >= 2);
}

export async function submitReviewFeedback(
  userId: string,
  cardId: string,
  feedback: ReviewFeedback,
  now = new Date(),
): Promise<ReviewFeedbackResult> {
  return getDb().transaction(async (tx) => {
    const [card] = await tx
      .select({ id: cards.id, mapNodeId: cards.mapNodeId })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
      .limit(1);
    if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');

    let [state] = await tx
      .select()
      .from(reviewStates)
      .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
      .for('update')
      .limit(1);

    if (!state) {
      await insertInitialReviewState(userId, cardId, now, tx);
      [state] = await tx
        .select()
        .from(reviewStates)
        .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
        .for('update')
        .limit(1);
    }
    if (!state) throw AppError.of(500, 'INTERNAL_ERROR');

    const next = scheduleReview(
      {
        ease: state.ease,
        intervalDays: state.intervalDays,
        reps: state.reps,
        lapses: state.lapses,
      },
      feedback,
      now,
    );

    const [log] = await tx
      .insert(reviewLogs)
      .values({
        userId,
        cardId,
        feedback,
        reviewedAt: now,
      })
      .returning();
    if (!log) throw AppError.of(500, 'INTERNAL_ERROR');

    const [updated] = await tx
      .update(reviewStates)
      .set({
        ease: next.ease,
        intervalDays: next.intervalDays,
        dueAt: next.dueAt,
        reps: next.reps,
        lapses: next.lapses,
        lastFeedback: feedback,
        updatedAt: now,
      })
      .where(eq(reviewStates.id, state.id))
      .returning();
    if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');

    if (card.mapNodeId) {
      await recalculateMapNodeStatus(card.mapNodeId, tx);
    }

    let evolveJobId: string | undefined;
    if (shouldEnqueueEvolve(feedback, next.lapses)) {
      const job = await enqueueJob(tx, {
        userId,
        type: 'evolve',
        payload: { cardId, reason: feedback },
      });
      evolveJobId = job.id;
    }

    const result: ReviewFeedbackResult = {
      reviewState: toPublicReviewState(updated),
      log: toPublicLog(log),
    };
    if (evolveJobId !== undefined) result.evolveJobId = evolveJobId;
    return result;
  });
}

export async function getReviewStats(userId: string, now = new Date()): Promise<ReviewStats> {
  const from = startOfLocalDayDaysAgo(now, 6);
  const dayEnd = endOfLocalDay(now);

  const distRows = await getDb()
    .select({
      feedback: reviewLogs.feedback,
      n: count(),
    })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, from),
        lte(reviewLogs.reviewedAt, dayEnd),
      ),
    )
    .groupBy(reviewLogs.feedback);

  const last7Days: ReviewStats['last7Days'] = { forgot: 0, fuzzy: 0, remembered: 0, total: 0 };
  for (const row of distRows) {
    last7Days[row.feedback] = Number(row.n);
    last7Days.total += Number(row.n);
  }

  const [overdueRow] = await getDb()
    .select({ n: count() })
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), lte(reviewStates.dueAt, dayEnd)));

  return {
    last7Days,
    overdueCount: Number(overdueRow?.n ?? 0),
  };
}
