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
