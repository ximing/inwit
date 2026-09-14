import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { cards, reviewStates } from '../db/schema.js';
import { MS_PER_DAY } from './sm2.js';

export type ReviewStateWriter = Pick<Database, 'insert'>;

/**
 * New digest cards enter the queue tomorrow. Pass `dueAt` (e.g. `now`) for
 * chat-sourced cards that should join today's queue immediately.
 * Idempotent on (user_id, card_id).
 */
export async function insertInitialReviewState(
  userId: string,
  cardId: string,
  now = new Date(),
  db: ReviewStateWriter = getDb(),
  dueAt?: Date,
): Promise<void> {
  await db
    .insert(reviewStates)
    .values({
      userId,
      cardId,
      dueAt: dueAt ?? new Date(now.getTime() + MS_PER_DAY),
    })
    .onConflictDoNothing();
}

/** Insert review_states for cards that were created before the T6 hook. */
export async function backfillMissingReviewStates(): Promise<number> {
  const missing = await getDb()
    .select({
      id: cards.id,
      userId: cards.userId,
      createdAt: cards.createdAt,
    })
    .from(cards)
    .leftJoin(
      reviewStates,
      and(eq(reviewStates.cardId, cards.id), eq(reviewStates.userId, cards.userId)),
    )
    .where(isNull(reviewStates.id));

  if (missing.length === 0) return 0;

  const values = missing.map((row) => ({
    userId: row.userId,
    cardId: row.id,
    // created+1d, even if that is already past — overdue cards join today's queue.
    dueAt: new Date(row.createdAt.getTime() + MS_PER_DAY),
  }));

  const inserted = await getDb().insert(reviewStates).values(values).onConflictDoNothing().returning({
    id: reviewStates.id,
  });
  return inserted.length;
}
