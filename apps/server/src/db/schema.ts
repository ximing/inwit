import { relations, sql } from 'drizzle-orm';
import {
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
import type {
  AgentExecutionStatus,
  AgentExecutionStep,
  AgentType,
  CardLinkOrigin,
  CardLinkType,
  CardQuestionType,
  CardSource,
  DocumentSource,
  DocumentStatus,
  JobPayload,
  JobStatus,
  JobType,
  LlmCapability,
  LlmProvider,
  MapNodeStatus,
  MemoryContent,
  MemoryLayer,
  MemoryScope,
  ReviewFeedback,
  TopicStatus,
} from '@inwit/dto';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
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
    check(
      'llm_configs_provider_check',
      sql`${t.provider} IN ('openai', 'deepseek', 'claude', 'zhipu', 'dashscope')`,
    ),
  ],
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
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_topics_user').on(t.userId),
    index('idx_topics_user_status').on(t.userId, t.status),
    check('topics_status_check', sql`${t.status} IN ('active', 'archived')`),
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
    check(
      'map_nodes_status_check',
      sql`${t.status} IN ('uncovered', 'learning', 'covered')`,
    ),
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
    title: text('title').notNull(),
    contentMd: text('content_md').notNull(),
    source: varchar('source', { length: 16 }).$type<DocumentSource>().notNull(),
    status: varchar('status', { length: 16 }).$type<DocumentStatus>().notNull().default('pending'),
    answer: text('answer'),
    linkHint: text('link_hint'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_documents_user_created').on(t.userId, t.createdAt),
    index('idx_documents_user_status').on(t.userId, t.status),
    index('idx_documents_topic').on(t.topicId),
    index('idx_documents_map_node').on(t.mapNodeId),
    check('documents_source_check', sql`${t.source} IN ('editor', 'paste', 'chat')`),
    check('documents_status_check', sql`${t.status} IN ('pending', 'digested', 'failed')`),
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
    concept: text('concept').notNull(),
    example: text('example').notNull(),
    confusionPoint: text('confusion_point').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: varchar('source', { length: 16 }).$type<CardSource>().notNull().default('agent'),
    anchorText: text('anchor_text'),
    anchorBlock: text('anchor_block'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_cards_user').on(t.userId),
    index('idx_cards_document').on(t.documentId),
    index('idx_cards_topic').on(t.topicId),
    index('idx_cards_map_node').on(t.mapNodeId),
    index('idx_cards_tags').using('gin', t.tags),
    check('cards_source_check', sql`${t.source} IN ('manual', 'agent', 'chat')`),
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
    check(
      'card_links_type_check',
      sql`${t.type} IN ('same_concept', 'confusable', 'prerequisite', 'related')`,
    ),
    check('card_links_origin_check', sql`${t.origin} IN ('agent', 'user')`),
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
    check('card_questions_type_check', sql`${t.type} IN ('cloze', 'compare', 'judge')`),
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
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('review_states_user_card_uidx').on(t.userId, t.cardId),
    index('idx_review_states_user_due').on(t.userId, t.dueAt),
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
  },
  (t) => [
    index('idx_review_logs_user_reviewed').on(t.userId, t.reviewedAt),
    index('idx_review_logs_card').on(t.cardId),
    check('review_logs_feedback_check', sql`${t.feedback} IN ('forgot', 'fuzzy', 'remembered')`),
  ],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    check('memories_scope_check', sql`${t.scope} IN ('user', 'topic')`),
    check(
      'memories_layer_check',
      sql`${t.layer} IN ('profile', 'mastery', 'association', 'topic_map')`,
    ),
    check(
      'memories_scope_id_check',
      sql`(${t.scope} = 'user' AND ${t.scopeId} IS NULL) OR (${t.scope} = 'topic' AND ${t.scopeId} IS NOT NULL)`,
    ),
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
    index('idx_jobs_user').on(t.userId),
    index('idx_jobs_user_type').on(t.userId, t.type),
    check(
      'jobs_type_check',
      sql`${t.type} IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat')`,
    ),
    check('jobs_status_check', sql`${t.status} IN ('pending', 'running', 'done', 'failed')`),
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
    error: text('error'),
    resultSummary: text('result_summary'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_executions_job').on(t.jobId),
    index('idx_agent_executions_user_started').on(t.userId, t.startedAt),
    index('idx_agent_executions_type_status').on(t.agentType, t.status),
    check(
      'agent_executions_agent_type_check',
      sql`${t.agentType} IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat')`,
    ),
    check(
      'agent_executions_status_check',
      sql`${t.status} IN ('pending', 'running', 'done', 'failed')`,
    ),
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
    index('idx_llm_usage_logs_execution').on(t.executionId),
    index('idx_llm_usage_logs_capability_created').on(t.capability, t.createdAt),
    check(
      'llm_usage_logs_capability_check',
      sql`${t.capability} IN ('chat', 'embed', 'rerank')`,
    ),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  llmConfigs: many(llmConfigs),
  topics: many(topics),
  documents: many(documents),
  cards: many(cards),
  cardLinks: many(cardLinks),
  reviewStates: many(reviewStates),
  reviewLogs: many(reviewLogs),
  memories: many(memories),
  jobs: many(jobs),
  agentExecutions: many(agentExecutions),
  llmUsageLogs: many(llmUsageLogs),
}));

export const llmConfigsRelations = relations(llmConfigs, ({ one }) => ({
  user: one(users, { fields: [llmConfigs.userId], references: [users.id] }),
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

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  user: one(users, { fields: [jobs.userId], references: [users.id] }),
  executions: many(agentExecutions),
}));

export const agentExecutionsRelations = relations(agentExecutions, ({ one, many }) => ({
  user: one(users, { fields: [agentExecutions.userId], references: [users.id] }),
  job: one(jobs, { fields: [agentExecutions.jobId], references: [jobs.id] }),
  usageLogs: many(llmUsageLogs),
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
export type LlmConfigRow = typeof llmConfigs.$inferSelect;
export type NewLlmConfig = typeof llmConfigs.$inferInsert;
export type TopicRow = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type MapNodeRow = typeof mapNodes.$inferSelect;
export type NewMapNode = typeof mapNodes.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
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
export type MemoryRow = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type AgentExecutionRow = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;
export type LlmUsageLogRow = typeof llmUsageLogs.$inferSelect;
export type NewLlmUsageLog = typeof llmUsageLogs.$inferInsert;
