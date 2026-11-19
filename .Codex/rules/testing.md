---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.mjs"
  - "apps/server/src/**/*-logic.ts"
  - "apps/web/src/**/*-logic.ts"
---

# 测试与纯逻辑切分规范

- **纯逻辑先行切分**：复杂的状态计算、数据转换、锚点匹配、Prompt 组装与结果解析优先抽到无 I/O、无数据库依赖的 `*-logic.ts` 或纯函数模块中，并在同目录编写 co-located `*.test.ts`。
- **服务端测试隔离**：`apps/server` 的单元测试不依赖真实 PostgreSQL 或外部网络；测试环境只读取 `apps/server/.env.test`，绝不回落读取开发 `.env`。`apps/server/src/db/index.ts` 的 `setDb()` 仅作为测试 seam 使用，产品代码禁止调用。
- **架构与平台守护测试**：
  - 修改 `apps/web/src/api/`、`apps/web/src/platform/` 或桌面原生适配时，必须确保 `apps/web/src/platform/boundaries.test.ts` 通过。
  - 修改 `apps/desktop/`、Tauri 配置或构建工作流时，必须确保 `apps/desktop/__tests__/tauri.contract.test.mjs` 通过。
