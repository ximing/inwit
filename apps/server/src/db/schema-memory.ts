import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  MEMORY_COLLECTION_STATUSES,
  MEMORY_ENTRY_STATUSES,
  MEMORY_LAYERS,
  MEMORY_SCOPES,
} from '@inwit/dto';
import type {
  MemoryCollectionStatus,
  MemoryContent,
  MemoryEntryStatus,
  MemoryLayer,
  MemoryRevision,
  MemoryScope,
} from '@inwit/dto';
import { users } from './schema-auth.js';
import { agentExecutions, jobs } from './schema-job.js';
import { enumCheck, timestamptz } from './schema-shared.js';

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

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type MemoryCollectionRow = typeof memoryCollections.$inferSelect;
export type NewMemoryCollection = typeof memoryCollections.$inferInsert;
export type MemoryEntryRow = typeof memoryEntries.$inferSelect;
export type NewMemoryEntry = typeof memoryEntries.$inferInsert;
export type MemoryRevisionRow = typeof memoryRevisions.$inferSelect;
export type NewMemoryRevision = typeof memoryRevisions.$inferInsert;
