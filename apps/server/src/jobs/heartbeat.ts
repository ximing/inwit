import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { jobs } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export async function heartbeatJob(jobId: string, now = new Date()): Promise<void> {
  try {
    await getDb()
      .update(jobs)
      .set({ updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
  } catch (err) {
    logger.warn('job.heartbeat.failed', { jobId, err: String(err) });
  }
}

/**
 * Cooperative-cancellation probe: false means the row left 'running'
 * (cancelled/settled elsewhere) or is gone, so the executor should abort.
 * Returns true on transient read errors — a blip must not kill a healthy run.
 */
export async function isJobRunning(jobId: string): Promise<boolean> {
  try {
    const [row] = await getDb()
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    return row?.status === 'running';
  } catch (err) {
    logger.warn('job.status_probe.failed', { jobId, err: String(err) });
    return true;
  }
}
