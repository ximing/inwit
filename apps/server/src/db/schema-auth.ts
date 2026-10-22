import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { LLM_PROVIDERS } from '@inwit/dto';
import type { LlmProvider, ReviewSettings } from '@inwit/dto';
import { enumCheck, timestamptz } from './schema-shared.js';

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

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AccessTokenRow = typeof accessTokens.$inferSelect;
export type NewAccessToken = typeof accessTokens.$inferInsert;
export type AccessTokenLogRow = typeof accessTokenLogs.$inferSelect;
export type LlmConfigRow = typeof llmConfigs.$inferSelect;
export type NewLlmConfig = typeof llmConfigs.$inferInsert;
export type OcrConfigRow = typeof ocrConfigs.$inferSelect;
export type NewOcrConfig = typeof ocrConfigs.$inferInsert;
