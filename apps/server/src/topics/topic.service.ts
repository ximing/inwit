import type { CreateTopicInput, ListTopicsQuery, Topic, UpdateTopicInput } from '@inwit/dto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { topics, type TopicRow } from '../db/schema.js';
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
  return updateTopic(userId, id, { status: 'archived' });
}

export async function deleteTopic(userId: string, id: string): Promise<void> {
  await getOwnedTopic(userId, id);
  await getDb().delete(topics).where(and(eq(topics.id, id), eq(topics.userId, userId)));
}
