import type { Job, ListJobsQuery, Paginated } from '@inwit/dto';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { jobs, type JobRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { CANCEL_REASON } from './queue.js';

export function toPublicJob(row: JobRow): Job {
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
  };
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
  return toPublicJob(await getOwned(userId, id));
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
    items: rows.map(toPublicJob),
    total: Number(totalRow?.n ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
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
  return toPublicJob(row);
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
  return toPublicJob(row);
}
