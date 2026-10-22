import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  CARD_ACCEPTANCES,
  CARD_LINK_ORIGINS,
  CARD_LINK_TYPES,
  CARD_QUESTION_TYPES,
  CARD_SOURCES,
} from '@inwit/dto';
import type {
  CardAcceptance,
  CardLinkOrigin,
  CardLinkType,
  CardQuestionType,
  CardSource,
  ReviewFeedback,
} from '@inwit/dto';
import { users } from './schema-auth.js';
import { mapNodes, topics } from './schema-topic.js';
import { documents } from './schema-document.js';
import { jobs } from './schema-job.js';
import { enumCheck, timestamptz } from './schema-shared.js';

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    mapNodeId: uuid('map_node_id').references(() => mapNodes.id, { onDelete: 'set null' }),
    /** 脑图父卡。空表示这张卡自己是一棵树的根。 */
    outlineParentId: uuid('outline_parent_id'),
    /** 同一个父卡下的顺序，小的在上。 */
    outlinePosition: integer('outline_position').notNull().default(0),
    concept: text('concept').notNull(),
    example: text('example').notNull(),
    confusionPoint: text('confusion_point').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: varchar('source', { length: 16 }).$type<CardSource>().notNull().default('agent'),
    anchorText: text('anchor_text'),
    anchorBlockIndex: integer('anchor_block_index'),
    /** Object storage key (not a URL). */
    imageKey: text('image_key'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Soft delete (回收站); non-null rows are hidden from lists and retrieval. */
    deletedAt: timestamptz('deleted_at'),
    acceptance: varchar('acceptance', { length: 16 })
      .$type<CardAcceptance>()
      .notNull()
      .default('accepted'),
    rejectReason: text('reject_reason'),
    /**
     * 复习内容版本。null = 从未受概念练习协议管理的旧卡；首次绑定置 1，
     * 之后题目/绑定/归档/refresh 变更递增，解绑后不退回 null。（T6 启用）
     */
    reviewRevision: integer('review_revision'),
  },
  (t) => [
    index('idx_cards_user').on(t.userId),
    index('idx_cards_document').on(t.documentId),
    index('idx_cards_topic').on(t.topicId),
    index('idx_cards_map_node').on(t.mapNodeId),
    index('idx_cards_document_outline').on(t.documentId, t.outlineParentId, t.outlinePosition),
    index('idx_cards_tags').using('gin', t.tags),
    index('idx_cards_user_acceptance')
      .on(t.userId, t.acceptance)
      .where(sql`${t.deletedAt} IS NULL`),
    enumCheck('cards_source_check', t.source, CARD_SOURCES),
    enumCheck('cards_acceptance_check', t.acceptance, CARD_ACCEPTANCES),
    check('cards_reject_reason_len_check', sql`char_length(${t.rejectReason}) <= 500`),
    check(
      'cards_outline_not_self_check',
      sql`${t.outlineParentId} IS NULL OR ${t.outlineParentId} <> ${t.id}`,
    ),
    foreignKey({
      name: 'cards_outline_parent_id_cards_id_fk',
      columns: [t.outlineParentId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
  ],
);

const CARD_FEEDBACK_VERDICTS = ['accepted', 'rejected'] as const;

type CardFeedbackVerdict = (typeof CARD_FEEDBACK_VERDICTS)[number];

type CardFeedbackSnapshot = {
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
  questions: { type: CardQuestionType; question: string }[];
};

export const cardFeedback = pgTable(
  'card_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    verdict: varchar('verdict', { length: 16 }).$type<CardFeedbackVerdict>().notNull(),
    reason: text('reason'),
    snapshot: jsonb('snapshot').$type<CardFeedbackSnapshot>().notNull(),
    consumedAt: timestamptz('consumed_at'),
    organizeJobId: uuid('organize_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_card_feedback_unconsumed')
      .on(t.userId, t.createdAt)
      .where(sql`${t.consumedAt} IS NULL`),
    index('idx_card_feedback_user_created').on(t.userId, t.createdAt),
    enumCheck('card_feedback_verdict_check', t.verdict, CARD_FEEDBACK_VERDICTS),
    check('card_feedback_reason_len_check', sql`char_length(${t.reason}) <= 500`),
  ],
);

export const cardLinks = pgTable(
  'card_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromCardId: uuid('from_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    toCardId: uuid('to_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<CardLinkType>().notNull(),
    origin: varchar('origin', { length: 16 }).$type<CardLinkOrigin>().notNull(),
    reason: text('reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('card_links_from_to_type_uidx').on(t.fromCardId, t.toCardId, t.type),
    index('idx_card_links_user').on(t.userId),
    index('idx_card_links_from').on(t.fromCardId),
    index('idx_card_links_to').on(t.toCardId),
    enumCheck('card_links_type_check', t.type, CARD_LINK_TYPES),
    enumCheck('card_links_origin_check', t.origin, CARD_LINK_ORIGINS),
    check('card_links_not_self_check', sql`${t.fromCardId} <> ${t.toCardId}`),
  ],
);

export const cardQuestions = pgTable(
  'card_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).$type<CardQuestionType>().notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_card_questions_card').on(t.cardId),
    enumCheck('card_questions_type_check', t.type, CARD_QUESTION_TYPES),
  ],
);

export const reviewStates = pgTable(
  'review_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    ease: real('ease').notNull().default(2.5),
    intervalDays: integer('interval_days').notNull().default(0),
    dueAt: timestamptz('due_at')
      .notNull()
      .default(sql`now() + interval '1 day'`),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastFeedback: varchar('last_feedback', { length: 16 }).$type<ReviewFeedback>(),
    /** 已熟悉：non-null = left out of the review queue until resumed. */
    suspendedAt: timestamptz('suspended_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('review_states_user_card_uidx').on(t.userId, t.cardId),
    index('idx_review_states_user_due').on(t.userId, t.dueAt),
    index('idx_review_states_user_due_active')
      .on(t.userId, t.dueAt)
      .where(sql`${t.suspendedAt} IS NULL`),
    check(
      'review_states_last_feedback_check',
      sql`${t.lastFeedback} IS NULL OR ${t.lastFeedback} IN ('forgot', 'fuzzy', 'remembered')`,
    ),
  ],
);

export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    feedback: varchar('feedback', { length: 16 }).$type<ReviewFeedback>().notNull(),
    reviewedAt: timestamptz('reviewed_at').notNull().defaultNow(),
    /** 概念练习反馈归属（T6 写入；旧日志全部为 null，不回填）。 */
    bindingId: uuid('binding_id'),
    epochId: uuid('epoch_id'),
    targetVersion: integer('target_version'),
    questionId: uuid('question_id'),
    reviewRevision: integer('review_revision'),
  },
  (t) => [
    index('idx_review_logs_user_reviewed').on(t.userId, t.reviewedAt),
    index('idx_review_logs_card').on(t.cardId),
    check('review_logs_feedback_check', sql`${t.feedback} IN ('forgot', 'fuzzy', 'remembered')`),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type CardLinkRow = typeof cardLinks.$inferSelect;
export type NewCardLink = typeof cardLinks.$inferInsert;
export type CardQuestionRow = typeof cardQuestions.$inferSelect;
export type NewCardQuestion = typeof cardQuestions.$inferInsert;
export type ReviewStateRow = typeof reviewStates.$inferSelect;
export type NewReviewState = typeof reviewStates.$inferInsert;
export type ReviewLogRow = typeof reviewLogs.$inferSelect;
export type NewReviewLog = typeof reviewLogs.$inferInsert;
export type CardFeedbackRow = typeof cardFeedback.$inferSelect;
export type NewCardFeedback = typeof cardFeedback.$inferInsert;
