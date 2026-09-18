import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { docDisplayTitle, type MemoryContent } from '@inwit/dto';
import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { annotations, cardLinks, cards, documents, mapNodes, reviewLogs, reviewStates, topics } from '../db/schema.js';
import { markdownToContentJson } from '../documents/content-json.js';
import { clipChars } from '../retrieval/search-logic.js';
import { loadUserMasteryMemory, upsertUserMasteryMemory } from '../review/mastery-memory.js';
import {
  WEEKLY_ANNOTATION_LIMIT,
  WEEKLY_RELEARN_LIMIT,
  coveragePct,
  defaultWeeklySummary,
  endOfWeekExclusive,
  endOfWeekSunday,
  ensureWeeklyReportBody,
  localDateKey,
  startOfWeekMonday,
  successRateFromCounts,
  weeklyReportMemoryKey,
  weeklyReportTitle,
  type WeekAnnotationItem,
  type WeekRelearnConcept,
  type WeekStats,
  type WeekTopicCoverage,
} from './weekly-logic.js';

export interface WeeklySession {
  userId: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  range: { start: Date; endExclusive: Date };
  stats: WeekStats | null;
  documentId: string | null;
  wroteDocument: boolean;
  memoryWritten: boolean;
}

export function createWeeklySession(userId: string, now = new Date()): WeeklySession {
  const start = startOfWeekMonday(now);
  const endExclusive = endOfWeekExclusive(start);
  const sunday = endOfWeekSunday(start);
  return {
    userId,
    weekStart: localDateKey(start),
    weekEnd: localDateKey(sunday),
    title: weeklyReportTitle(start),
    range: { start, endExclusive },
    stats: null,
    documentId: null,
    wroteDocument: false,
    memoryWritten: false,
  };
}

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

export async function loadWeekStats(session: WeeklySession): Promise<WeekStats> {
  if (session.stats) return session.stats;
  const stats = await queryWeekStats(session.userId, session);
  session.stats = stats;
  return stats;
}

async function queryWeekStats(userId: string, session: WeeklySession): Promise<WeekStats> {
  const { start, endExclusive } = session.range;
  const db = getDb();

  const distRows = await db
    .select({
      feedback: reviewLogs.feedback,
      n: count(),
    })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, start),
        lt(reviewLogs.reviewedAt, endExclusive),
      ),
    )
    .groupBy(reviewLogs.feedback);

  const reviews = { remembered: 0, fuzzy: 0, forgot: 0, total: 0 };
  for (const row of distRows) {
    reviews[row.feedback] = Number(row.n);
    reviews.total += Number(row.n);
  }

  const [cardRow] = await db
    .select({ n: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.createdAt, start), lt(cards.createdAt, endExclusive), isNull(cards.deletedAt)));

  const [linkRow] = await db
    .select({ n: count() })
    .from(cardLinks)
    .where(
      and(eq(cardLinks.userId, userId), gte(cardLinks.createdAt, start), lt(cardLinks.createdAt, endExclusive)),
    );

  const [annotationRow] = await db
    .select({ n: count() })
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        gte(annotations.createdAt, start),
        lt(annotations.createdAt, endExclusive),
        isNull(annotations.deletedAt),
      ),
    );

  const annotationRows = await db
    .select({
      id: annotations.id,
      documentId: annotations.documentId,
      kind: annotations.kind,
      quote: annotations.quote,
      note: annotations.note,
      docTitle: documents.title,
      docDescription: documents.description,
    })
    .from(annotations)
    .innerJoin(documents, eq(documents.id, annotations.documentId))
    .where(
      and(
        eq(annotations.userId, userId),
        gte(annotations.createdAt, start),
        lt(annotations.createdAt, endExclusive),
        isNull(annotations.deletedAt),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(annotations.createdAt))
    .limit(WEEKLY_ANNOTATION_LIMIT);

  const weekAnnotations: WeekAnnotationItem[] = annotationRows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentTitle: docDisplayTitle({ title: row.docTitle, description: row.docDescription }),
    kind: row.kind,
    quote: clipChars(row.quote, 80),
    note: clipChars(row.note, 120),
  }));

  const topicRows = await db
    .select({
      topicId: topics.id,
      title: topics.title,
      totalNodes: sql<number>`count(${mapNodes.id})::int`,
      uncoveredNodes: sql<number>`count(*) filter (where ${mapNodes.status} = 'uncovered')::int`,
    })
    .from(topics)
    .leftJoin(mapNodes, eq(mapNodes.topicId, topics.id))
    .where(and(eq(topics.userId, userId), eq(topics.status, 'active')))
    .groupBy(topics.id, topics.title);

  const topicCoverage: WeekTopicCoverage[] = topicRows.map((row) => {
    const totalNodes = Number(row.totalNodes);
    const uncoveredNodes = Number(row.uncoveredNodes);
    return {
      topicId: row.topicId,
      title: row.title,
      totalNodes,
      uncoveredNodes,
      coveragePct: coveragePct(totalNodes, uncoveredNodes),
    };
  });

  const lapseRows = await db
    .select({
      cardId: reviewStates.cardId,
      lapses: reviewStates.lapses,
      lastFeedback: reviewStates.lastFeedback,
      concept: cards.concept,
    })
    .from(reviewStates)
    .innerJoin(cards, and(eq(cards.id, reviewStates.cardId), isNull(cards.deletedAt)))
    .where(and(eq(reviewStates.userId, userId), sql`${reviewStates.lapses} > 0`))
    .orderBy(desc(reviewStates.lapses), desc(reviewStates.updatedAt))
    .limit(WEEKLY_RELEARN_LIMIT);

  const relearn: WeekRelearnConcept[] = lapseRows.map((row) => ({
    cardId: row.cardId,
    concept: row.concept,
    lapses: row.lapses,
    lastFeedback: row.lastFeedback,
  }));

  if (relearn.length < WEEKLY_RELEARN_LIMIT) {
    const have = new Set(relearn.map((item) => item.cardId));
    const forgotRows = await db
      .select({
        cardId: reviewLogs.cardId,
        n: sql<number>`count(*)::int`,
        concept: cards.concept,
        lapses: reviewStates.lapses,
        lastFeedback: reviewStates.lastFeedback,
      })
      .from(reviewLogs)
      .innerJoin(cards, and(eq(cards.id, reviewLogs.cardId), isNull(cards.deletedAt)))
      .leftJoin(
        reviewStates,
        and(eq(reviewStates.cardId, reviewLogs.cardId), eq(reviewStates.userId, userId)),
      )
      .where(
        and(
          eq(reviewLogs.userId, userId),
          eq(reviewLogs.feedback, 'forgot'),
          gte(reviewLogs.reviewedAt, start),
          lt(reviewLogs.reviewedAt, endExclusive),
        ),
      )
      .groupBy(reviewLogs.cardId, cards.concept, reviewStates.lapses, reviewStates.lastFeedback)
      .orderBy(sql`count(*) desc`)
      .limit(WEEKLY_RELEARN_LIMIT * 2);

    for (const row of forgotRows) {
      if (relearn.length >= WEEKLY_RELEARN_LIMIT) break;
      if (have.has(row.cardId)) continue;
      have.add(row.cardId);
      relearn.push({
        cardId: row.cardId,
        concept: row.concept,
        lapses: Number(row.lapses ?? 0),
        lastFeedback: row.lastFeedback ?? 'forgot',
      });
    }
  }

  return {
    weekStart: session.weekStart,
    weekEnd: session.weekEnd,
    reviews,
    successRate: successRateFromCounts(reviews.remembered, reviews.total),
    newCards: Number(cardRow?.n ?? 0),
    newLinks: Number(linkRow?.n ?? 0),
    topicCoverage,
    relearn,
    annotations: weekAnnotations,
    annotationCount: Number(annotationRow?.n ?? 0),
  };
}

async function upsertWeeklyMemory(
  session: WeeklySession,
  input: { summary: string; relearn?: WeekRelearnConcept[]; now?: Date },
): Promise<{ id: string; key: string }> {
  const stats = session.stats ?? (await loadWeekStats(session));
  const now = input.now ?? new Date();
  const key = weeklyReportMemoryKey(session.weekStart);
  const existing = await loadUserMasteryMemory(getDb(), session.userId, key);
  const relearn = (input.relearn ?? stats.relearn).map((item) => ({
    cardId: item.cardId,
    concept: item.concept,
    lapses: item.lapses,
    lastFeedback: item.lastFeedback,
    ...(item.reason ? { reason: item.reason } : {}),
  }));
  const content: MemoryContent = {
    ...(existing?.content ?? {}),
    summary: input.summary.trim(),
    weekStart: session.weekStart,
    weekEnd: session.weekEnd,
    title: session.title,
    successRate: stats.successRate,
    relearnCount: relearn.length,
    relearn,
    reviews: stats.reviews,
    newCards: stats.newCards,
    newLinks: stats.newLinks,
    annotationCount: stats.annotationCount,
    generatedAt: now.toISOString(),
  };
  if (session.documentId) content.documentId = session.documentId;
  const row = await upsertUserMasteryMemory(getDb(), {
    userId: session.userId,
    key,
    content,
    now,
  });
  session.memoryWritten = true;
  return { id: row.id, key };
}

export const readWeekStatsSchema = Type.Object({});
export type ReadWeekStatsArgs = Static<typeof readWeekStatsSchema>;

export function readWeekStatsTool(session: WeeklySession): AgentTool<typeof readWeekStatsSchema> {
  return {
    name: 'read_week_stats',
    label: '读取本周统计',
    description:
      '读取本周（周一起）SQL 聚合：三档回忆分布与成功率、复习总次数、新卡片数、新建关联边数、各主题地图覆盖率、lapses 最多的 3 个概念（含 cardId）、本周新批注列表（含 documentId/annotationId）。必须先调用。统计不消耗 token。',
    parameters: readWeekStatsSchema,
    execute: async () => {
      const stats = await loadWeekStats(session);
      const payload = {
        ...stats,
        hint: '用这些数字写复盘。建议重学的概念若有 cardId，正文必须写成 markdown 链接 [概念](/cards/<cardId>)，并各写一句理由。',
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const weeklyWriteDocumentSchema = Type.Object({
  contentMd: Type.String({ minLength: 20, maxLength: 100_000 }),
});
export type WeeklyWriteDocumentArgs = Static<typeof weeklyWriteDocumentSchema>;

export function weeklyWriteDocumentTool(
  session: WeeklySession,
): AgentTool<typeof weeklyWriteDocumentSchema> {
  return {
    name: 'write_document',
    label: '写入复盘文档',
    description:
      '把本周复盘写成一篇文档（source=agent）。标题由系统写成「M/D–M/D 学习复盘」。正文必须包含：数据小结（三档分布/成功率/新卡/新边/覆盖率）、自然语言点评（这周哪里稳、哪里在遗忘）、建议重学的概念（每个一句话理由，markdown 链接到 /cards/:id）。本轮最多 1 篇。',
    parameters: weeklyWriteDocumentSchema,
    execute: async (_id, params) => {
      const stats = await loadWeekStats(session);
      if (session.wroteDocument && session.documentId) {
        const payload = {
          reused: true,
          documentId: session.documentId,
          title: session.title,
          reason: '本轮最多 1 篇复盘文档',
        };
        return toolResult(JSON.stringify(payload), payload);
      }

      const contentMd = ensureWeeklyReportBody(params.contentMd, stats);
      const [row] = await getDb()
        .insert(documents)
        .values({
          userId: session.userId,
          title: session.title,
          contentJson: markdownToContentJson(contentMd),
          source: 'agent',
          kind: 'weekly_report',
          reportWeekStart: session.weekStart,
          status: 'digested',
        })
        .returning();
      if (!row) throw new Error('failed to insert weekly report document');

      session.documentId = row.id;
      session.wroteDocument = true;
      session.title = row.title ?? session.title;

      await upsertWeeklyMemory(session, { summary: defaultWeeklySummary(stats) });

      const payload = {
        reused: false,
        id: row.id,
        title: row.title,
        source: row.source,
        status: row.status,
        linkedCardIds: stats.relearn.map((item) => item.cardId),
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const weeklyWriteMemorySchema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 2000 }),
  relearn: Type.Optional(
    Type.Array(
      Type.Object({
        cardId: Type.String({ minLength: 1, maxLength: 36 }),
        reason: Type.String({ minLength: 1, maxLength: 500 }),
      }),
      { maxItems: WEEKLY_RELEARN_LIMIT },
    ),
  ),
});
export type WeeklyWriteMemoryArgs = Static<typeof weeklyWriteMemorySchema>;

export function weeklyWriteMemoryTool(
  session: WeeklySession,
): AgentTool<typeof weeklyWriteMemorySchema> {
  return {
    name: 'write_memory',
    label: '写入复盘摘要',
    description:
      '把本周复盘摘要写入 mastery memory（key=weekly_report:<本周一 YYYY-MM-DD>）。summary 用人话写两三句：这周哪里稳、哪里在遗忘。可选 relearn 给每个建议重学的概念补一句理由。请在 write_document 之后调用。',
    parameters: weeklyWriteMemorySchema,
    execute: async (_id, params) => {
      const stats = await loadWeekStats(session);
      const reasonById = new Map((params.relearn ?? []).map((item) => [item.cardId, item.reason.trim()]));
      const relearn: WeekRelearnConcept[] = stats.relearn.map((item) => {
        const reason = reasonById.get(item.cardId);
        if (!reason) return item;
        return { ...item, reason };
      });
      if (reasonById.size > 0) {
        const owned = await getDb()
          .select({ id: cards.id, concept: cards.concept })
          .from(cards)
          .where(
            and(eq(cards.userId, session.userId), inArray(cards.id, [...reasonById.keys()]), isNull(cards.deletedAt)),
          );
        const known = new Set(relearn.map((item) => item.cardId));
        for (const row of owned) {
          if (known.has(row.id)) continue;
          const reason = reasonById.get(row.id);
          const next: WeekRelearnConcept = {
            cardId: row.id,
            concept: row.concept,
            lapses: 0,
            lastFeedback: null,
          };
          if (reason) next.reason = reason;
          relearn.push(next);
        }
      }
      const row = await upsertWeeklyMemory(session, {
        summary: params.summary,
        relearn: relearn.slice(0, WEEKLY_RELEARN_LIMIT),
      });
      const payload = {
        ok: true,
        id: row.id,
        key: row.key,
        layer: 'mastery' as const,
        documentId: session.documentId,
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export function weeklyTools(session: WeeklySession): AgentTool[] {
  return [readWeekStatsTool(session), weeklyWriteDocumentTool(session), weeklyWriteMemoryTool(session)];
}
