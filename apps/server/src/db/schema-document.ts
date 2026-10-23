import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ANNOTATION_KINDS,
  CANVAS_NODE_KINDS,
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
} from '@inwit/dto';
import type {
  AnnotationGeometry,
  AnnotationKind,
  CanvasNodeKind,
  CanvasSnapshot,
  DocumentSource,
  DocumentStatus,
} from '@inwit/dto';
import { users } from './schema-auth.js';
import { mapNodes, topics } from './schema-topic.js';
import { cards } from './schema-card.js';
import { enumCheck, timestamptz } from './schema-shared.js';

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    mapNodeId: uuid('map_node_id').references(() => mapNodes.id, { onDelete: 'set null' }),
    title: text('title'),
    description: text('description'),
    contentJson: jsonb('content_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb`),
    source: varchar('source', { length: 16 }).$type<DocumentSource>().notNull(),
    kind: varchar('kind', { length: 16 }).$type<'document' | 'weekly_report'>().notNull().default('document'),
    reportWeekStart: varchar('report_week_start', { length: 10 }),
    status: varchar('status', { length: 16 }).$type<DocumentStatus>().notNull().default('pending'),
    /** Reason for the current 'failed' status; cleared when the pipeline restarts or succeeds. */
    failReason: text('fail_reason'),
    answer: text('answer'),
    linkHint: text('link_hint'),
    /** Object storage key (not a URL). */
    fileKey: text('file_key'),
    fileMime: varchar('file_mime', { length: 255 }),
    fileSize: bigint('file_size', { mode: 'number' }),
    pageCount: integer('page_count'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Soft delete (回收站); non-null rows are hidden from lists and retrieval. */
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('idx_documents_user_created').on(t.userId, t.createdAt),
    index('idx_documents_user_status').on(t.userId, t.status),
    index('idx_documents_topic').on(t.topicId),
    index('idx_documents_map_node').on(t.mapNodeId),
    index('idx_documents_user_kind_week').on(t.userId, t.kind, t.reportWeekStart),
    index('idx_documents_user_deleted').on(t.userId, t.deletedAt),
    enumCheck('documents_kind_check', t.kind, ['document', 'weekly_report']),
    enumCheck('documents_source_check', t.source, DOCUMENT_SOURCES),
    enumCheck('documents_status_check', t.status, DOCUMENT_STATUSES),
  ],
);

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    quote: text('quote').notNull(),
    note: text('note').notNull().default(''),
    kind: varchar('kind', { length: 16 }).$type<AnnotationKind>().notNull().default('text'),
    pageIndex: integer('page_index'),
    anchorBlockIndex: integer('anchor_block_index'),
    geometry: jsonb('geometry').$type<AnnotationGeometry>(),
    /** Object storage key (not a URL). */
    imageKey: text('image_key'),
    positionMs: integer('position_ms'),
    /** Card this annotation was converted into (null = not converted). */
    convertedCardId: uuid('converted_card_id').references(() => cards.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Soft delete (回收站); non-null rows are hidden from lists and retrieval. */
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('idx_annotations_user').on(t.userId),
    index('idx_annotations_document').on(t.documentId),
    index('idx_annotations_converted_card').on(t.convertedCardId),
    enumCheck('annotations_kind_check', t.kind, ANNOTATION_KINDS),
  ],
);

/**
 * 一篇文档的画布树。卡片、批注、文本、图片可以互为父子。
 * 卡片和批注的 id 与原记录相同；没摆过的不写行，读的时候补成根。
 */
export const canvasNodes = pgTable(
  'canvas_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<CanvasNodeKind>().notNull(),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    annotationId: uuid('annotation_id').references(() => annotations.id, { onDelete: 'cascade' }),
    text: text('text'),
    /** Object storage key (not a URL). */
    imageKey: text('image_key'),
    parentId: uuid('parent_id'),
    position: integer('position').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_canvas_nodes_document').on(t.documentId, t.parentId, t.position),
    uniqueIndex('canvas_nodes_card_id_unique').on(t.cardId).where(sql`${t.cardId} IS NOT NULL`),
    uniqueIndex('canvas_nodes_annotation_id_unique')
      .on(t.annotationId)
      .where(sql`${t.annotationId} IS NOT NULL`),
    enumCheck('canvas_nodes_kind_check', t.kind, CANVAS_NODE_KINDS),
    check(
      'canvas_nodes_not_self_check',
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    check(
      'canvas_nodes_shape_check',
      sql`(
        (${t.kind} = 'card' AND ${t.cardId} IS NOT NULL AND ${t.annotationId} IS NULL AND ${t.text} IS NULL AND ${t.imageKey} IS NULL AND ${t.id} = ${t.cardId})
        OR (${t.kind} = 'annotation' AND ${t.annotationId} IS NOT NULL AND ${t.cardId} IS NULL AND ${t.text} IS NULL AND ${t.imageKey} IS NULL AND ${t.id} = ${t.annotationId})
        OR (${t.kind} = 'text' AND ${t.text} IS NOT NULL AND char_length(${t.text}) BETWEEN 1 AND 4000 AND ${t.cardId} IS NULL AND ${t.annotationId} IS NULL AND ${t.imageKey} IS NULL)
        OR (${t.kind} = 'image' AND ${t.imageKey} IS NOT NULL AND char_length(${t.imageKey}) BETWEEN 1 AND 512 AND ${t.cardId} IS NULL AND ${t.annotationId} IS NULL AND ${t.text} IS NULL)
      )`,
    ),
    foreignKey({
      name: 'canvas_nodes_parent_id_fk',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
  ],
);

/**
 * 一篇文档脑图的版本。snapshot 是该次写入之后的画布行，以及当时还在的批注。
 * 第一笔之前会另存「开始记录之前」。只保留最近 40 版。
 */
export const canvasRevisions = pgTable(
  'canvas_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    summary: varchar('summary', { length: 200 }).notNull(),
    snapshot: jsonb('snapshot').$type<CanvasSnapshot>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_canvas_revisions_document_created').on(t.documentId, t.createdAt.desc(), t.id.desc()),
    check(
      'canvas_revisions_summary_len_check',
      sql`char_length(${t.summary}) BETWEEN 1 AND 200`,
    ),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type CanvasNodeRow = typeof canvasNodes.$inferSelect;
export type NewCanvasNode = typeof canvasNodes.$inferInsert;
export type CanvasRevisionRow = typeof canvasRevisions.$inferSelect;
export type NewCanvasRevision = typeof canvasRevisions.$inferInsert;
