import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { jobs, type JobRow } from '../db/schema.js';

/** Shown on the job and, for a conversation turn, on the assistant message. */
export const CANCEL_REASON = '已停止';

const cancelledPatch = (now: Date) => ({
  status: 'failed' as const,
  lastError: CANCEL_REASON,
  finishedAt: now,
  updatedAt: now,
});

/**
 * Marks one owned pending or running job failed.
 * Returns undefined when the row is already settled or belongs to someone else.
 * A running executor notices on its next status probe and aborts.
 */
export async function markJobCancelled(
  userId: string,
  id: string,
  now = new Date(),
): Promise<JobRow | undefined> {
  const [row] = await getDb()
    .update(jobs)
    .set(cancelledPatch(now))
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), inArray(jobs.status, ['pending', 'running'])))
    .returning();
  return row;
}

/** Stops the active conversation job for one assistant message, pending or running. */
export async function markConversationJobsCancelled(
  userId: string,
  conversationId: string,
  assistantMessageId: string,
  now = new Date(),
): Promise<void> {
  await getDb()
    .update(jobs)
    .set(cancelledPatch(now))
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'conversation'),
        inArray(jobs.status, ['pending', 'running']),
        sql`${jobs.payload}->>'conversationId' = ${conversationId}`,
        sql`${jobs.payload}->>'assistantMessageId' = ${assistantMessageId}`,
      ),
    );
}
