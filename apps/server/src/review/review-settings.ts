import { mergeReviewSettings, type ReviewSettings } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { AppError } from '../errors.js';

export { mergeReviewSettings };

export async function getReviewSettings(userId: string): Promise<ReviewSettings> {
  const [row] = await getDb()
    .select({ reviewSettings: users.reviewSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return mergeReviewSettings(row?.reviewSettings ?? null);
}

export async function updateReviewSettings(
  userId: string,
  input: ReviewSettings,
): Promise<ReviewSettings> {
  const now = new Date();
  const settings = mergeReviewSettings(input);
  const [row] = await getDb()
    .update(users)
    .set({ reviewSettings: settings, updatedAt: now })
    .where(eq(users.id, userId))
    .returning({ reviewSettings: users.reviewSettings });
  if (!row) throw AppError.of(401, 'INVALID_TOKEN');
  return mergeReviewSettings(row.reviewSettings);
}
