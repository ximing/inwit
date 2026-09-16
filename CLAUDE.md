# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Inwit — 一个「扔进去、AI 消化、催你复习」的学习伴侣。pnpm monorepo，Node 22+，全 ESM（相对导入带 `.js` 后缀，tsconfig NodeNext 风格，新文件保持一致）。

- `apps/server` — Fastify 5 + drizzle-orm + PostgreSQL，以及独立 worker 进程
- `apps/web` — Vite + React 19 + @rabjs/react（响应式 Service 模式）+ react-router + tiptap
- `packages/dto` — 前后端共享 zod schema（API 契约的唯一来源）
- `docs/` — PRD、任务书与报告（`docs/tasks/`）、开发日志；`docs/design/v2/*.html` 是 UI 重构的设计稿（视觉唯一真相来源）；`docs/rewrite/CONTEXT.md` 是重构任务的共享上下文

## 常用命令

```bash
pnpm install
pnpm dev                                  # server :3020 + web :5190（并行）
pnpm --filter @inwit/server worker        # Agent 队列 worker，需另开终端；没有它文档停在「消化中…」
pnpm --filter @inwit/server dev:s3        # 本地 S3（s3rver :4569，数据目录 apps/server/.tmp/s3）
pnpm typecheck                            # 全仓库 tsc
pnpm -r build
pnpm --filter @inwit/server test          # vitest（co-located: src/**/*.test.ts）
pnpm --filter @inwit/server test -- src/review/sm2.test.ts   # 单个文件
pnpm --filter @inwit/server test -- -t "merges"              # 按用例名过滤
pnpm --filter @inwit/server test:retrieval # 检索链路自检（需真实外部服务）

# 数据库 migration（远程 PG，.env 已配好，可直接跑）
pnpm --filter @inwit/server migrate:generate   # drizzle-kit 生成
pnpm --filter @inwit/server migrate            # 执行
```

改 schema 必须走 drizzle migration（`apps/server/src/db/schema.ts` → generate → migrate），不手改数据库。

## 服务端架构

分层模式（每个功能一个目录，如 `src/documents/`、`src/review/`）：

- `*.routes.ts` — 薄路由：`preHandler: [app.authenticate]` → zod parse（schema 来自 `@inwit/dto`）→ 调 service
- `*.service.ts` — 业务逻辑与 drizzle 查询；`toPublicX` mapper 把 row 转 DTO（时间转 ISO 字符串）
- `app.ts` — `buildApp()` 注册所有路由模块；错误统一走 `AppError.of(status, 'CODE')` + error-handler plugin
- 所有查询都以 `userId` 过滤（多租户隔离）；属主校验用 `getOwnedX` / `requireUser`
- `db/index.ts` 的 `setDb()` 是测试 seam，产品代码不调用

**Job / Agent 管线**（核心异步流）：

- service 在事务内 `enqueueJob(tx, { userId, type, payload })`（`src/jobs/enqueue.ts`）
- 独立 worker 进程（`src/worker.ts`）轮询 `jobs` 表：`recoverStuckJobs`（超时回收）→ `processDueJobs`，另有每小时扫描自动入队周报
- job 类型分发到 `src/agent/`：`digest`（切卡）、`chat`（问答转卡片）、`evolve`（换讲法/拆卡/混淆对比）、`weekly_report`——全部构建在 `pi-agent-core` + `pi-ai` 上；LLM 为 BYOK（用户自配 key），系统兜底走百炼 Dashscope
- **Agent 代码的固定切分**：可测的纯逻辑放 `*-logic.ts`（有对应 `*.test.ts`），编排/IO 放 `*.ts`、工具定义放 `*-tools.ts`

**检索层**（`src/retrieval/`）：混合召回 = Qdrant 向量（百炼 embedding，2560 维）+ Meilisearch 中文稀疏 → RRF 融合 → rerank。store 名按 `NODE_ENV` 区分（`inwit_cards_dev/prod`）。

**复习**（`src/review/`）：SM-2 间隔重复，`sm2.ts` 纯函数；用户设置经 `mergeReviewSettings` 与默认值合并（坏值静默回落默认）。

## 前端架构

- 每页一个 `*.service.ts`（`Service` 子类，参考 `pages/today/today.service.ts`），组件用 `bindServices` + `observer` + `useService` 消费；不要引入其它状态管理
- `src/routes.ts` 的 `ROUTES` 是路径唯一来源，导航/守卫一律用它
- `src/api/` 是薄 fetch 封装（带 cookie），不直接在组件里 fetch
- 编辑器是 tiptap（`pages/editor/paper-editor.tsx`）；图标用 lucide-react
- 文案全中文，语气克制书面；dev 端口 5190，`/api` 代理到 3020

## DTO 契约

前后端类型都从 `@inwit/dto` 导入。改 API 时：先改 `packages/dto/src/*.ts`（zod schema + index 导出），再同步 server 的 parse/service 和 web 的调用方。DTO 的 types 字段用 `types: "./src/index.ts"`（web 直接吃源码，server 走 dist）。

## 测试约定

后端测试是纯单元测试（无数据库依赖）：逻辑先抽到 `*-logic.ts` / 纯函数模块再测。测试环境只读 `apps/server/.env.test`，不回落开发 `.env`。前端目前没有测试，验收靠 `pnpm -F @inwit/web build`。

## 文件/图片访问规范

所有图片与文件的上传/访问一律由服务端接口层签发 S3 presigned URL（PUT 上传、GET 读取带过期时间）；客户端禁止持有 storage token、禁止直连 bucket 二次获取；DB 只存对象 key，不存 URL。
