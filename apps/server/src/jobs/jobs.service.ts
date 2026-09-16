import type { Job, JobQueue, JobUsage, ListJobsQuery, Paginated } from '@inwit/dto';
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  agentExecutions,
  cards,
  documents,
  jobs,
  llmUsageLogs,
  topics,
  type JobRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { endOfLocalDay, startOfLocalDay, startOfLocalDayDaysAgo } from '../review/review-logic.js';
import {
  PENDING_QUEUE_LIMIT,
  USAGE_DAYS,
  aggregateJobUsage,
  collectRelatedIds,
  relatedForJob,
  startedElapsedSec,
  summarizeJob,
  type JobRelated,
  type JobRelatedMaps,
} from './job-view.js';
import { CANCEL_REASON } from './queue.js';

export function toPublicJob(row: JobRow, related?: JobRelated): Job {
  const { summary, description } = summarizeJob(row.type, row.payload, related);
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    status: row.status,
    payload: row.payload,
    runAt: row.runAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    summary,
    description,
  };
}

async function loadRelatedMaps(userId: string, rows: JobRow[]): Promise<JobRelatedMaps> {
  const ids = collectRelatedIds(rows);
  const documentsById = new Map<string, { title: string | null }>();
  const cardsById = new Map<string, { topicId: string | null }>();
  const extraTopicIds: string[] = [];

  if (ids.documentIds.length > 0) {
    const docRows = await getDb()
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.id, ids.documentIds)));
    for (const doc of docRows) {
      documentsById.set(doc.id, { title: doc.title });
    }
  }

  if (ids.cardIds.length > 0) {
    const cardRows = await getDb()
      .select({ id: cards.id, topicId: cards.topicId })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, ids.cardIds)));
    for (const card of cardRows) {
      cardsById.set(card.id, { topicId: card.topicId });
      if (card.topicId) extraTopicIds.push(card.topicId);
    }
  }

  const topicIds = [...new Set([...ids.topicIds, ...extraTopicIds])];
  const topicsById = new Map<string, string>();
  if (topicIds.length > 0) {
    const topicRows = await getDb()
      .select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(and(eq(topics.userId, userId), inArray(topics.id, topicIds)));
    for (const topic of topicRows) {
      topicsById.set(topic.id, topic.title);
    }
  }

  return { documentsById, cardsById, topicsById };
}

async function toHydratedJobs(userId: string, rows: JobRow[]): Promise<Job[]> {
  if (rows.length === 0) return [];
  const maps = await loadRelatedMaps(userId, rows);
  return rows.map((row) => toPublicJob(row, relatedForJob(row, maps)));
}

async function toHydratedJob(userId: string, row: JobRow): Promise<Job> {
  const [job] = await toHydratedJobs(userId, [row]);
  if (!job) return toPublicJob(row);
  return job;
}

function withQueueFields(job: Job, row: JobRow, now: Date): Job {
  if (row.status === 'running') {
    return { ...job, startedElapsedSec: startedElapsedSec(row.updatedAt, now) };
  }
  if (row.status === 'pending') {
    return { ...job, scheduledFor: row.runAt.toISOString() };
  }
  return job;
}

async function getOwned(userId: string, id: string): Promise<JobRow> {
  const [row] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'JOB_NOT_FOUND');
  return row;
}

export async function getJob(userId: string, id: string): Promise<Job> {
  return toHydratedJob(userId, await getOwned(userId, id));
}

export async function listJobs(userId: string, query: ListJobsQuery): Promise<Paginated<Job>> {
  const conditions: SQL[] = [eq(jobs.userId, userId)];
  if (query.status !== undefined) conditions.push(eq(jobs.status, query.status));
  if (query.type !== undefined) conditions.push(eq(jobs.type, query.type));
  const where = and(...conditions);

  const [totalRow] = await getDb().select({ n: count() }).from(jobs).where(where);
  const rows = await getDb()
    .select()
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: await toHydratedJobs(userId, rows),
    total: Number(totalRow?.n ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

function statusCount(
  rows: Array<{ status: JobRow['status']; n: number | string | bigint }>,
  status: JobRow['status'],
): number {
  const hit = rows.find((row) => row.status === status);
  return Number(hit?.n ?? 0);
}

export async function getJobQueue(userId: string, now = new Date()): Promise<JobQueue> {
  const owned = eq(jobs.userId, userId);
  const dayStart = startOfLocalDay(now);
  const dayEnd = endOfLocalDay(now);

  const [runningRows, pendingRows, statusRows, doneTodayRow] = await Promise.all([
    getDb()
      .select()
      .from(jobs)
      .where(and(owned, eq(jobs.status, 'running')))
      .orderBy(desc(jobs.updatedAt), desc(jobs.id)),
    getDb()
      .select()
      .from(jobs)
      .where(and(owned, eq(jobs.status, 'pending')))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(PENDING_QUEUE_LIMIT),
    getDb()
      .select({ status: jobs.status, n: count() })
      .from(jobs)
      .where(owned)
      .groupBy(jobs.status),
    getDb()
      .select({ n: count() })
      .from(jobs)
      .where(
        and(
          owned,
          eq(jobs.status, 'done'),
          gte(jobs.finishedAt, dayStart),
          lte(jobs.finishedAt, dayEnd),
        ),
      ),
  ]);

  const [runningJobs, pendingJobs] = await Promise.all([
    toHydratedJobs(userId, runningRows),
    toHydratedJobs(userId, pendingRows),
  ]);

  return {
    running: runningJobs.map((job, i) => withQueueFields(job, runningRows[i]!, now)),
    pending: pendingJobs.map((job, i) => withQueueFields(job, pendingRows[i]!, now)),
    counts: {
      running: statusCount(statusRows, 'running'),
      pending: statusCount(statusRows, 'pending'),
      doneToday: Number(doneTodayRow[0]?.n ?? 0),
      failed: statusCount(statusRows, 'failed'),
    },
  };
}

export async function getJobUsage(userId: string, now = new Date()): Promise<JobUsage> {
  const from = startOfLocalDayDaysAgo(now, USAGE_DAYS - 1);
  const rows = await getDb()
    .select({
      createdAt: llmUsageLogs.createdAt,
      tokens: llmUsageLogs.totalTokens,
      agentType: agentExecutions.agentType,
      capability: llmUsageLogs.capability,
    })
    .from(llmUsageLogs)
    .leftJoin(agentExecutions, eq(llmUsageLogs.executionId, agentExecutions.id))
    .where(and(eq(llmUsageLogs.userId, userId), gte(llmUsageLogs.createdAt, from)));

  return aggregateJobUsage(
    rows.map((row) => ({
      createdAt: row.createdAt,
      tokens: Number(row.tokens ?? 0),
      type: row.agentType ?? row.capability,
    })),
    now,
    USAGE_DAYS,
  );
}

export async function retryJob(userId: string, id: string): Promise<Job> {
  await getOwned(userId, id);
  const now = new Date();
  const [row] = await getDb()
    .update(jobs)
    .set({
      status: 'pending',
      runAt: now,
      lastError: null,
      finishedAt: null,
      attempts: 0,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, 'failed')))
    .returning();
  if (!row) throw AppError.of(409, 'JOB_NOT_RETRYABLE');
  return toHydratedJob(userId, row);
}

export async function cancelJob(userId: string, id: string): Promise<Job> {
  await getOwned(userId, id);
  const now = new Date();
  const [row] = await getDb()
    .update(jobs)
    .set({
      status: 'failed',
      lastError: CANCEL_REASON,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, 'pending')))
    .returning();
  if (!row) throw AppError.of(409, 'JOB_NOT_CANCELABLE');
  return toHydratedJob(userId, row);
}
