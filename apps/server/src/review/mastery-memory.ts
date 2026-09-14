import type { MemoryContent, ReviewFeedback } from '@inwit/dto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { memories, reviewLogs, type MemoryRow } from '../db/schema.js';

export const MASTERY_RECENT_LIMIT = 5;
export const MASTERY_CARD_KEY_PREFIX = 'card:';

export type MemoryWriter = Pick<Database, 'select' | 'insert' | 'update'>;

export interface MasteryRecentEntry {
  feedback: ReviewFeedback;
  reviewedAt: string;
}

export function masteryCardKey(cardId: string): string {
  return `${MASTERY_CARD_KEY_PREFIX}${cardId}`;
}

function asFeedback(value: unknown): ReviewFeedback | null {
  if (value === 'forgot' || value === 'fuzzy' || value === 'remembered') return value;
  return null;
}

export function parseMasteryRecent(content: MemoryContent | undefined | null): MasteryRecentEntry[] {
  const raw = content?.recent;
  if (!Array.isArray(raw)) return [];
  const out: MasteryRecentEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { feedback?: unknown; reviewedAt?: unknown };
    const feedback = asFeedback(rec.feedback);
    if (!feedback || typeof rec.reviewedAt !== 'string' || rec.reviewedAt.length === 0) continue;
    out.push({ feedback, reviewedAt: rec.reviewedAt });
  }
  return out;
}

function reviewedAtMs(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function recentFromLogs(
  logs: ReadonlyArray<{ feedback: ReviewFeedback; reviewedAt: Date | string }>,
  limit = MASTERY_RECENT_LIMIT,
): MasteryRecentEntry[] {
  return logs
    .slice()
    .sort((a, b) => reviewedAtMs(a.reviewedAt) - reviewedAtMs(b.reviewedAt))
    .slice(-limit)
    .map((log) => ({
      feedback: log.feedback,
      reviewedAt: log.reviewedAt instanceof Date ? log.reviewedAt.toISOString() : log.reviewedAt,
    }));
}

export function mergeMasteryContent(
  existing: MemoryContent | undefined | null,
  patch: MemoryContent,
): MemoryContent {
  return { ...(existing ?? {}), ...patch };
}

async function findUserMastery(
  db: MemoryWriter,
  userId: string,
  key: string,
): Promise<MemoryRow | undefined> {
  const [row] = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.scope, 'user'),
        isNull(memories.scopeId),
        eq(memories.layer, 'mastery'),
        eq(memories.key, key),
      ),
    )
    .limit(1);
  return row;
}

export async function upsertUserMasteryMemory(
  db: MemoryWriter,
  input: { userId: string; key: string; content: MemoryContent; now?: Date },
): Promise<MemoryRow> {
  const now = input.now ?? new Date();
  const existing = await findUserMastery(db, input.userId, input.key);
  if (existing) {
    const [updated] = await db
      .update(memories)
      .set({ content: input.content, updatedAt: now })
      .where(eq(memories.id, existing.id))
      .returning();
    if (!updated) throw new Error('failed to update mastery memory');
    return updated;
  }
  try {
    const [inserted] = await db
      .insert(memories)
      .values({
        userId: input.userId,
        scope: 'user',
        scopeId: null,
        layer: 'mastery',
        key: input.key,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) throw new Error('failed to insert mastery memory');
    return inserted;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findUserMastery(db, input.userId, input.key);
    if (!raced) throw err;
    const [updated] = await db
      .update(memories)
      .set({ content: input.content, updatedAt: now })
      .where(eq(memories.id, raced.id))
      .returning();
    if (!updated) throw err;
    return updated;
  }
}

export async function loadUserMasteryMemory(
  db: MemoryWriter,
  userId: string,
  key: string,
): Promise<MemoryRow | undefined> {
  return findUserMastery(db, userId, key);
}

/** Upsert `memories(scope=user, layer=mastery, key=card:<id>)` with the last 5 review logs. */
export async function upsertCardMasteryRecent(
  db: MemoryWriter,
  input: { userId: string; cardId: string; now?: Date },
): Promise<MemoryRow> {
  const now = input.now ?? new Date();
  const key = masteryCardKey(input.cardId);
  const logs = await db
    .select({
      feedback: reviewLogs.feedback,
      reviewedAt: reviewLogs.reviewedAt,
    })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, input.userId), eq(reviewLogs.cardId, input.cardId)))
    .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
    .limit(MASTERY_RECENT_LIMIT);

  const existing = await findUserMastery(db, input.userId, key);
  const recent = recentFromLogs(logs);
  const content = mergeMasteryContent(existing?.content, { recent });
  return upsertUserMasteryMemory(db, { userId: input.userId, key, content, now });
}
