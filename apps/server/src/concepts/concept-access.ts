import { and, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  conceptRelations,
  concepts,
  topics,
  type ConceptRelationRow,
  type ConceptRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedTopic } from '../topics/topic.service.js';

export type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** 任何影响概念/关系可见性、语义或本文引用的变更，在同事务内递增图版本。 */
export async function bumpConceptGraphRevision(db: Db, topicId: string): Promise<void> {
  await db
    .update(topics)
    .set({ conceptGraphRevision: sql`${topics.conceptGraphRevision} + 1` })
    .where(eq(topics.id, topicId));
}

/** 主题行锁：同主题的身份判定/提交串行化。同时完成所有权与归档校验。 */
export async function lockActiveTopic(db: Db, userId: string, topicId: string) {
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .for('update')
    .limit(1);
  if (!row) throw AppError.of(404, 'TOPIC_NOT_FOUND');
  if (row.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
  return row;
}

export async function requireActiveTopic(userId: string, topicId: string) {
  const topic = await getOwnedTopic(userId, topicId);
  if (topic.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
  return topic;
}

export async function getOwnedConcept(userId: string, id: string): Promise<ConceptRow> {
  const [row] = await getDb()
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, id), eq(concepts.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
  return row;
}

export async function getOwnedRelation(userId: string, id: string): Promise<ConceptRelationRow> {
  const [row] = await getDb()
    .select()
    .from(conceptRelations)
    .where(and(eq(conceptRelations.id, id), eq(conceptRelations.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
  return row;
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** timestamptz 到 JS Date 会丢微秒；游标时间必须取数据库原文，否则同毫秒行跨页重复。 */
export async function preciseCreatedAt(db: Db, id: string): Promise<string> {
  const [row] = await db
    .select({ value: sql<string>`${concepts.createdAt}::text` })
    .from(concepts)
    .where(eq(concepts.id, id))
    .limit(1);
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return row.value;
}

/** (createdAt, id) 键集游标条件；c 必须是数据库精度的 timestamptz 文本。 */
export function conceptKeysetAfter(cursor: string): SQL {
  const decoded = decodeCursor(cursor);
  const createdAt = typeof decoded?.['c'] === 'string' ? decoded['c'] : null;
  const id = typeof decoded?.['i'] === 'string' ? decoded['i'] : null;
  if (!createdAt || !id) throw AppError.of(400, 'VALIDATION_ERROR');
  return sql`(${concepts.createdAt}, ${concepts.id}) > (${createdAt}::timestamptz, ${id}::uuid)`;
}
