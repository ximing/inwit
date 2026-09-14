import { EVOLVE_ANALYZE_ACTION, type Job } from '@inwit/dto';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { agentExecutions, jobs, reviewLogs, type JobRow } from '../db/schema.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import {
  ANALYZE_ACTION,
  ANALYZE_DEBOUNCE_MS,
  ANALYZE_LOOKBACK_DAYS,
  ANALYZE_STRUGGLING_MIN_HITS,
  localDateKey,
  shouldEnqueueDailyAnalyze,
} from './analyze-logic.js';

function startOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

export type AnalyzeEnqueueDb = Pick<Database, 'select' | 'insert'>;

export async function countTodayForgotFuzzy(
  db: AnalyzeEnqueueDb,
  userId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        inArray(reviewLogs.feedback, ['forgot', 'fuzzy']),
        gte(reviewLogs.reviewedAt, startOfLocalDay(now)),
        lte(reviewLogs.reviewedAt, endOfLocalDay(now)),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function countStrugglingCards(
  db: AnalyzeEnqueueDb,
  userId: string,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - ANALYZE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ cardId: reviewLogs.cardId })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, cutoff),
        inArray(reviewLogs.feedback, ['forgot', 'fuzzy']),
      ),
    )
    .groupBy(reviewLogs.cardId)
    .having(sql`count(*) >= ${ANALYZE_STRUGGLING_MIN_HITS}`);
  return rows.length;
}

export async function findAnalyzeJobsForDate(
  db: Pick<Database, 'select'>,
  userId: string,
  date: string,
  statuses?: Array<JobRow['status']>,
): Promise<JobRow[]> {
  const conditions = [
    eq(jobs.userId, userId),
    eq(jobs.type, 'evolve' as const),
    sql`${jobs.payload}->>'action' = ${ANALYZE_ACTION}`,
    sql`${jobs.payload}->>'date' = ${date}`,
  ];
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(jobs.status, statuses));
  }
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));
}

export async function findAnalyzeJobForDate(
  db: Pick<Database, 'select'>,
  userId: string,
  date: string,
  statuses?: Array<JobRow['status']>,
): Promise<JobRow | undefined> {
  const [row] = await findAnalyzeJobsForDate(db, userId, date, statuses);
  return row;
}

function isTooFewSummary(summary: string | null | undefined): boolean {
  return typeof summary === 'string' && summary.includes('skipped=too_few');
}

async function successfulAnalyzeJob(
  db: Pick<Database, 'select'>,
  rows: JobRow[],
): Promise<JobRow | undefined> {
  const done = rows.filter((row) => row.status === 'done');
  if (done.length === 0) return undefined;
  const exes = await db
    .select({
      jobId: agentExecutions.jobId,
      status: agentExecutions.status,
      resultSummary: agentExecutions.resultSummary,
    })
    .from(agentExecutions)
    .where(
      inArray(
        agentExecutions.jobId,
        done.map((row) => row.id),
      ),
    );
  for (const job of done) {
    const exe = exes.find((row) => row.jobId === job.id);
    if (exe?.status === 'done' && !isTooFewSummary(exe.resultSummary)) return job;
  }
  return undefined;
}

export async function maybeEnqueueAnalyzePatterns(
  db: AnalyzeEnqueueDb,
  userId: string,
  now = new Date(),
): Promise<JobRow | null> {
  const todayCount = await countTodayForgotFuzzy(db, userId, now);
  const struggling = await countStrugglingCards(db, userId, now);
  const date = localDateKey(now);
  const existing = await findAnalyzeJobsForDate(db, userId, date);
  const active = existing.find((row) => row.status === 'pending' || row.status === 'running');
  const successful = await successfulAnalyzeJob(db, existing);
  if (!shouldEnqueueDailyAnalyze(todayCount, struggling, Boolean(active || successful))) {
    return active ?? successful ?? null;
  }
  return enqueueJob(db, {
    userId,
    type: 'evolve',
    payload: { action: EVOLVE_ANALYZE_ACTION, date },
    runAt: new Date(now.getTime() + ANALYZE_DEBOUNCE_MS),
  });
}

export async function enqueueAnalyzePatterns(
  userId: string,
  now = new Date(),
): Promise<{ job: Job; created: boolean }> {
  const db = getDb();
  const date = localDateKey(now);
  const active = await findAnalyzeJobForDate(db, userId, date, ['pending', 'running']);
  if (active) return { job: toPublicJob(active), created: false };
  const row = await enqueueJob(db, {
    userId,
    type: 'evolve',
    payload: { action: EVOLVE_ANALYZE_ACTION, date },
  });
  return { job: toPublicJob(row), created: true };
}
