import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  AGENT_EXECUTION_STATUSES,
  AGENT_TYPES,
  JOB_STATUSES,
  JOB_TYPES,
  LLM_CAPABILITIES,
  SYNC_OPS,
  SYNC_SCOPES,
} from '@inwit/dto';
import type {
  AgentExecutionStatus,
  AgentExecutionStep,
  AgentExecutionTurn,
  AgentType,
  ConversationAction,
  ConversationNodeRef,
  ConversationSelection,
  JobPayload,
  JobStatus,
  JobType,
  LlmCapability,
  SyncOp,
  SyncScope,
} from '@inwit/dto';
import { users } from './schema-auth.js';
import { documents } from './schema-document.js';
import { enumCheck, timestamptz } from './schema-shared.js';

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
