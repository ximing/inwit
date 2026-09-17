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
import { maybeEnqueueAnalyzePatterns } from '../agent/analyze-enqueue.js';
import { enqueueJob } from '../jobs/queue.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { logger } from '../utils/logger.js';
import { addLocalDays, endOfLocalDay, localDateKey, startOfLocalDay } from '../utils/date.js';
import { evolveReasonFor } from './evolve-reason.js';
import { upsertCardMasteryRecent } from './mastery-memory.js';
import {
  aggregateLast7Days,
  applyReviewQueueLimits,
  buildDailyDistribution,
  buildForecast,
  computeStreak,
  retentionPercent,
} from './review-logic.js';
import { getReviewSettings, updateReviewSettings } from './review-settings.js';
import { scheduleReview } from './sm2.js';
import { insertInitialReviewState } from './state-init.js';

export { getReviewSettings, updateReviewSettings } from './review-settings.js';

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

  const [dueRows, settings, reviewedRow] = await Promise.all([
    getDb()
      .select({ state: reviewStates, card: cards })
      .from(reviewStates)
      .innerJoin(cards, eq(cards.id, reviewStates.cardId))
      .where(
        and(eq(reviewStates.userId, userId), eq(cards.userId, userId), lte(reviewStates.dueAt, dayEnd)),
      )
      .orderBy(asc(reviewStates.dueAt), asc(reviewStates.cardId)),
    getReviewSettings(userId),
    getDb()
      .select({ n: sql<number>`count(distinct ${reviewLogs.cardId})::int` })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, dayStart),
          lte(reviewLogs.reviewedAt, dayEnd),
        ),
      )
      .then((rows) => rows[0]),
  ]);

  const limited = applyReviewQueueLimits(
    dueRows.map((row) => ({ row, reps: row.state.reps })),
    settings,
  );
  const selectedRows = limited.selected.map((item) => item.row);

  const questionsByCard = await loadQuestionsByCard(selectedRows.map((row) => row.card.id));
  const placements = await loadMapPlacements(selectedRows.map((row) => row.card));
  const items: ReviewQueueItem[] = selectedRows.map((row) => ({
    card: toPublicCard(row.card, questionsByCard.get(row.card.id) ?? []),
    reviewState: toPublicReviewState(row.state),
    mapPlacement: placements.get(row.card.id) ?? null,
  }));

  const reviewedToday = Number(reviewedRow?.n ?? 0);
  return {
    items,
    reviewedToday,
    total: reviewedToday + items.length,
    truncated: limited.truncated,
  };
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

    const settings = await getReviewSettings(userId);

    if (!state) {
      await insertInitialReviewState(userId, cardId, now, tx, undefined, settings.startingEase);
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
      settings,
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

    await upsertCardMasteryRecent(tx, { userId, cardId, now });

    let evolveJobId: string | undefined;
    const evolveReason = evolveReasonFor(feedback, next.lapses);
    if (evolveReason) {
      const job = await enqueueJob(tx, {
        userId,
        type: 'evolve',
        payload: { cardId, reason: evolveReason },
      });
      evolveJobId = job.id;
    }

    let analyzeJobId: string | undefined;
    if (feedback === 'forgot' || feedback === 'fuzzy') {
      try {
        const analyzeJob = await maybeEnqueueAnalyzePatterns(tx, userId, now);
        if (analyzeJob) analyzeJobId = analyzeJob.id;
      } catch (err) {
        logger.error('evolve.analyze_enqueue_failed', err);
      }
    }

    const result: ReviewFeedbackResult = {
      reviewState: toPublicReviewState(updated),
      log: toPublicLog(log),
    };
    if (evolveJobId !== undefined) result.evolveJobId = evolveJobId;
    if (analyzeJobId !== undefined) result.analyzeJobId = analyzeJobId;
    return result;
  });
}

export async function getReviewStats(userId: string, now = new Date()): Promise<ReviewStats> {
  const forecastEnd = endOfLocalDay(addLocalDays(now, 6));

  const [logRows, cardCountRow, stateRows] = await Promise.all([
    getDb()
      .select({
        reviewedAt: reviewLogs.reviewedAt,
        feedback: reviewLogs.feedback,
      })
      .from(reviewLogs)
      .where(eq(reviewLogs.userId, userId)),
    getDb()
      .select({ n: count() })
      .from(cards)
      .where(eq(cards.userId, userId))
      .then((rows) => rows[0]),
    getDb()
      .select({
        intervalDays: reviewStates.intervalDays,
        dueAt: reviewStates.dueAt,
      })
      .from(reviewStates)
      .innerJoin(cards, and(eq(cards.id, reviewStates.cardId), eq(cards.userId, userId)))
      .where(eq(reviewStates.userId, userId)),
  ]);

  const daily = buildDailyDistribution(logRows, now);
  const last7Days = aggregateLast7Days(daily);
  const streak = computeStreak(
    logRows.map((row) => localDateKey(row.reviewedAt)),
    now,
  );
  const masteredCount = stateRows.filter((row) => row.intervalDays >= 21).length;
  const overdueCount = stateRows.filter((row) => row.dueAt.getTime() <= endOfLocalDay(now).getTime())
    .length;
  const forecastDue = stateRows
    .map((row) => row.dueAt)
    .filter((dueAt) => dueAt.getTime() <= forecastEnd.getTime());

  return {
    last7Days,
    overdueCount,
    streak,
    totalCards: Number(cardCountRow?.n ?? 0),
    masteredCount,
    retention7d: retentionPercent(last7Days.remembered, last7Days.total),
    reviews7d: last7Days.total,
    daily,
    forecast: buildForecast(forecastDue, now),
  };
}
