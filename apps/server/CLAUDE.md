# `apps/server` 服务端指令

## 这个目录负责什么

- Fastify 5 HTTP API 服务（`src/index.ts`、`src/app.ts`）、PostgreSQL 数据访问层（`src/db/`）以及独立异步队列进程（`src/worker.ts`）。
- 承载 Agent 管线（`src/agent/`）、混合检索（`src/retrieval/`）、SM-2 复习调度（`src/review/`）与 S3 预签名文件访问（`src/storage/`、`src/files/`、`src/assets/`）。

## 放置约束

- **按领域分目录**（如 `src/documents/`、`src/cards/`、`src/review/`、`src/concepts/`）：
  - `*.routes.ts` — 薄路由层：`preHandler: [app.authenticate]` → 使用 `@inwit/dto` 的 schema 做 `parse` → 调用 service。不在路由文件堆叠业务查询或复杂分支。
  - `*.service.ts` — 业务逻辑与 drizzle 查询；通过 `toPublicX` mapper 将数据库行转为 DTO（Date 统一转 ISO 字符串）。
  - `*-logic.ts` — 无 I/O、无数据库依赖的可测纯函数，配同名 `*.test.ts`。
  - `src/agent/*-tools.ts` — Agent 工具定义，与 `*-logic.ts`（纯逻辑）和 `*.ts`（编排/IO）分层放置。
- **不放什么**：不在路由或 service 内手写重复的请求体 schema（应放入 `packages/dto`）；不在产品代码中调用 `src/db/index.ts` 的 `setDb()`（仅作测试 seam）。

## 开发偏好与架构约束

- **多租户隔离**：所有数据库查询必须以 `userId` 过滤；资源属主校验统一走 `getOwnedX` / `requireUser`。
- **错误处理**：在 `src/app.ts` 的 `buildApp()` 中统一注册路由模块；业务异常一律抛 `AppError.of(status, 'CODE')`，交由 `error-handler` 插件格式化输出。
- **Job / Agent 异步管线**：
  - 业务 service 在数据库事务内调用 `enqueueJob(tx, { userId, type, payload })`（`src/jobs/enqueue.ts`）。
  - 独立 `worker.ts` 轮询 `jobs` 表：`recoverStuckJobs`（超时回收）→ `processDueJobs`，并按小时扫描入队周报。
  - Job 分发至 `src/agent/`（`digest` 切卡、`chat` 问答制卡、`evolve` 卡片演化、`weekly_report` 周报等），基于 `pi-agent-core` + `pi-ai` 构建。
  - **模型密钥边界**：对话与消化必须使用用户自己的 BYOK 模型配置；embedding（2560 维）与 rerank 使用系统百炼密钥。
- **混合检索（`src/retrieval/`）**：Qdrant 向量召回 + Meilisearch 中文稀疏召回 → RRF 融合 → rerank。集合/索引名按 `NODE_ENV` 区分（`inwit_cards_dev` / `inwit_cards_prod`）。
- **SM-2 复习（`src/review/`）**：核心算法在 `sm2.ts` 纯函数中；用户复习设置必须经 `mergeReviewSettings` 与默认值合并（非法值静默回落默认）。
