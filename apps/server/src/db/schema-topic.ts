import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { MAP_NODE_STATUSES, TOPIC_STATUSES } from '@inwit/dto';
import type { MapNodeStatus, TopicStatus } from '@inwit/dto';
import { users } from './schema-auth.js';
import { enumCheck, timestamptz } from './schema-shared.js';

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    goal: text('goal'),
    status: varchar('status', { length: 16 }).$type<TopicStatus>().notNull().default('active'),
    /** 概念图可见性/语义/本文引用变更时同事务递增；graph/view 按此校验一致性。 */
    conceptGraphRevision: integer('concept_graph_revision').notNull().default(1),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_topics_user').on(t.userId),
    index('idx_topics_user_status').on(t.userId, t.status),
    enumCheck('topics_status_check', t.status, TOPIC_STATUSES),
  ],
);

export const mapNodes = pgTable(
  'map_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    status: varchar('status', { length: 16 }).$type<MapNodeStatus>().notNull().default('uncovered'),
    note: text('note'),
    position: integer('position').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_map_nodes_topic_parent').on(t.topicId, t.parentId),
    enumCheck('map_nodes_status_check', t.status, MAP_NODE_STATUSES),
    check(
      'map_nodes_not_self_parent_check',
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    foreignKey({
      name: 'map_nodes_parent_id_map_nodes_id_fk',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('cascade'),
  ],
);

export type TopicRow = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type MapNodeRow = typeof mapNodes.$inferSelect;
export type NewMapNode = typeof mapNodes.$inferInsert;
