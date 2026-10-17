import { relations, sql, type SQLWrapper } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  AGENT_EXECUTION_STATUSES,
  AGENT_TYPES,
  ANNOTATION_KINDS,
  CANVAS_NODE_KINDS,
  CARD_ACCEPTANCES,
  CARD_LINK_ORIGINS,
  CARD_LINK_TYPES,
  CARD_QUESTION_TYPES,
  CARD_SOURCES,
  CONCEPT_BATCH_SCOPES,
  CONCEPT_BATCH_STATUSES,
  CONCEPT_BASIS,
  CONCEPT_EVIDENCE_AVAILABILITY,
  CONCEPT_EXERCISE_KINDS,
  CONCEPT_ORIGINS,
  CONCEPT_PRACTICE_PROPOSAL_STATUSES,
  CONCEPT_RELATION_KINDS,
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  LLM_CAPABILITIES,
  LLM_PROVIDERS,
  MAP_NODE_STATUSES,
  MEMORY_COLLECTION_STATUSES,
  MEMORY_ENTRY_STATUSES,
  MEMORY_LAYERS,
  MEMORY_SCOPES,
  SYNC_OPS,
  SYNC_SCOPES,
  TOPIC_STATUSES,
} from '@inwit/dto';
import type {
  AgentExecutionStatus,
  AgentExecutionStep,
  AgentExecutionTurn,
  AgentType,
  AnnotationGeometry,
  AnnotationKind,
  CanvasNodeKind,
  CanvasSnapshot,
  CardAcceptance,
  CardLinkOrigin,
  ConversationAction,
  ConversationNodeRef,
  ConversationSelection,
  CardLinkType,
  CardQuestionType,
  CardSource,
  ConceptBasis,
  ConceptBatchCoverage,
  ConceptBatchScope,
  ConceptBatchStatus,
  ConceptCommitResult,
  ConceptContentSnapshot,
  ConceptDraft,
  ConceptEvidenceAvailability,
  ConceptEvidenceLocator,
  ConceptExerciseKind,
  ConceptOrigin,
  ConceptPracticeProposalStatus,
  ConceptRelationKind,
  DocumentSource,
  DocumentStatus,
  JobPayload,
  JobStatus,
  JobType,
  LlmCapability,
  LlmProvider,
  MapNodeStatus,
  MemoryCollectionStatus,
  MemoryContent,
  MemoryEntryStatus,
  MemoryLayer,
  MemoryRevision,
  MemoryScope,
  ReviewFeedback,
  ReviewSettings,
  SyncOp,
  SyncScope,
  TopicStatus,
} from '@inwit/dto';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Values are compile-time constants from @inwit/dto, so raw interpolation is safe. */
const enumCheck = (name: string, column: SQLWrapper, values: readonly string[]) =>
  check(name, sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 64 }),
  /** Object storage key (not a URL). */
  avatarKey: varchar('avatar_key', { length: 255 }),
  reviewSettings: jsonb('review_settings').$type<ReviewSettings>(),
  /** Incremented to invalidate outstanding access and refresh JWTs. */
  sessionVersion: integer('session_version').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const llmConfigs = pgTable(
  'llm_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).$type<LlmProvider>().notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    baseUrl: varchar('base_url', { length: 512 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_llm_configs_user').on(t.userId),
    uniqueIndex('llm_configs_user_default_uidx')
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
    enumCheck('llm_configs_provider_check', t.provider, LLM_PROVIDERS),
  ],
);

export const accessTokens = pgTable(
  'access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    tokenPreview: varchar('token_preview', { length: 32 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_access_tokens_user').on(t.userId),
    uniqueIndex('access_tokens_hash_uidx').on(t.tokenHash),
  ],
);

export const accessTokenLogs = pgTable(
  'access_token_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessTokenId: uuid('access_token_id')
      .notNull()
      .references(() => accessTokens.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 16 }).notNull(),
    path: varchar('path', { length: 512 }).notNull(),
    status: integer('status').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_access_token_logs_user_created').on(t.userId, t.createdAt),
    index('idx_access_token_logs_token_created').on(t.accessTokenId, t.createdAt),
    index('idx_access_token_logs_created').on(t.createdAt),
  ],
);

export const ocrConfigs = pgTable(
  'ocr_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    model: varchar('model', { length: 128 }).notNull().default('qwen-vl-ocr'),
    baseUrl: varchar('base_url', { length: 512 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ocr_configs_user_uidx').on(t.userId)],
);

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
    fileMime: varchar('file_mime', { length: 64 }),
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

/**
 * 概念：一个主题语境下的知识条目。同名异义以 sense 区分并列存在，
 * 名称不设唯一约束（匹配建议由服务层给出）。
 */
export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** NFKC + 去首尾空白 + 连续空白折叠 + 小写；仅用于匹配建议，不替代展示名。 */
    normalizedName: text('normalized_name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sense: text('sense'),
    definition: text('definition'),
    example: text('example'),
    origin: varchar('origin', { length: 16 }).$type<ConceptOrigin>().notNull(),
    version: integer('version').notNull().default(1),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concepts_topic').on(t.topicId),
    index('idx_concepts_user_topic').on(t.userId, t.topicId),
    index('idx_concepts_topic_normalized_name').on(t.topicId, t.normalizedName),
    // 复合外键目标：关系端点必须与本关系同用户同主题。
    unique('concepts_id_user_topic_uidx').on(t.id, t.userId, t.topicId),
    enumCheck('concepts_origin_check', t.origin, CONCEPT_ORIGINS),
    check('concepts_name_len_check', sql`char_length(${t.name}) BETWEEN 1 AND 200`),
    check(
      'concepts_sense_len_check',
      sql`${t.sense} IS NULL OR char_length(${t.sense}) BETWEEN 1 AND 500`,
    ),
    check(
      'concepts_definition_len_check',
      sql`${t.definition} IS NULL OR char_length(${t.definition}) BETWEEN 1 AND 4000`,
    ),
    check(
      'concepts_example_len_check',
      sql`${t.example} IS NULL OR char_length(${t.example}) BETWEEN 1 AND 4000`,
    ),
    check('concepts_aliases_count_check', sql`cardinality(${t.aliases}) <= 10`),
  ],
);

/**
 * 关系：有方向的陈述（from → predicate → to）。合法多节点环允许存在，
 * 仅禁止自环；相同 identityHash 的有效关系唯一（不同语境并列保留）。
 */
export const conceptRelations = pgTable(
  'concept_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    fromConceptId: uuid('from_concept_id').notNull(),
    toConceptId: uuid('to_concept_id').notNull(),
    kind: varchar('kind', { length: 24 }).$type<ConceptRelationKind>().notNull(),
    predicate: text('predicate').notNull(),
    normalizedPredicate: text('normalized_predicate').notNull(),
    context: text('context'),
    normalizedContext: text('normalized_context').notNull().default(''),
    explanation: text('explanation'),
    example: text('example'),
    origin: varchar('origin', { length: 16 }).$type<ConceptOrigin>().notNull(),
    basis: varchar('basis', { length: 16 }).$type<ConceptBasis>().notNull(),
    identityHash: varchar('identity_hash', { length: 64 }).notNull(),
    version: integer('version').notNull().default(1),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_relations_topic').on(t.topicId),
    index('idx_concept_relations_from').on(t.fromConceptId),
    index('idx_concept_relations_to').on(t.toConceptId),
    uniqueIndex('concept_relations_active_identity_uidx')
      .on(t.userId, t.identityHash)
      .where(sql`${t.archivedAt} IS NULL`),
    check('concept_relations_not_self_check', sql`${t.fromConceptId} <> ${t.toConceptId}`),
    enumCheck('concept_relations_kind_check', t.kind, CONCEPT_RELATION_KINDS),
    enumCheck('concept_relations_origin_check', t.origin, CONCEPT_ORIGINS),
    enumCheck('concept_relations_basis_check', t.basis, CONCEPT_BASIS),
    check('concept_relations_predicate_len_check', sql`char_length(${t.predicate}) BETWEEN 1 AND 100`),
    check(
      'concept_relations_context_len_check',
      sql`${t.context} IS NULL OR char_length(${t.context}) BETWEEN 1 AND 500`,
    ),
    check(
      'concept_relations_explanation_len_check',
      sql`${t.explanation} IS NULL OR char_length(${t.explanation}) BETWEEN 1 AND 4000`,
    ),
    check(
      'concept_relations_example_len_check',
      sql`${t.example} IS NULL OR char_length(${t.example}) BETWEEN 1 AND 4000`,
    ),
    foreignKey({
      name: 'concept_relations_from_concept_fk',
      columns: [t.fromConceptId, t.userId, t.topicId],
      foreignColumns: [concepts.id, concepts.userId, concepts.topicId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'concept_relations_to_concept_fk',
      columns: [t.toConceptId, t.userId, t.topicId],
      foreignColumns: [concepts.id, concepts.userId, concepts.topicId],
    }).onDelete('cascade'),
  ],
);

/** 证据：概念/关系的原文出处。conceptId 与 relationId 恰一非空；文档硬删除只断开来源。 */
export const conceptEvidence = pgTable(
  'concept_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    documentTitleSnapshot: text('document_title_snapshot').notNull().default(''),
    /** 保存证据时的正文 hash（不含标题）；用于派生 stale。 */
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    quote: text('quote').notNull(),
    locator: jsonb('locator').$type<ConceptEvidenceLocator>().notNull(),
    basis: varchar('basis', { length: 16 }).$type<ConceptBasis>().notNull(),
    availability: varchar('availability', { length: 16 })
      .$type<ConceptEvidenceAvailability>()
      .notNull()
      .default('active'),
    /** 目标 + 文档 + hash + 规范化定位 + 引文 的去重哈希。 */
    evidenceHash: varchar('evidence_hash', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_evidence_concept').on(t.conceptId),
    index('idx_concept_evidence_relation').on(t.relationId),
    index('idx_concept_evidence_document').on(t.documentId),
    index('idx_concept_evidence_user').on(t.userId),
    check(
      'concept_evidence_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
    enumCheck('concept_evidence_basis_check', t.basis, CONCEPT_BASIS),
    enumCheck('concept_evidence_availability_check', t.availability, CONCEPT_EVIDENCE_AVAILABILITY),
    check('concept_evidence_quote_len_check', sql`char_length(${t.quote}) BETWEEN 1 AND 2000`),
  ],
);

/** 本文说明：与共享定义分开的文章范围解释，独立版本；目标恰一非空。 */
export const conceptNotes = pgTable(
  'concept_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    version: integer('version').notNull().default(1),
    basis: varchar('basis', { length: 16 }).$type<ConceptBasis>().notNull(),
    createdBy: varchar('created_by', { length: 16 }).$type<ConceptOrigin>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_notes_concept').on(t.conceptId),
    index('idx_concept_notes_relation').on(t.relationId),
    index('idx_concept_notes_document').on(t.documentId),
    index('idx_concept_notes_user_topic').on(t.userId, t.topicId),
    check(
      'concept_notes_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
    enumCheck('concept_notes_basis_check', t.basis, CONCEPT_BASIS),
    enumCheck('concept_notes_created_by_check', t.createdBy, CONCEPT_ORIGINS),
    check('concept_notes_text_len_check', sql`char_length(${t.text}) BETWEEN 1 AND 4000`),
  ],
);

/** 本文知识成员关系：文章 ↔ 概念/关系 的显式引用，独立于证据；同文章同目标有效引用唯一。 */
export const documentKnowledgeRefs = pgTable(
  'document_knowledge_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    origin: varchar('origin', { length: 16 }).$type<ConceptOrigin>().notNull(),
    removedAt: timestamptz('removed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_document_knowledge_refs_document').on(t.documentId),
    index('idx_document_knowledge_refs_topic').on(t.topicId),
    index('idx_document_knowledge_refs_concept').on(t.conceptId),
    index('idx_document_knowledge_refs_relation').on(t.relationId),
    uniqueIndex('document_knowledge_refs_concept_uidx')
      .on(t.documentId, t.conceptId)
      .where(sql`${t.conceptId} IS NOT NULL AND ${t.removedAt} IS NULL`),
    uniqueIndex('document_knowledge_refs_relation_uidx')
      .on(t.documentId, t.relationId)
      .where(sql`${t.relationId} IS NOT NULL AND ${t.removedAt} IS NULL`),
    check(
      'document_knowledge_refs_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
    enumCheck('document_knowledge_refs_origin_check', t.origin, CONCEPT_ORIGINS),
  ],
);

/** 卡片 ↔ 知识目标的多对多导航关联；不承担复习计分。 */
export const cardKnowledgeLinks = pgTable(
  'card_knowledge_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_card_knowledge_links_card').on(t.cardId),
    index('idx_card_knowledge_links_concept').on(t.conceptId),
    index('idx_card_knowledge_links_relation').on(t.relationId),
    index('idx_card_knowledge_links_user').on(t.userId),
    uniqueIndex('card_knowledge_links_card_concept_uidx')
      .on(t.cardId, t.conceptId)
      .where(sql`${t.conceptId} IS NOT NULL`),
    uniqueIndex('card_knowledge_links_card_relation_uidx')
      .on(t.cardId, t.relationId)
      .where(sql`${t.relationId} IS NOT NULL`),
    check(
      'card_knowledge_links_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
  ],
);

/** 候选批次：一次生成任务产出的可编辑候选网络；确认事务见 concept-commit。 */
export const conceptBatches = pgTable(
  'concept_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    /** 文档硬删除时置空；提交与 stale 判定将其视为来源不可用。 */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** 生成时锁定的正文 hash（不含标题）。 */
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    scope: varchar('scope', { length: 16 }).$type<ConceptBatchScope>().notNull().default('document'),
    selectionSnapshot: jsonb('selection_snapshot').$type<{
      fromBlockIndex: number;
      toBlockIndex: number;
    } | null>(),
    /** 所处理文本及块/页定位（生成时快照）。 */
    contentSnapshot: jsonb('content_snapshot').$type<ConceptContentSnapshot>(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).$type<ConceptBatchStatus>().notNull().default('queued'),
    draftRevision: integer('draft_revision').notNull().default(1),
    draft: jsonb('draft').$type<ConceptDraft>(),
    coverage: jsonb('coverage').$type<ConceptBatchCoverage>(),
    errorCode: varchar('error_code', { length: 64 }),
    /** 结果说明：零结果原因或计数摘要。 */
    resultNote: text('result_note'),
    commitRequestHash: varchar('commit_request_hash', { length: 64 }),
    commitResult: jsonb('commit_result').$type<ConceptCommitResult>(),
    committedAt: timestamptz('committed_at'),
    retryOfBatchId: uuid('retry_of_batch_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_batches_user_created').on(t.userId, t.createdAt),
    index('idx_concept_batches_document').on(t.documentId),
    index('idx_concept_batches_topic').on(t.topicId),
    index('idx_concept_batches_status').on(t.status),
    enumCheck('concept_batches_status_check', t.status, CONCEPT_BATCH_STATUSES),
    enumCheck('concept_batches_scope_check', t.scope, CONCEPT_BATCH_SCOPES),
    foreignKey({
      name: 'concept_batches_retry_of_fk',
      columns: [t.retryOfBatchId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
  ],
);

/** 幂等记录：同 user+operation+requestId 唯一；与业务变更同事务写入。 */
export const conceptOperationRequests = pgTable(
  'concept_operation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: varchar('operation', { length: 40 }).notNull(),
    requestId: varchar('request_id', { length: 80 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseJson: jsonb('response_json').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('concept_operation_requests_uidx').on(t.userId, t.operation, t.requestId),
    index('idx_concept_operation_requests_user').on(t.userId, t.createdAt),
  ],
);

/** 智能出题候选（M3/T6 接通 processor；题目候选不写 cards）。 */
export const conceptPracticeProposals = pgTable(
  'concept_practice_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    targetVersion: integer('target_version').notNull(),
    exerciseKind: varchar('exercise_kind', { length: 16 }).$type<ConceptExerciseKind>().notNull(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 })
      .$type<ConceptPracticeProposalStatus>()
      .notNull()
      .default('queued'),
    question: text('question'),
    answer: text('answer'),
    errorCode: varchar('error_code', { length: 64 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_practice_proposals_user').on(t.userId, t.createdAt),
    index('idx_concept_practice_proposals_concept').on(t.conceptId),
    index('idx_concept_practice_proposals_relation').on(t.relationId),
    check(
      'concept_practice_proposals_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
    enumCheck('concept_practice_proposals_kind_check', t.exerciseKind, CONCEPT_EXERCISE_KINDS),
    enumCheck('concept_practice_proposals_status_check', t.status, CONCEPT_PRACTICE_PROPOSAL_STATUSES),
  ],
);

/**
 * 主要练习绑定（M3/T6 开放写入口；M1 仅结构）。目标恰一非空；
 * 仅 endedAt 为空的活动绑定参与 cardId 唯一与同目标同题型唯一约束。
 * questionId 引用当前实际首题，不建外键：题目删除时保留绑定并置 needsRefresh。
 */
export const conceptPracticeBindings = pgTable(
  'concept_practice_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelations.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id').notNull(),
    exerciseKind: varchar('exercise_kind', { length: 16 }).$type<ConceptExerciseKind>().notNull(),
    targetVersion: integer('target_version').notNull(),
    needsRefresh: boolean('needs_refresh').notNull().default(false),
    resumeRequired: boolean('resume_required').notNull().default(false),
    epochId: uuid('epoch_id').notNull().defaultRandom(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    endedAt: timestamptz('ended_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_concept_practice_bindings_card').on(t.cardId),
    index('idx_concept_practice_bindings_concept').on(t.conceptId),
    index('idx_concept_practice_bindings_relation').on(t.relationId),
    index('idx_concept_practice_bindings_user').on(t.userId),
    uniqueIndex('concept_practice_bindings_active_card_uidx')
      .on(t.cardId)
      .where(sql`${t.endedAt} IS NULL`),
    uniqueIndex('concept_practice_bindings_active_concept_kind_uidx')
      .on(t.conceptId, t.exerciseKind)
      .where(sql`${t.conceptId} IS NOT NULL AND ${t.endedAt} IS NULL`),
    uniqueIndex('concept_practice_bindings_active_relation_kind_uidx')
      .on(t.relationId, t.exerciseKind)
      .where(sql`${t.relationId} IS NOT NULL AND ${t.endedAt} IS NULL`),
    check(
      'concept_practice_bindings_target_check',
      sql`((${t.conceptId} IS NOT NULL)::int + (${t.relationId} IS NOT NULL)::int) = 1`,
    ),
    enumCheck('concept_practice_bindings_kind_check', t.exerciseKind, CONCEPT_EXERCISE_KINDS),
  ],
);

export const memories = pgTable(
  'memories',
  {    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 16 }).$type<MemoryScope>().notNull(),
    scopeId: uuid('scope_id'),
    layer: varchar('layer', { length: 16 }).$type<MemoryLayer>().notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    content: jsonb('content').$type<MemoryContent>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_memories_user_layer').on(t.userId, t.layer),
    index('idx_memories_user_scope').on(t.userId, t.scope, t.scopeId),
    uniqueIndex('memories_user_scope_layer_key_uidx')
      .on(t.userId, t.scope, t.layer, t.key)
      .where(sql`${t.scopeId} IS NULL`),
    uniqueIndex('memories_user_scope_id_layer_key_uidx')
      .on(t.userId, t.scope, t.scopeId, t.layer, t.key)
      .where(sql`${t.scopeId} IS NOT NULL`),
    enumCheck('memories_scope_check', t.scope, MEMORY_SCOPES),
    enumCheck('memories_layer_check', t.layer, MEMORY_LAYERS),
    check(
      'memories_scope_id_check',
      sql`(${t.scope} = 'user' AND ${t.scopeId} IS NULL) OR (${t.scope} = 'topic' AND ${t.scopeId} IS NOT NULL)`,
    ),
  ],
);

export const memoryCollections = pgTable(
  'memory_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 40 }).notNull(),
    description: varchar('description', { length: 280 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<MemoryCollectionStatus>()
      .notNull()
      .default('active'),
    indexDirty: boolean('index_dirty').notNull().default(true),
    retiredAt: timestamptz('retired_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_memory_collections_user_status').on(t.userId, t.status),
    enumCheck('memory_collections_status_check', t.status, MEMORY_COLLECTION_STATUSES),
  ],
);

export const memoryEntries = pgTable(
  'memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => memoryCollections.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 500 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<MemoryEntryStatus>()
      .notNull()
      .default('active'),
    indexDirty: boolean('index_dirty').notNull().default(true),
    retiredAt: timestamptz('retired_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_memory_entries_collection_status').on(t.collectionId, t.status),
    index('idx_memory_entries_user_status').on(t.userId, t.status),
    index('idx_memory_entries_index_dirty')
      .on(t.updatedAt)
      .where(sql`${t.indexDirty} = true`),
    enumCheck('memory_entries_status_check', t.status, MEMORY_ENTRY_STATUSES),
  ],
);

export const memoryRevisions = pgTable(
  'memory_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    executionId: uuid('execution_id').references(() => agentExecutions.id, { onDelete: 'set null' }),
    batchKey: varchar('batch_key', { length: 64 }).notNull(),
    summary: varchar('summary', { length: 300 }).notNull(),
    diff: jsonb('diff').$type<MemoryRevision['diff']>().notNull(),
    feedbackIds: uuid('feedback_ids').array().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('memory_revisions_user_batch_key_uidx').on(t.userId, t.batchKey),
    index('idx_memory_revisions_user_created').on(t.userId, t.createdAt.desc()),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<JobType>().notNull(),
    status: varchar('status', { length: 16 }).$type<JobStatus>().notNull().default('pending'),
    payload: jsonb('payload').$type<JobPayload>().notNull(),
    runAt: timestamptz('run_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_jobs_status_run_at').on(t.status, t.runAt),
    index('idx_jobs_user_created').on(t.userId, t.createdAt),
    index('idx_jobs_status_created').on(t.status, t.createdAt),
    index('idx_jobs_user_type').on(t.userId, t.type),
    uniqueIndex('jobs_one_active_memory_organize_uidx')
      .on(t.userId)
      .where(sql`${t.type} = 'memory_organize' AND ${t.status} IN ('pending', 'running')`),
    enumCheck('jobs_type_check', t.type, JOB_TYPES),
    enumCheck('jobs_status_check', t.status, JOB_STATUSES),
  ],
);

export const ocrPages = pgTable(
  'ocr_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull(),
    pageText: text('page_text').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ocr_pages_job_page_uidx').on(t.jobId, t.pageIndex),
    index('idx_ocr_pages_document').on(t.documentId),
  ],
);

export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentType: varchar('agent_type', { length: 32 }).$type<AgentType>().notNull(),
    status: varchar('status', { length: 16 })
      .$type<AgentExecutionStatus>()
      .notNull()
      .default('running'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    steps: jsonb('steps')
      .$type<AgentExecutionStep[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    turns: jsonb('turns')
      .$type<AgentExecutionTurn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    error: text('error'),
    resultSummary: text('result_summary'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_executions_job').on(t.jobId),
    index('idx_agent_executions_user_started').on(t.userId, t.startedAt),
    index('idx_agent_executions_status_started').on(t.status, t.startedAt),
    index('idx_agent_executions_type_status').on(t.agentType, t.status),
    enumCheck('agent_executions_agent_type_check', t.agentType, AGENT_TYPES),
    enumCheck('agent_executions_status_check', t.status, AGENT_EXECUTION_STATUSES),
  ],
);

export const agentConversations = pgTable(
  'agent_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 80 }).notNull().default(''),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_agent_conversations_user_updated').on(t.userId, t.updatedAt.desc())],
);

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull().default(''),
    /** Live and final model reasoning for an assistant message. Empty for user rows. */
    thinking: text('thinking').notNull().default(''),
    /** What the assistant is doing while the reply is still pending. */
    activity: varchar('activity', { length: 40 }),
    documentIds: jsonb('document_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Mind-map nodes the user attached on this turn. Empty for assistant rows. */
    nodeRefs: jsonb('node_refs')
      .$type<ConversationNodeRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Highlight attached to a user turn. Null on assistant rows and older messages. */
    selection: jsonb('selection').$type<ConversationSelection | null>(),
    actions: jsonb('actions').$type<ConversationAction[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar('status', { length: 16 })
      .$type<'pending' | 'done' | 'failed'>()
      .notNull()
      .default('done'),
    failReason: text('fail_reason'),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_messages_conversation_created').on(t.conversationId, t.createdAt),
    enumCheck('agent_messages_role_check', t.role, ['user', 'assistant']),
    enumCheck('agent_messages_status_check', t.status, ['pending', 'done', 'failed']),
  ],
);

export const llmUsageLogs = pgTable(
  'llm_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').references(() => agentExecutions.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 120 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    capability: varchar('capability', { length: 16 }).$type<LlmCapability>().notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costEstimate: numeric('cost_estimate', { precision: 14, scale: 8, mode: 'number' })
      .notNull()
      .default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_llm_usage_logs_user_created').on(t.userId, t.createdAt),
    index('idx_llm_usage_logs_created').on(t.createdAt),
    index('idx_llm_usage_logs_execution').on(t.executionId),
    index('idx_llm_usage_logs_capability_created').on(t.capability, t.createdAt),
    enumCheck('llm_usage_logs_capability_check', t.capability, LLM_CAPABILITIES),
  ],
);

export const syncChanges = pgTable(
  'sync_changes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 16 }).$type<SyncScope>().notNull(),
    resourceId: uuid('resource_id'),
    op: varchar('op', { length: 8 }).$type<SyncOp>().notNull(),
    /** Changed row's updated_at, or statement time when that column does not exist. */
    at: timestamptz('at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_sync_changes_user_id').on(t.userId, t.id),
    enumCheck('sync_changes_scope_check', t.scope, SYNC_SCOPES),
    enumCheck('sync_changes_op_check', t.op, SYNC_OPS),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  llmConfigs: many(llmConfigs),
  ocrConfigs: many(ocrConfigs),
  accessTokens: many(accessTokens),
  accessTokenLogs: many(accessTokenLogs),
  topics: many(topics),
  documents: many(documents),
  annotations: many(annotations),
  cards: many(cards),
  cardLinks: many(cardLinks),
  reviewStates: many(reviewStates),
  reviewLogs: many(reviewLogs),
  memories: many(memories),
  cardFeedback: many(cardFeedback),
  memoryCollections: many(memoryCollections),
  memoryEntries: many(memoryEntries),
  memoryRevisions: many(memoryRevisions),
  jobs: many(jobs),
  agentExecutions: many(agentExecutions),
  llmUsageLogs: many(llmUsageLogs),
}));

export const accessTokensRelations = relations(accessTokens, ({ one, many }) => ({
  user: one(users, { fields: [accessTokens.userId], references: [users.id] }),
  logs: many(accessTokenLogs),
}));

export const accessTokenLogsRelations = relations(accessTokenLogs, ({ one }) => ({
  user: one(users, { fields: [accessTokenLogs.userId], references: [users.id] }),
  accessToken: one(accessTokens, {
    fields: [accessTokenLogs.accessTokenId],
    references: [accessTokens.id],
  }),
}));

export const llmConfigsRelations = relations(llmConfigs, ({ one }) => ({
  user: one(users, { fields: [llmConfigs.userId], references: [users.id] }),
}));

export const ocrConfigsRelations = relations(ocrConfigs, ({ one }) => ({
  user: one(users, { fields: [ocrConfigs.userId], references: [users.id] }),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  user: one(users, { fields: [topics.userId], references: [users.id] }),
  documents: many(documents),
  cards: many(cards),
  mapNodes: many(mapNodes),
}));

export const mapNodesRelations = relations(mapNodes, ({ one, many }) => ({
  topic: one(topics, { fields: [mapNodes.topicId], references: [topics.id] }),
  parent: one(mapNodes, {
    fields: [mapNodes.parentId],
    references: [mapNodes.id],
    relationName: 'mapNodeParent',
  }),
  children: many(mapNodes, { relationName: 'mapNodeParent' }),
  documents: many(documents),
  cards: many(cards),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  user: one(users, { fields: [documents.userId], references: [users.id] }),
  topic: one(topics, { fields: [documents.topicId], references: [topics.id] }),
  mapNode: one(mapNodes, { fields: [documents.mapNodeId], references: [mapNodes.id] }),
  cards: many(cards),
  annotations: many(annotations),
  cardFeedback: many(cardFeedback),
  ocrPages: many(ocrPages),
}));

export const annotationsRelations = relations(annotations, ({ one }) => ({
  user: one(users, { fields: [annotations.userId], references: [users.id] }),
  document: one(documents, { fields: [annotations.documentId], references: [documents.id] }),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  document: one(documents, { fields: [cards.documentId], references: [documents.id] }),
  topic: one(topics, { fields: [cards.topicId], references: [topics.id] }),
  mapNode: one(mapNodes, { fields: [cards.mapNodeId], references: [mapNodes.id] }),
  questions: many(cardQuestions),
  reviewStates: many(reviewStates),
  reviewLogs: many(reviewLogs),
  outgoingLinks: many(cardLinks, { relationName: 'fromCard' }),
  incomingLinks: many(cardLinks, { relationName: 'toCard' }),
  feedback: many(cardFeedback),
}));

export const cardLinksRelations = relations(cardLinks, ({ one }) => ({
  user: one(users, { fields: [cardLinks.userId], references: [users.id] }),
  fromCard: one(cards, {
    fields: [cardLinks.fromCardId],
    references: [cards.id],
    relationName: 'fromCard',
  }),
  toCard: one(cards, {
    fields: [cardLinks.toCardId],
    references: [cards.id],
    relationName: 'toCard',
  }),
}));

export const cardQuestionsRelations = relations(cardQuestions, ({ one }) => ({
  card: one(cards, { fields: [cardQuestions.cardId], references: [cards.id] }),
}));

export const reviewStatesRelations = relations(reviewStates, ({ one }) => ({
  user: one(users, { fields: [reviewStates.userId], references: [users.id] }),
  card: one(cards, { fields: [reviewStates.cardId], references: [cards.id] }),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  user: one(users, { fields: [reviewLogs.userId], references: [users.id] }),
  card: one(cards, { fields: [reviewLogs.cardId], references: [cards.id] }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  user: one(users, { fields: [memories.userId], references: [users.id] }),
}));

export const cardFeedbackRelations = relations(cardFeedback, ({ one }) => ({
  user: one(users, { fields: [cardFeedback.userId], references: [users.id] }),
  card: one(cards, { fields: [cardFeedback.cardId], references: [cards.id] }),
  document: one(documents, { fields: [cardFeedback.documentId], references: [documents.id] }),
  organizeJob: one(jobs, { fields: [cardFeedback.organizeJobId], references: [jobs.id] }),
}));

export const memoryCollectionsRelations = relations(memoryCollections, ({ one, many }) => ({
  user: one(users, { fields: [memoryCollections.userId], references: [users.id] }),
  entries: many(memoryEntries),
}));

export const memoryEntriesRelations = relations(memoryEntries, ({ one }) => ({
  user: one(users, { fields: [memoryEntries.userId], references: [users.id] }),
  collection: one(memoryCollections, {
    fields: [memoryEntries.collectionId],
    references: [memoryCollections.id],
  }),
}));

export const memoryRevisionsRelations = relations(memoryRevisions, ({ one }) => ({
  user: one(users, { fields: [memoryRevisions.userId], references: [users.id] }),
  job: one(jobs, { fields: [memoryRevisions.jobId], references: [jobs.id] }),
  execution: one(agentExecutions, {
    fields: [memoryRevisions.executionId],
    references: [agentExecutions.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  user: one(users, { fields: [jobs.userId], references: [users.id] }),
  executions: many(agentExecutions),
  ocrPages: many(ocrPages),
  cardFeedback: many(cardFeedback),
  memoryRevisions: many(memoryRevisions),
}));

export const ocrPagesRelations = relations(ocrPages, ({ one }) => ({
  job: one(jobs, { fields: [ocrPages.jobId], references: [jobs.id] }),
  document: one(documents, { fields: [ocrPages.documentId], references: [documents.id] }),
}));

export const agentExecutionsRelations = relations(agentExecutions, ({ one, many }) => ({
  user: one(users, { fields: [agentExecutions.userId], references: [users.id] }),
  job: one(jobs, { fields: [agentExecutions.jobId], references: [jobs.id] }),
  usageLogs: many(llmUsageLogs),
  memoryRevisions: many(memoryRevisions),
}));

export const llmUsageLogsRelations = relations(llmUsageLogs, ({ one }) => ({
  user: one(users, { fields: [llmUsageLogs.userId], references: [users.id] }),
  execution: one(agentExecutions, {
    fields: [llmUsageLogs.executionId],
    references: [agentExecutions.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AccessTokenRow = typeof accessTokens.$inferSelect;
export type NewAccessToken = typeof accessTokens.$inferInsert;
export type AccessTokenLogRow = typeof accessTokenLogs.$inferSelect;
export type LlmConfigRow = typeof llmConfigs.$inferSelect;
export type NewLlmConfig = typeof llmConfigs.$inferInsert;
export type OcrConfigRow = typeof ocrConfigs.$inferSelect;
export type NewOcrConfig = typeof ocrConfigs.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type MapNodeRow = typeof mapNodes.$inferSelect;
export type NewMapNode = typeof mapNodes.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type CanvasNodeRow = typeof canvasNodes.$inferSelect;
export type NewCanvasNode = typeof canvasNodes.$inferInsert;
export type CanvasRevisionRow = typeof canvasRevisions.$inferSelect;
export type NewCanvasRevision = typeof canvasRevisions.$inferInsert;
export type CardLinkRow = typeof cardLinks.$inferSelect;
export type NewCardLink = typeof cardLinks.$inferInsert;
export type CardQuestionRow = typeof cardQuestions.$inferSelect;
export type NewCardQuestion = typeof cardQuestions.$inferInsert;
export type ReviewStateRow = typeof reviewStates.$inferSelect;
export type NewReviewState = typeof reviewStates.$inferInsert;
export type ReviewLogRow = typeof reviewLogs.$inferSelect;
export type NewReviewLog = typeof reviewLogs.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type CardFeedbackRow = typeof cardFeedback.$inferSelect;
export type NewCardFeedback = typeof cardFeedback.$inferInsert;
export type MemoryCollectionRow = typeof memoryCollections.$inferSelect;
export type NewMemoryCollection = typeof memoryCollections.$inferInsert;
export type MemoryEntryRow = typeof memoryEntries.$inferSelect;
export type NewMemoryEntry = typeof memoryEntries.$inferInsert;
export type MemoryRevisionRow = typeof memoryRevisions.$inferSelect;
export type NewMemoryRevision = typeof memoryRevisions.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type OcrPageRow = typeof ocrPages.$inferSelect;
export type NewOcrPage = typeof ocrPages.$inferInsert;
export type AgentExecutionRow = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;
export type AgentConversationRow = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
export type LlmUsageLogRow = typeof llmUsageLogs.$inferSelect;
export type NewLlmUsageLog = typeof llmUsageLogs.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
export type ConceptRelationRow = typeof conceptRelations.$inferSelect;
export type NewConceptRelation = typeof conceptRelations.$inferInsert;
export type ConceptEvidenceRow = typeof conceptEvidence.$inferSelect;
export type NewConceptEvidence = typeof conceptEvidence.$inferInsert;
export type ConceptNoteRow = typeof conceptNotes.$inferSelect;
export type NewConceptNote = typeof conceptNotes.$inferInsert;
export type DocumentKnowledgeRefRow = typeof documentKnowledgeRefs.$inferSelect;
export type NewDocumentKnowledgeRef = typeof documentKnowledgeRefs.$inferInsert;
export type CardKnowledgeLinkRow = typeof cardKnowledgeLinks.$inferSelect;
export type NewCardKnowledgeLink = typeof cardKnowledgeLinks.$inferInsert;
export type ConceptBatchRow = typeof conceptBatches.$inferSelect;
export type NewConceptBatch = typeof conceptBatches.$inferInsert;
export type ConceptOperationRequestRow = typeof conceptOperationRequests.$inferSelect;
export type ConceptPracticeProposalRow = typeof conceptPracticeProposals.$inferSelect;
export type ConceptPracticeBindingRow = typeof conceptPracticeBindings.$inferSelect;
export type NewConceptPracticeBinding = typeof conceptPracticeBindings.$inferInsert;
