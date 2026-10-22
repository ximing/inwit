import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  CONCEPT_BATCH_SCOPES,
  CONCEPT_BATCH_STATUSES,
  CONCEPT_BASIS,
  CONCEPT_EVIDENCE_AVAILABILITY,
  CONCEPT_EXERCISE_KINDS,
  CONCEPT_ORIGINS,
  CONCEPT_PRACTICE_PROPOSAL_STATUSES,
  CONCEPT_RELATION_KINDS,
} from '@inwit/dto';
import type {
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
} from '@inwit/dto';
import { users } from './schema-auth.js';
import { topics } from './schema-topic.js';
import { documents } from './schema-document.js';
import { cards } from './schema-card.js';
import { jobs } from './schema-job.js';
import { enumCheck, timestamptz } from './schema-shared.js';

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
