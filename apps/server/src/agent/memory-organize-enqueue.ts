import type { JobPayload } from '@inwit/dto';
import { and, count, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { cardFeedback, jobs, memoryRevisions } from '../db/schema.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { endOfLocalDay, startOfLocalDay } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import {
  dispatchMemoryOrganizePlan,
  memoryOrganizeTrigger,
  planMemoryOrganize,
  type MemoryOrganizePending,
  type MemoryOrganizePlan,
  type MemoryOrganizeTrigger,
} from './memory-organize-logic.js';

type PendingJob = MemoryOrganizePending & { id: string };

interface OrganizeState {
  unconsumed: number;
  revisionsToday: number;
  running: boolean;
  pending: PendingJob | null;
}

async function loadState(userId: string, now: Date): Promise<OrganizeState> {
  const db = getDb();
  const [unconsumedRow] = await db
    .select({ n: count() })
    .from(cardFeedback)
    .where(and(eq(cardFeedback.userId, userId), isNull(cardFeedback.consumedAt)));
  const [revisionRow] = await db
    .select({ n: count() })
    .from(memoryRevisions)
    .where(
      and(
        eq(memoryRevisions.userId, userId),
        gte(memoryRevisions.createdAt, startOfLocalDay(now)),
        lte(memoryRevisions.createdAt, endOfLocalDay(now)),
      ),
    );
  const active = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      runAt: jobs.runAt,
      payload: jobs.payload,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'memory_organize'),
        inArray(jobs.status, ['pending', 'running']),
      ),
    );
  const running = active.some((row) => row.status === 'running');
  const pendingRow = active.find((row) => row.status === 'pending');
  const trigger: MemoryOrganizeTrigger = pendingRow
    ? memoryOrganizeTrigger(pendingRow.payload) ?? 'slot'
    : 'slot';
  return {
    unconsumed: Number(unconsumedRow?.n ?? 0),
    revisionsToday: Number(revisionRow?.n ?? 0),
    running,
    pending: pendingRow ? { id: pendingRow.id, runAt: pendingRow.runAt, trigger } : null,
  };
}

async function postpone(jobId: string, plan: Extract<MemoryOrganizePlan, { action: 'postpone' }>, now: Date): Promise<void> {
  const [row] = await getDb()
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'pending')))
    .limit(1);
  if (!row) return;
  const payload: JobPayload = { ...row.payload, trigger: plan.trigger };
  await getDb()
    .update(jobs)
    .set({ runAt: plan.runAt, payload, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'pending')));
}

async function reconcileUnique(userId: string, now: Date): Promise<void> {
  const state = await loadState(userId, now);
  if (state.running || !state.pending) return;
  const plan = planMemoryOrganize({
    unconsumed: state.unconsumed,
    revisionsToday: state.revisionsToday,
    now,
    running: false,
    pending: { runAt: state.pending.runAt, trigger: state.pending.trigger },
  });
  if (dispatchMemoryOrganizePlan(config.MEMORY_ORGANIZE_ENABLED, plan) !== 'postpone') return;
  if (plan.action !== 'postpone') return;
  await postpone(state.pending.id, plan, now);
}

export async function scheduleMemoryOrganize(userId: string, now = new Date()): Promise<void> {
  const state = await loadState(userId, now);
  const plan = planMemoryOrganize({
    unconsumed: state.unconsumed,
    revisionsToday: state.revisionsToday,
    now,
    running: state.running,
    pending: state.pending,
  });
  const action = dispatchMemoryOrganizePlan(config.MEMORY_ORGANIZE_ENABLED, plan);
  logger.info('memory.organize.plan', {
    userId,
    action,
    reason: action === 'skip' && plan.action === 'enqueue' ? 'disabled' : plan.reason,
    unconsumed: state.unconsumed,
  });
  if (action === 'skip' || plan.action === 'skip') return;
  if (action === 'postpone' && plan.action === 'postpone') {
    if (!state.pending) return;
    await postpone(state.pending.id, plan, now);
    return;
  }
  if (plan.action !== 'enqueue') return;
  // The partial unique index is the lock. Do not SELECT again before INSERT.
  try {
    await enqueueJob(getDb(), {
      userId,
      type: 'memory_organize',
      payload: { trigger: plan.trigger },
      runAt: plan.runAt,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await reconcileUnique(userId, now);
  }
}

export async function scheduleMemoryOrganizeSafely(userId: string): Promise<void> {
  try {
    await scheduleMemoryOrganize(userId);
  } catch (err) {
    logger.error('memory.organize.plan_failed', {
      userId,
      error: err instanceof Error ? err.name : 'error',
    });
  }
}
