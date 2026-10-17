import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/testkit/global-setup.ts'],
    /** 真实 PG 往返较慢，DB 集成测试放宽超时。 */
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
