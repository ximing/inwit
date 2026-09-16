import { DEFAULT_REVIEW_SETTINGS, mergeReviewSettings } from '@inwit/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { cards, reviewStates, users } from '../db/schema.js';
import { MS_PER_DAY } from './sm2.js';

export type ReviewStateWriter = Pick<Database, 'insert'>;

async function startingEaseByUserIds(userIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(userIds)];
  const easeByUser = new Map<string, number>();
  if (unique.length === 0) return easeByUser;

  const rows = await getDb()
    .select({ id: users.id, reviewSettings: users.reviewSettings })
    .from(users)
    .where(inArray(users.id, unique));
  const found = new Set<string>();
  for (const row of rows) {
    found.add(row.id);
    easeByUser.set(row.id, mergeReviewSettings(row.reviewSettings).startingEase);
  }
  for (const userId of unique) {
    if (!found.has(userId)) easeByUser.set(userId, DEFAULT_REVIEW_SETTINGS.startingEase);
  }
  return easeByUser;
}

/**
 * New digest cards enter the queue tomorrow. Pass `dueAt` (e.g. `now`) for
 * chat-sourced cards that should join today's queue immediately.
 * Idempotent on (user_id, card_id). Initial ease comes from the user's
 * review settings unless `startingEase` is passed.
 */
export async function insertInitialReviewState(
  userId: string,
  cardId: string,
  now = new Date(),
  db: ReviewStateWriter = getDb(),
  dueAt?: Date | undefined,
  startingEase?: number | undefined,
): Promise<void> {
  const ease =
    startingEase ??
    (await startingEaseByUserIds([userId])).get(userId) ??
    DEFAULT_REVIEW_SETTINGS.startingEase;
  await db
    .insert(reviewStates)
    .values({
      userId,
      cardId,
      ease,
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

  const easeByUser = await startingEaseByUserIds(missing.map((row) => row.userId));
  const values = missing.map((row) => ({
    userId: row.userId,
    cardId: row.id,
    ease: easeByUser.get(row.userId) ?? DEFAULT_REVIEW_SETTINGS.startingEase,
    // created+1d, even if that is already past — overdue cards join today's queue.
    dueAt: new Date(row.createdAt.getTime() + MS_PER_DAY),
  }));

  const inserted = await getDb().insert(reviewStates).values(values).onConflictDoNothing().returning({
    id: reviewStates.id,
  });
  return inserted.length;
}
