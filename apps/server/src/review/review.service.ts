import { REVIEW_PROTOCOL_CURRENT } from '@inwit/dto';
import type {
  CardQuestion,
  MapPlacement,
  ReviewCheckins,
  ReviewFeedback,
  ReviewFeedbackResult,
  ReviewLog,
  ReviewQueueItem,
  ReviewState,
  ReviewStats,
  ReviewStrugglingCard,
  ReviewTopicStat,
  ReviewToday,
} from '@inwit/dto';
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { toPublicCard, toPublicQuestion } from '../cards/card.mapper.js';
import { getDb } from '../db/index.js';
import {
  cards,
  cardQuestions,
  conceptOperationRequests,
  mapNodes,
  reviewLogs,
  reviewStates,
  topics,
  type ConceptPracticeBindingRow,
  type ReviewLogRow,
  type ReviewStateRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { maybeEnqueueAnalyzePatterns } from '../agent/analyze-enqueue.js';
import { loadStrugglingCards } from '../agent/analyze-tools.js';
import {
  activeBindingOf,
  firstQuestionOf,
  getReviewEligibility,
} from '../concepts/concept-practice.service.js';
import { requestHashOf } from '../concepts/concept-identity.js';
import { enqueueJob } from '../jobs/queue.js';
import { recalculateMapNodeStatus } from '../maps/map.service.js';
import { logger } from '../utils/logger.js';
import { addLocalDays, endOfLocalDay, localDateKey, startOfLocalDay, startOfLocalDayDaysAgo } from '../utils/date.js';
import { evolveReasonFor } from './evolve-reason.js';
import { upsertCardMasteryRecent } from './mastery-memory.js';
import { issueReviewToken, verifyReviewToken } from './review-token.js';
import {
  aggregateLast7Days,
  aggregateTopicStats,
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
    suspendedAt: row.suspendedAt ? row.suspendedAt.toISOString() : null,
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
    bindingId: row.bindingId,
    epochId: row.epochId,
    targetVersion: row.targetVersion,
    questionId: row.questionId,
    reviewRevision: row.reviewRevision,
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

function isIsolatedQueueMiss(err: unknown): err is AppError {
  return err instanceof AppError && err.status === 404;
}

async function eligibilityForQueue(userId: string, cardId: string) {
  try {
    return await getReviewEligibility(getDb(), userId, cardId);
  } catch (err) {
    if (!isIsolatedQueueMiss(err)) throw err;
    logger.warn('review.today.skip_card', { cardId, code: err.code });
    return null;
  }
}

export async function getReviewToday(
  userId: string,
  now = new Date(),
  protocol?: number,
): Promise<ReviewToday> {
  const dayStart = startOfLocalDay(now);
  const dayEnd = endOfLocalDay(now);

  const [dueRows, settings, reviewedRow] = await Promise.all([
    getDb()
      .select({ state: reviewStates, card: cards })
      .from(reviewStates)
      .innerJoin(cards, eq(cards.id, reviewStates.cardId))
      .where(
        and(
          eq(reviewStates.userId, userId),
          eq(cards.userId, userId),
          lte(reviewStates.dueAt, dayEnd),
          isNull(reviewStates.suspendedAt),
          eq(cards.acceptance, 'accepted'),
          isNull(cards.deletedAt),
        ),
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

  // 协议分流：旧客户端不领取受管理卡；协议 2 下受管理卡还需通过知识资格校验。
  // 单卡 404（卡片或绑定已不在）跳过该卡，不让整份今日队列失败。
  const protocolVisible: typeof dueRows = [];
  for (const row of dueRows) {
    const managed = row.card.reviewRevision !== null;
    if (!managed) {
      protocolVisible.push(row);
      continue;
    }
    if (protocol !== REVIEW_PROTOCOL_CURRENT) continue;
    const eligibility = await eligibilityForQueue(userId, row.card.id);
    if (!eligibility?.eligible) continue;
    protocolVisible.push(row);
  }

  const limited = applyReviewQueueLimits(
    protocolVisible.map((row) => ({
      row,
      reps: row.state.reps,
      lapses: row.state.lapses,
      lastFeedback: row.state.lastFeedback ?? null,
    })),
    settings,
  );
  const selectedRows = limited.selected.map((item) => item.row);

  const questionsByCard = await loadQuestionsByCard(selectedRows.map((row) => row.card.id));
  const placements = await loadMapPlacements(selectedRows.map((row) => row.card));
  const items: ReviewQueueItem[] = [];
  for (const row of selectedRows) {
    const questions = questionsByCard.get(row.card.id) ?? [];
    const item: ReviewQueueItem = {
      card: toPublicCard(row.card, questions),
      reviewState: toPublicReviewState(row.state),
      mapPlacement: placements.get(row.card.id) ?? null,
    };
    if (row.card.reviewRevision !== null) {
      try {
        // 受管理卡：固定本次下发的实际首题并签发版本令牌（不含答案）。
        const first = questions[0];
        const binding = await activeBindingOf(getDb(), row.card.id);
        if (first) {
          item.servedQuestionId = first.id;
          item.reviewToken = issueReviewToken({
            userId,
            cardId: row.card.id,
            questionId: first.id,
            reviewRevision: row.card.reviewRevision,
            bindingId: binding?.id ?? null,
            epochId: binding?.epochId ?? null,
            targetVersion: binding?.targetVersion ?? null,
          });
          if (binding) {
            item.knowledgeTarget = {
              kind: binding.conceptId ? 'concept' : 'relation',
              id: binding.conceptId ?? binding.relationId!,
              label: '',
            };
          }
        }
      } catch (err) {
        if (!isIsolatedQueueMiss(err)) throw err;
        logger.warn('review.today.skip_card', { cardId: row.card.id, code: err.code });
        continue;
      }
    }
    items.push(item);
  }

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
  opts?: { reviewToken?: string; requestId?: string },
): Promise<ReviewFeedbackResult> {
  return getDb().transaction(async (tx) => {
    const requestHash = opts?.requestId
      ? requestHashOf({ cardId, feedback, reviewToken: opts.reviewToken ?? null })
      : null;
    if (opts?.requestId && requestHash) {
      const [existingRequest] = await tx
        .select()
        .from(conceptOperationRequests)
        .where(
          and(
            eq(conceptOperationRequests.userId, userId),
            eq(conceptOperationRequests.operation, 'review_feedback'),
            eq(conceptOperationRequests.requestId, opts.requestId),
          ),
        )
        .limit(1);
      if (existingRequest) {
        if (existingRequest.requestHash !== requestHash) {
          throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
        }
        return existingRequest.responseJson as ReviewFeedbackResult;
      }
    }

    // 卡片行锁串行化资格/版本校验与反馈写入（所有变更入口遵守同一锁）。
    const [card] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
      .for('update')
      .limit(1);
    if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');
    if (card.acceptance !== 'accepted') throw AppError.of(409, 'CARD_NOT_ACCEPTED');

    // 受管理卡（reviewRevision 非 null）强制版本令牌与资格校验，解绑后也不退回旧协议。
    let binding: ConceptPracticeBindingRow | null = null;
    if (card.reviewRevision !== null) {
      if (!opts?.reviewToken) throw AppError.of(409, 'REVIEW_CLIENT_UPGRADE_REQUIRED');
      const token = verifyReviewToken(opts.reviewToken);
      if (!token || token.cardId !== cardId || token.userId !== userId) {
        throw AppError.of(409, 'REVIEW_CONTENT_CHANGED');
      }
      if (token.reviewRevision !== card.reviewRevision) {
        throw AppError.of(409, 'REVIEW_CONTENT_CHANGED');
      }
      const eligibility = await getReviewEligibility(tx, userId, cardId);
      if (eligibility.knowledgeBlocks.length > 0) {
        throw AppError.of(409, 'REVIEW_NOT_ELIGIBLE', { reasons: eligibility.knowledgeBlocks });
      }
      binding = eligibility.binding;
      if (binding) {
        if (
          token.bindingId !== binding.id ||
          token.epochId !== binding.epochId ||
          token.targetVersion !== binding.targetVersion
        ) {
          throw AppError.of(409, 'REVIEW_CONTENT_CHANGED');
        }
        if (token.questionId !== binding.questionId) {
          throw AppError.of(409, 'REVIEW_CONTENT_CHANGED');
        }
      }
      // 下发的实际题目必须仍是当前首题（防迟到反馈投到已替换的题目上）。
      const first = await firstQuestionOf(tx, cardId);
      if (!first || first.id !== token.questionId) {
        throw AppError.of(409, 'REVIEW_CONTENT_CHANGED');
      }
    }

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
        // 归属按当前有效绑定由服务端填写，不信任客户端自报。
        bindingId: binding?.id ?? null,
        epochId: binding?.epochId ?? null,
        targetVersion: binding?.targetVersion ?? null,
        questionId: binding?.questionId ?? null,
        reviewRevision: card.reviewRevision,
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

    if (opts?.requestId && requestHash) {
      await tx.insert(conceptOperationRequests).values({
        userId,
        operation: 'review_feedback',
        requestId: opts.requestId,
        requestHash,
        responseJson: result as unknown as Record<string, unknown>,
      });
    }
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
      .where(and(eq(cards.userId, userId), eq(cards.acceptance, 'accepted'), isNull(cards.deletedAt)))
      .then((rows) => rows[0]),
    getDb()
      .select({
        intervalDays: reviewStates.intervalDays,
        dueAt: reviewStates.dueAt,
      })
      .from(reviewStates)
      .innerJoin(
        cards,
        and(
          eq(cards.id, reviewStates.cardId),
          eq(cards.userId, userId),
          eq(cards.acceptance, 'accepted'),
          isNull(cards.deletedAt),
        ),
      )
      .where(and(eq(reviewStates.userId, userId), isNull(reviewStates.suspendedAt))),
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

/** 按月打卡：该月每天复习次数（按本地日期聚合）。month 格式 YYYY-MM。 */
export async function getReviewCheckins(userId: string, month: string): Promise<ReviewCheckins> {
  const [year = 1970, mon = 1] = month.split('-').map(Number);
  const from = new Date(year, mon - 1, 1);
  const to = endOfLocalDay(new Date(year, mon, 0));
  const rows = await getDb()
    .select({ reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, from),
        lte(reviewLogs.reviewedAt, to),
      ),
    );
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const key = localDateKey(row.reviewedAt);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  const days = [...byDate.entries()]
    .map(([date, n]) => ({ date, count: n }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { month, days };
}

/** 近 30 天忘记/模糊 ≥2 次的卡片，按挣扎次数倒序。 */
export async function getStrugglingCards(
  userId: string,
  limit = 5,
  now = new Date(),
): Promise<ReviewStrugglingCard[]> {
  const views = await loadStrugglingCards(userId, now, limit);
  return views.map((view) => ({
    id: view.id,
    concept: view.concept,
    struggleCount: view.struggleCount,
    forgotCount: view.forgotCount,
    fuzzyCount: view.fuzzyCount,
    topicId: view.topicId,
    documentId: view.documentId,
  }));
}

/** 每个主题近 7 天的复习量与想起率（只含这 7 天内有复习的主题）。 */
export async function getReviewTopicStats(
  userId: string,
  now = new Date(),
): Promise<ReviewTopicStat[]> {
  const from = startOfLocalDayDaysAgo(now, 6);
  const rows = await getDb()
    .select({
      topicId: topics.id,
      title: topics.title,
      remembered: sql<number>`count(*) filter (where ${reviewLogs.feedback} = 'remembered')::int`,
      fuzzy: sql<number>`count(*) filter (where ${reviewLogs.feedback} = 'fuzzy')::int`,
      forgot: sql<number>`count(*) filter (where ${reviewLogs.feedback} = 'forgot')::int`,
    })
    .from(reviewLogs)
    .innerJoin(cards, and(eq(cards.id, reviewLogs.cardId), eq(cards.userId, userId)))
    .innerJoin(topics, eq(topics.id, cards.topicId))
    .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, from)))
    .groupBy(topics.id, topics.title);
  return aggregateTopicStats(rows);
}

async function requireActiveOwnedCard(userId: string, cardId: string): Promise<void> {
  const [card] = await getDb()
    .select({ id: cards.id, acceptance: cards.acceptance })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');
  if (card.acceptance !== 'accepted') throw AppError.of(409, 'CARD_NOT_ACCEPTED');
}

/** 已熟悉：leave the review queue until resumed. Idempotent. */
export async function suspendCard(
  userId: string,
  cardId: string,
  now = new Date(),
): Promise<ReviewState> {
  await requireActiveOwnedCard(userId, cardId);
  await insertInitialReviewState(userId, cardId, now);
  const [state] = await getDb()
    .update(reviewStates)
    .set({ suspendedAt: now, updatedAt: now })
    .where(
      and(
        eq(reviewStates.userId, userId),
        eq(reviewStates.cardId, cardId),
        isNull(reviewStates.suspendedAt),
      ),
    )
    .returning();
  if (state) return toPublicReviewState(state);
  const [current] = await getDb()
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
    .limit(1);
  if (!current) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublicReviewState(current);
}

/** 恢复复习（idempotent）。受管理卡的知识阻断不能从这里绕过。 */
export async function resumeCard(
  userId: string,
  cardId: string,
  now = new Date(),
): Promise<ReviewState> {
  await requireActiveOwnedCard(userId, cardId);
  // 旧恢复入口只清手动暂停；知识阻断（needsRefresh/归档/待恢复/题目失配）必须走绑定侧入口。
  const eligibility = await getReviewEligibility(getDb(), userId, cardId);
  if (eligibility.reviewRevision !== null && eligibility.knowledgeBlocks.length > 0) {
    throw AppError.of(409, 'REVIEW_NOT_ELIGIBLE', { reasons: eligibility.knowledgeBlocks });
  }
  await insertInitialReviewState(userId, cardId, now);
  const [state] = await getDb()
    .update(reviewStates)
    .set({ suspendedAt: null, updatedAt: now })
    .where(
      and(
        eq(reviewStates.userId, userId),
        eq(reviewStates.cardId, cardId),
        isNotNull(reviewStates.suspendedAt),
      ),
    )
    .returning();
  if (state) return toPublicReviewState(state);
  const [current] = await getDb()
    .select()
    .from(reviewStates)
    .where(and(eq(reviewStates.userId, userId), eq(reviewStates.cardId, cardId)))
    .limit(1);
  if (!current) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublicReviewState(current);
}
