import { sql } from 'drizzle-orm';
import {
  bigint,
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
  PDF_TRANSLATION_STATES,
  type PdfPageGeometry,
  type PdfQuad,
  type TranslationModelSnapshot,
  type TranslationUsage,
  type PdfTranslationState,
} from '@inwit/dto';
import { users, llmConfigs } from './schema-auth.js';
import { documents } from './schema-document.js';
import { jobs } from './schema-job.js';
import { enumCheck, timestamptz } from './schema-shared.js';
const owned = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
const doc = () =>
  uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' });
export const llmCredentialVersions = pgTable('llm_credential_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: owned(),
  configId: uuid('config_id').references(() => llmConfigs.id, { onDelete: 'set null' }),
  apiKeyEncrypted: text('api_key_encrypted'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  revokedAt: timestamptz('revoked_at'),
});
export const userTranslationSettings = pgTable('user_translation_settings', {
  userId: owned().primaryKey(),
  llmConfigId: uuid('llm_config_id').references(() => llmConfigs.id, { onDelete: 'set null' }),
  credentialVersionId: uuid('credential_version_id').references(() => llmCredentialVersions.id, {
    onDelete: 'set null',
  }),
  targetLanguage: text('target_language').notNull().default('zh-CN'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
export const pdfSegmentPages = pgTable(
  'pdf_segment_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: owned(),
    documentId: doc(),
    fileRevision: text('file_revision').notNull(),
    parserVersion: text('parser_version').notNull(),
    pageIndex: integer('page_index').notNull(),
    geometry: jsonb('geometry').$type<PdfPageGeometry>(),
    state: text('state').notNull(),
    diagnostics: jsonb('diagnostics').$type<string[]>().notNull().default([]),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pdf_segment_pages_identity').on(
      t.documentId,
      t.fileRevision,
      t.parserVersion,
      t.pageIndex,
    ),
  ],
);
export const pdfSegments = pgTable(
  'pdf_segments',
  {
    id: text('id').primaryKey(),
    userId: owned(),
    documentId: doc(),
    fileRevision: text('file_revision').notNull(),
    parserVersion: text('parser_version').notNull(),
    pageIndex: integer('page_index').notNull(),
    ordinal: integer('ordinal').notNull(),
    sourceText: text('source_text').notNull(),
    textHash: text('text_hash').notNull(),
    rects: jsonb('rects').$type<PdfQuad[]>().notNull(),
    qualityState: text('quality_state').$type<'reliable' | 'unsupported'>().notNull(),
  },
  (t) => [
    uniqueIndex('pdf_segments_identity').on(
      t.documentId,
      t.fileRevision,
      t.parserVersion,
      t.pageIndex,
      t.ordinal,
    ),
  ],
);
export const pdfTranslationContents = pgTable('pdf_translation_contents', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentKey: text('content_key').notNull().unique(),
  userId: owned(),
  documentId: doc(),
  fileRevision: text('file_revision').notNull(),
  pageIndex: integer('page_index').notNull(),
  sourceKind: text('source_kind').$type<'segment' | 'selection'>().notNull(),
  segmentId: text('segment_id'),
  anchorKey: text('anchor_key'),
  sourceText: text('source_text').notNull(),
  textHash: text('text_hash').notNull(),
  rects: jsonb('rects').$type<PdfQuad[]>().notNull(),
  generationRevision: integer('generation_revision').notNull().default(0),
  currentTranslationId: uuid('current_translation_id'),
  activeJobId: uuid('active_job_id'),
  latestJobId: uuid('latest_job_id'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
export const pdfTranslationJobs = pgTable(
  'pdf_translation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: owned(),
    documentId: doc(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => pdfTranslationContents.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    generationKey: text('generation_key').notNull().unique(),
    generationRevision: integer('generation_revision').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    state: varchar('state', { length: 16 })
      .$type<PdfTranslationState>()
      .notNull()
      .default('queued'),
    modelSnapshot: jsonb('model_snapshot').$type<TranslationModelSnapshot>().notNull(),
    credentialVersionId: uuid('credential_version_id')
      .notNull()
      .references(() => llmCredentialVersions.id),
    promptVersion: text('prompt_version').notNull(),
    contextHash: text('context_hash').notNull(),
    contextText: text('context_text').notNull().default(''),
    streamId: uuid('stream_id').notNull().defaultRandom(),
    draftText: text('draft_text').notNull().default(''),
    draftSeq: bigint('draft_seq', { mode: 'bigint' }).notNull().default(sql`0`),
    draftUpdatedAt: timestamptz('draft_updated_at'),
    executionToken: uuid('execution_token'),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: timestamptz('lease_until'),
    heartbeatAt: timestamptz('heartbeat_at'),
    dispatchedAt: timestamptz('dispatched_at'),
    errorCode: text('error_code'),
    translationId: uuid('translation_id'),
    usage: jsonb('usage')
      .$type<TranslationUsage>()
      .notNull()
      .default({
        usageStatus: 'unknown',
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    uniqueIndex('pdf_translation_jobs_idempotency').on(t.userId, t.documentId, t.idempotencyKey),
    uniqueIndex('pdf_translation_jobs_active_content')
      .on(t.contentId)
      .where(sql`${t.state} IN ('queued','preparing','dispatched')`),
    enumCheck('pdf_translation_jobs_state_check', t.state, PDF_TRANSLATION_STATES),
    index('pdf_translation_jobs_credential').on(t.credentialVersionId),
  ],
);
export const pdfTranslations = pgTable('pdf_translations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: owned(),
  documentId: doc(),
  contentId: uuid('content_id')
    .notNull()
    .references(() => pdfTranslationContents.id, { onDelete: 'cascade' }),
  generationKey: text('generation_key').notNull().unique(),
  generationRevision: integer('generation_revision').notNull(),
  fileRevision: text('file_revision').notNull(),
  pageIndex: integer('page_index').notNull(),
  sourceText: text('source_text').notNull(),
  translatedText: text('translated_text').notNull(),
  modelSnapshot: jsonb('model_snapshot').$type<TranslationModelSnapshot>().notNull(),
  promptVersion: text('prompt_version').notNull(),
  contextHash: text('context_hash').notNull(),
  usage: jsonb('usage').$type<TranslationUsage>().notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
export type PdfTranslationJobRow = typeof pdfTranslationJobs.$inferSelect;
export type PdfTranslationContentRow = typeof pdfTranslationContents.$inferSelect;
export type PdfTranslationRow = typeof pdfTranslations.$inferSelect;
export type PdfSegmentRow = typeof pdfSegments.$inferSelect;
export const pdfTranslationRequests = pgTable(
  'pdf_translation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: owned(),
    documentId: doc(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => pdfTranslationContents.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'),
    translationId: uuid('translation_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pdf_translation_requests_idempotency').on(
      t.userId,
      t.documentId,
      t.idempotencyKey,
    ),
  ],
);
