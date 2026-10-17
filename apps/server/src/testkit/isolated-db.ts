import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';
import type { Database } from '../db/index.js';
import * as schema from '../db/schema.js';

/**
 * M1 真实 PG 测试的隔离设施：在 .env.test 指向的实例（inwit_test 库）上
 * 为每次测试运行创建一个独立 schema（m1_<随机后缀>），把全部 drizzle 迁移
 * 应用到该 schema（生成 SQL 中的 "public". 限定名替换为测试 schema），
 * 结束后 DROP SCHEMA CASCADE。不触碰开发库与生产库。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '../../drizzle');

export interface IsolatedDb {
  schemaName: string;
  pool: Pool;
  db: Database;
}

function poolConfigFor(schemaName: string | null) {
  return {
    host: config.PG_HOST,
    port: config.PG_PORT,
    user: config.PG_USER,
    password: config.PG_PASSWORD,
    database: config.PG_DATABASE,
    max: 6,
    idleTimeoutMillis: 1000,
    allowExitOnIdle: true,
    ...(config.PG_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    ...(schemaName ? { options: `-c search_path=${schemaName}` } : {}),
  };
}

async function applyMigrations(pool: Pool, schemaName: string): Promise<void> {
  const journalRaw = await readFile(path.join(drizzleDir, 'meta/_journal.json'), 'utf8');
  const journal = JSON.parse(journalRaw) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const file = path.join(drizzleDir, `${entry.tag}.sql`);
    const raw = await readFile(file, 'utf8');
    const sql = raw.replaceAll('"public".', `"${schemaName}".`);
    // 单连接按简单查询协议一次执行整个迁移文件，减少远端往返。
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path = ${schemaName}`);
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`migration ${entry.tag} failed in ${schemaName}: ${String(err)}`);
    } finally {
      client.release();
    }
  }
}

export async function createIsolatedDb(prefix = 'm1'): Promise<IsolatedDb> {
  const schemaName = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Pool(poolConfigFor(null));
  try {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
  } finally {
    await admin.end();
  }
  const pool = new Pool(poolConfigFor(schemaName));
  try {
    await applyMigrations(pool, schemaName);
  } catch (err) {
    await pool.end().catch(() => undefined);
    const cleanup = new Pool(poolConfigFor(null));
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    await cleanup.end().catch(() => undefined);
    throw err;
  }
  return { schemaName, pool, db: drizzle(pool, { schema }) as Database };
}

/** 连接 global-setup 已建好的隔离 schema（每个测试文件一个 Pool）。 */
export function connectIsolatedDb(schemaName: string): IsolatedDb {
  const pool = new Pool(poolConfigFor(schemaName));
  return { schemaName, pool, db: drizzle(pool, { schema }) as Database };
}

export async function closeIsolatedDb(iso: IsolatedDb): Promise<void> {
  await iso.pool.end();
}

export async function dropIsolatedDb(schemaName: string): Promise<void> {
  const admin = new Pool(poolConfigFor(null));
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
}

/** 供人工排查时列出残留的 m1_ 测试 schema。 */
export async function listIsolatedSchemas(prefix = 'm1'): Promise<string[]> {
  const admin = new Pool(poolConfigFor(null));
  try {
    const result = await admin.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1`,
      [`${prefix}_%`],
    );
    return result.rows.map((row) => row.schema_name);
  } finally {
    await admin.end();
  }
}

// readdir 仅用于静态检查迁移目录存在，避免误导性的 “relation does not exist”。
export async function assertMigrationsPresent(): Promise<void> {
  const files = await readdir(drizzleDir);
  if (!files.some((name) => name.endsWith('.sql'))) {
    throw new Error(`no drizzle migrations found in ${drizzleDir}`);
  }
}
