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
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_CLAIM_LIMIT: z.coerce.number().int().positive().default(5),
  WORKER_STUCK_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
