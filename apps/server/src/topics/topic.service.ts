import type { CreateTopicInput, ListTopicsQuery, Topic, UpdateTopicInput } from '@inwit/dto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { bumpManagedCardRevisions } from '../concepts/concept-review-revision.js';
import { getDb } from '../db/index.js';
import { conceptPracticeBindings, topics, type TopicRow } from '../db/schema.js';
import { AppError } from '../errors.js';

export function toPublicTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    goal: row.goal,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function getOwnedTopic(userId: string, id: string): Promise<TopicRow> {
  const [row] = await getDb()
    .select()
    .from(topics)
    .where(and(eq(topics.id, id), eq(topics.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'TOPIC_NOT_FOUND');
  return row;
}

export async function listTopics(userId: string, query: ListTopicsQuery): Promise<Topic[]> {
  const rows =
    query.status !== undefined
      ? await getDb()
          .select()
          .from(topics)
          .where(and(eq(topics.userId, userId), eq(topics.status, query.status)))
          .orderBy(desc(topics.updatedAt), desc(topics.id))
      : await getDb()
          .select()
          .from(topics)
          .where(eq(topics.userId, userId))
          .orderBy(desc(topics.updatedAt), desc(topics.id));
  return rows.map(toPublicTopic);
}

export async function createTopic(userId: string, input: CreateTopicInput): Promise<Topic> {
  const [row] = await getDb()
    .insert(topics)
    .values({
      userId,
      title: input.title,
      goal: blankToNull(input.goal),
      status: 'active',
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublicTopic(row);
}

export async function getTopic(userId: string, id: string): Promise<Topic> {
  return toPublicTopic(await getOwnedTopic(userId, id));
}

export async function updateTopic(
  userId: string,
  id: string,
  input: UpdateTopicInput,
): Promise<Topic> {
  await getOwnedTopic(userId, id);
  const now = new Date();
  const [row] = await getDb()
    .update(topics)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.goal !== undefined ? { goal: blankToNull(input.goal) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: now,
    })
    .where(and(eq(topics.id, id), eq(topics.userId, userId)))
    .returning();
  if (!row) throw AppError.of(404, 'TOPIC_NOT_FOUND');
  return toPublicTopic(row);
}

export async function archiveTopic(userId: string, id: string): Promise<Topic> {
  await getOwnedTopic(userId, id);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(topics)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(topics.id, id), eq(topics.userId, userId)))
      .returning();
    if (!row) throw AppError.of(404, 'TOPIC_NOT_FOUND');
    // 主题归档暂停其全部概念绑定练习：标记显式恢复门槛并轮换受影响卡片版本。
    // 不写 review_states.suspendedAt（手动暂停与知识阻断分离）；恢复主题后需用户显式 resume。
    const affected = await tx
      .update(conceptPracticeBindings)
      .set({ resumeRequired: true, updatedAt: new Date() })
      .where(and(eq(conceptPracticeBindings.topicId, id), isNull(conceptPracticeBindings.endedAt)))
      .returning({ cardId: conceptPracticeBindings.cardId });
    const cardIds = [...new Set(affected.map((binding) => binding.cardId))];
    await bumpManagedCardRevisions(tx, cardIds);
    return toPublicTopic(row);
  });
}

export async function deleteTopic(userId: string, id: string): Promise<void> {
  await getOwnedTopic(userId, id);
  await getDb().delete(topics).where(and(eq(topics.id, id), eq(topics.userId, userId)));
}
