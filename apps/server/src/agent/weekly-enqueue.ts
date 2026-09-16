import { WEEKLY_REPORT_TITLE_MARK, type Job, type WeeklyReportLatest } from '@inwit/dto';
import { and, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { cardLinks, cards, documents, jobs, reviewLogs, users, type JobRow } from '../db/schema.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { loadUserMasteryMemory } from '../review/mastery-memory.js';
import {
  endOfWeekExclusive,
  parseWeeklyReportMemory,
  shouldAutoEnqueueWeeklyReport,
  startOfWeekMonday,
  toWeeklyReportLatest,
  weekStartKey,
  weeklyReportMemoryKey,
} from './weekly-logic.js';

export const WEEKLY_SCAN_MS = 60 * 60 * 1000;

/** Smoke / ops: skip the hourly user scan (manual POST still works). */
export function weeklyScanEnabled(): boolean {
  const raw = process.env.INWIT_SKIP_WEEKLY_SCAN;
  return raw !== '1' && raw !== 'true';
}

const ACTIVE_STATUSES = ['pending', 'running'] as const;
const AUTO_BLOCK_STATUSES = ['pending', 'running', 'done'] as const;

export type WeeklyEnqueueDb = Pick<Database, 'select' | 'insert'>;

export async function findWeeklyJobsForWeek(
  db: Pick<Database, 'select'>,
  userId: string,
  weekStart: string,
  statuses?: ReadonlyArray<JobRow['status']>,
): Promise<JobRow[]> {
  const conditions = [
    eq(jobs.userId, userId),
    eq(jobs.type, 'weekly_report' as const),
    sql`${jobs.payload}->>'weekStart' = ${weekStart}`,
  ];
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(jobs.status, [...statuses]));
  }
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));
}

async function countWeeklyActivity(
  db: WeeklyEnqueueDb,
  userId: string,
  start: Date,
  endExclusive: Date,
): Promise<{ reviewCount: number; newCards: number; newLinks: number }> {
  const [reviewRow] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(
      and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, start), lt(reviewLogs.reviewedAt, endExclusive)),
    );
  const [cardRow] = await db
    .select({ n: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.createdAt, start), lt(cards.createdAt, endExclusive)));
  const [linkRow] = await db
    .select({ n: count() })
    .from(cardLinks)
    .where(and(eq(cardLinks.userId, userId), gte(cardLinks.createdAt, start), lt(cardLinks.createdAt, endExclusive)));
  return {
    reviewCount: Number(reviewRow?.n ?? 0),
    newCards: Number(cardRow?.n ?? 0),
    newLinks: Number(linkRow?.n ?? 0),
  };
}

export async function maybeEnqueueWeeklyReport(
  db: WeeklyEnqueueDb,
  userId: string,
  now = new Date(),
): Promise<JobRow | null> {
  const weekStart = weekStartKey(now);
  const start = startOfWeekMonday(now);
  const endExclusive = endOfWeekExclusive(start);
  const existing = await findWeeklyJobsForWeek(db, userId, weekStart, AUTO_BLOCK_STATUSES);
  const hasJobThisWeek = existing.length > 0;
  const activity = await countWeeklyActivity(db, userId, start, endExclusive);
  if (!shouldAutoEnqueueWeeklyReport({ hasJobThisWeek, ...activity })) {
    return existing[0] ?? null;
  }
  return enqueueJob(db, {
    userId,
    type: 'weekly_report',
    payload: { weekStart },
  });
}

export async function enqueueWeeklyReport(
  userId: string,
  now = new Date(),
): Promise<{ job: Job; created: boolean }> {
  const db = getDb();
  const weekStart = weekStartKey(now);
  const active = await findWeeklyJobsForWeek(db, userId, weekStart, ACTIVE_STATUSES);
  if (active[0]) return { job: toPublicJob(active[0]), created: false };
  const row = await enqueueJob(db, {
    userId,
    type: 'weekly_report',
    payload: { weekStart },
  });
  return { job: toPublicJob(row), created: true };
}

export async function scanAndEnqueueWeeklyReports(now = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: users.id }).from(users);
  let created = 0;
  for (const row of rows) {
    const before = await findWeeklyJobsForWeek(db, row.id, weekStartKey(now), AUTO_BLOCK_STATUSES);
    const job = await maybeEnqueueWeeklyReport(db, row.id, now);
    if (job && before.length === 0 && job.status === 'pending') created += 1;
  }
  return created;
}

export async function getLatestWeeklyReport(
  userId: string,
  now = new Date(),
): Promise<WeeklyReportLatest | null> {
  const db = getDb();
  const weekStart = weekStartKey(now);
  const memory = await loadUserMasteryMemory(db, userId, weeklyReportMemoryKey(weekStart));
  const parsed = parseWeeklyReportMemory(memory?.content);
  if (parsed.documentId) {
    const [doc] = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(eq(documents.id, parsed.documentId), eq(documents.userId, userId)))
      .limit(1);
    if (doc) {
      return toWeeklyReportLatest({
        documentId: doc.id,
        title: parsed.title || doc.title || WEEKLY_REPORT_TITLE_MARK,
        weekStart: parsed.weekStart || weekStart,
        weekEnd: parsed.weekEnd || weekStart,
        successRate: parsed.successRate ?? 0,
        relearnCount: parsed.relearnCount,
        summary: parsed.summary,
      });
    }
  }
  return null;
}
