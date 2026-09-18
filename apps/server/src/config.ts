import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Test runs load only .env.test: falling back to the dev .env would leak real
// service credentials into the test environment.
loadEnv({
  path:
    process.env.NODE_ENV === 'test'
      ? [path.join(serverRoot, '.env.test')]
      : [
          path.join(serverRoot, `.env.${process.env.NODE_ENV ?? 'development'}`),
          path.join(serverRoot, '.env'),
        ],
});

// Remote PG may try GSSAPI encryption and fail; node-pg honors this libpq env.
process.env.PGGSSENCMODE ??= 'disable';

const boolEnum = z.enum(['true', 'false']).transform((value) => value === 'true');

const blankToUndef = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalUrl = z.preprocess(blankToUndef, z.string().url().optional());
const optionalNonEmpty = z.preprocess(blankToUndef, z.string().min(1).optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3020),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PG_HOST: z.string().min(1),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().min(1),
  PG_PASSWORD: z.string().min(1),
  PG_DATABASE: z.string().min(1),
  // Never z.coerce.boolean(): the string 'false' would become true.
  PG_SSL: boolEnum.default('false'),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LLM_KEY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'LLM_KEY_ENCRYPTION_KEY must be 32-byte hex'),
  QDRANT_URL: z.string().min(1),
  QDRANT_API_KEY: z.string().min(1),
  MEILI_HOST: z.string().min(1),
  MEILI_API_KEY: z.string().min(1),
  DASHSCOPE_API_KEY: z.string().min(1),
  DASHSCOPE_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/api/v1'),
  EMBEDDING_MODEL: z.string().min(1).default('qwen3-vl-embedding'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(2560),
  RERANK_MODEL: z.string().min(1).default('qwen3.7-text-rerank'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5190'),
  ATTACHMENT_S3_ENDPOINT: optionalUrl,
  ATTACHMENT_S3_REGION: optionalNonEmpty,
  ATTACHMENT_S3_BUCKET: optionalNonEmpty,
  ATTACHMENT_S3_ACCESS_KEY_ID: optionalNonEmpty,
  ATTACHMENT_S3_SECRET_ACCESS_KEY: optionalNonEmpty,
  ATTACHMENT_S3_FORCE_PATH_STYLE: z.preprocess(blankToUndef, boolEnum.optional()),
  ATTACHMENT_S3_IS_PUBLIC: boolEnum.default('false'),
  /** Technical ceiling for imported originals (S3 multipart). Default 2 GiB. */
  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024),
  /** OCR pages per batch. Progress is persisted between batches. */
  OCR_PAGE_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  /** Rasterization DPI for OCR page images (150–200 recommended). */
  OCR_RASTER_DPI: z.coerce.number().int().min(72).max(300).default(180),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_CLAIM_LIMIT: z.coerce.number().int().positive().default(5),
  WORKER_STUCK_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /**
   * Idle window before an editor-sourced document is digested. Each save
   * postpones the pending digest by this much, so a document is only
   * digested once the user has stopped writing for this long.
   */
  DIGEST_IDLE_DELAY_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  /** Days a soft-deleted document stays in 回收站 before the worker purges it. */
  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** When true, GET /api/search skips hybrid retrieval and uses PG ILIKE. */
  INWIT_SEARCH_FALLBACK: boolEnum.default('false'),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
