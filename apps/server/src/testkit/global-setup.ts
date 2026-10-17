import { assertMigrationsPresent, createIsolatedDb, dropIsolatedDb } from './isolated-db.js';

export interface IsolatedDbContext {
  available: boolean;
  schemaName?: string;
  reason?: string;
}

declare module 'vitest' {
  interface ProvidedContext {
    isolatedDb: IsolatedDbContext;
  }
}

/** vitest 5 未导出 GlobalSetupContext 类型；上下文是带 provide 的 TestProject。 */
interface GlobalSetupContextLike {
  provide: (key: 'isolatedDb', value: IsolatedDbContext) => void;
}

/**
 * 每次 `vitest run` 创建一个隔离 schema 并应用全部迁移；所有 DB 测试文件共享
 * 该 schema（各自 seed 独立用户，查询均按 userId 隔离），结束后整体 drop。
 * PG 不可用时标记 available=false，相关测试文件以 describe.skip 跳过并在
 * 交付说明中列为未验证项。
 */
export default async function globalSetup({ provide }: GlobalSetupContextLike) {
  try {
    await assertMigrationsPresent();
    const iso = await createIsolatedDb('m1');
    provide('isolatedDb', { available: true, schemaName: iso.schemaName });
    await iso.pool.end();
    return async () => {
      await dropIsolatedDb(iso.schemaName).catch((err) => {
        console.error(`drop isolated schema ${iso.schemaName} failed`, err);
      });
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[testkit] isolated PG unavailable, DB tests will be skipped: ${reason}`);
    provide('isolatedDb', { available: false, reason });
    return undefined;
  }
}
