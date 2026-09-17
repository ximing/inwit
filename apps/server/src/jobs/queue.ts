import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, type Database } from '../db/index.js';
import { jobs, type JobRow } from '../db/schema.js';
import { markDocumentFailed, pipelineDocumentId } from '../documents/document-status.js';
import { logger } from '../utils/logger.js';
import { heartbeatJob } from './heartbeat.js';
import { processJob } from './processors.js';
import { backoffMs, failureDisposition } from './queue-logic.js';

export { heartbeatJob };
export { enqueueJob, type EnqueueJobInput, type JobWriter } from './enqueue.js';

export const BACKOFF_MS = [2_000, 8_000, 32_000] as const;

const CANCEL_REASON = 'cancelled';

export async function claimDueJobs(now = new Date(), limit = config.WORKER_CLAIM_LIMIT): Promise<JobRow[]> {
  if (limit <= 0) return [];
  return getDb().transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(limit)
      .for('update', { skipLocked: true });

    const claimed: JobRow[] = [];
    for (const candidate of candidates) {
      const [row] = await tx
        .update(jobs)
        .set({
          status: 'running',
          attempts: candidate.attempts + 1,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.status, 'pending')))
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  });
}

export async function recoverStuckJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.WORKER_STUCK_MS);
  const recovered = await getDb()
    .update(jobs)
    .set({
      status: 'pending',
      runAt: now,
      updatedAt: now,
    })
    .where(and(eq(jobs.status, 'running'), lte(jobs.updatedAt, cutoff)))
    .returning({ id: jobs.id });
  return recovered.length;
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const trimmed = raw.trim() || 'unknown error';
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

async function markDone(job: JobRow, now: Date): Promise<void> {
  await getDb()
    .update(jobs)
    .set({
      status: 'done',
      finishedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
}

/** Reflects a job's final failure onto the document it owns (best-effort). */
async function settleDocumentFailure(job: JobRow, message: string): Promise<void> {
  const documentId = pipelineDocumentId(job);
  if (!documentId) return;
  try {
    await markDocumentFailed(job.userId, documentId, message);
  } catch (err) {
    logger.error('job.document_settle_failed', err);
  }
}

async function markFailedTerminal(job: JobRow, message: string, now: Date): Promise<void> {
  await getDb()
    .update(jobs)
    .set({
      status: 'failed',
      lastError: message,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
  logger.warn('job.failed', {
    jobId: job.id,
    type: job.type,
    attempts: job.attempts,
    terminal: true,
    lastError: message,
  });
  await settleDocumentFailure(job, message);
}

async function settleJobFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  const message = errorMessage(err);
  const attempts = job.attempts;
  const disposition = failureDisposition(err, attempts, config.JOB_MAX_ATTEMPTS);
  if (disposition === 'terminal') {
    await markFailedTerminal(job, message, now);
    return;
  }
  if (disposition === 'exhausted') {
    await getDb()
      .update(jobs)
      .set({
        status: 'failed',
        lastError: message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
    logger.warn('job.failed', { jobId: job.id, type: job.type, attempts, lastError: message });
    await settleDocumentFailure(job, message);
    return;
  }
  const wait = backoffMs(attempts, BACKOFF_MS);
  await getDb()
    .update(jobs)
    .set({
      status: 'pending',
      runAt: new Date(now.getTime() + wait),
      lastError: message,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
  logger.warn('job.retry', { jobId: job.id, type: job.type, attempts, waitMs: wait, lastError: message });
}

async function processOne(job: JobRow): Promise<void> {
  const started = Date.now();
  try {
    await processJob(job);
    await markDone(job, new Date());
    logger.info('job.done', { jobId: job.id, type: job.type, ms: Date.now() - started });
  } catch (err) {
    logger.error('job.process.failed', err);
    try {
      await settleJobFailure(job, err, new Date());
    } catch (writeErr) {
      logger.error('job.finalize.failed', writeErr);
    }
  }
}

let stopping = false;
const active = new Set<Promise<void>>();

export async function drainJobs(): Promise<void> {
  stopping = true;
  if (active.size > 0) await Promise.allSettled([...active]);
}

export async function processDueJobs(now = new Date()): Promise<number> {
  if (stopping) return 0;
  const capacity = Math.max(0, config.WORKER_CLAIM_LIMIT - active.size);
  if (capacity <= 0) return 0;
  const claimed = await claimDueJobs(now, capacity);
  for (const job of claimed) {
    const task = processOne(job);
    active.add(task);
    void task.finally(() => {
      active.delete(task);
    });
  }
  return claimed.length;
}

export async function cancelPendingDocumentJobs(
  db: Pick<Database, 'update'>,
  userId: string,
  documentId: string,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'failed',
      lastError: CANCEL_REASON,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.type, ['digest', 'chat', 'selection', 'extract', 'ocr']),
        eq(jobs.status, 'pending'),
        sql`coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId') = ${documentId}`,
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

export { CANCEL_REASON };
