import { inject } from 'vitest';
import type { Database } from '../db/index.js';
import { setDb } from '../db/index.js';
import { closeIsolatedDb, connectIsolatedDb, type IsolatedDb } from './isolated-db.js';
import type { IsolatedDbContext } from './global-setup.js';

/** 读取 global-setup 提供的隔离 schema 上下文。 */
export function isolatedDbContext(): IsolatedDbContext {
  return inject('isolatedDb');
}

/**
 * 测试文件在 beforeAll 调用：连接共享隔离 schema 并把服务层 getDb() 指向它。
 * 返回的 iso 在 afterAll 传给 teardownIsolatedDb。
 */
export async function setupIsolatedDb(): Promise<IsolatedDb> {
  const ctx = isolatedDbContext();
  if (!ctx.available || !ctx.schemaName) {
    throw new Error(`isolated db unavailable: ${ctx.reason ?? 'unknown'}`);
  }
  const iso = connectIsolatedDb(ctx.schemaName);
  setDb(iso.db);
  return iso;
}

export async function teardownIsolatedDb(iso: IsolatedDb): Promise<void> {
  setDb(null);
  await closeIsolatedDb(iso);
}

export type { Database };
