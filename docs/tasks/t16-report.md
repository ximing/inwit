# T16 简报 —— 全量改名 thread → topic

依据：`docs/prd.md` §2.5（术语定稿：废弃「线程」，统一「主题」）。没有线上用户，直接改，不留兼容层。

## 做了什么

### DB

`0004_threads_to_topics`：`ALTER TABLE threads RENAME TO topics`；`documents` / `cards` 列 `thread_id` → `topic_id`；索引与 FK 名同步。CHECK 重写：

- `memories.scope`：`user|topic`；存量 `thread` → `topic`（`scope_id` 不变）
- `memories.layer`：`topic_map` 替换 `thread_map`
- `jobs.type` / `agent_executions.agent_type`：`thread` → `topic`

新写的 job 用 `topicId`（当前 digest/chat 仍只写 `documentId`）。旧 payload 的 `threadId` 不改。

### Server

路由 `/api/threads` → `/api/topics`。目录 `threads/` → `topics/`。错误码 `TOPIC_NOT_FOUND` / `TOPIC_ARCHIVED`。消化工具 `attribute_topic`（参数 `topicId`）。

### Web / dto

路由 `/topics`；侧栏「主题」；切换器「+ 新建主题」；空状态「还没有主题」。DTO `Topic` 替换 `Thread`；文档/卡片字段 `topicId` / `topicTitle`。

## 验收

| 检查 | 结果 |
|---|---|
| `pnpm --filter @inwit/server migrate` | 过 |
| psql：`topics` 存在、`threads` 不存在；`documents`/`cards` 只有 `topic_id` | 过 |
| memories CHECK 现为 `user\|topic` / `topic_map`；存量 0 行，UPDATE 为空操作 | 过 |
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 276 modules |
| `pnpm --filter @inwit/server test` | 5 files / 33 tests 全绿 |
| 产品源码 `apps/*/src` `packages/dto/src` 搜 `thread\|Thread\|线程` | 0 |

浏览器 `regression@inwit.dev`，CSI 真 Chrome，`http://127.0.0.1:5190`：

1. 侧栏「主题」、首页「+ 新建主题」
2. 新建「T16 验收主题」→ 切换器选中，空状态「「T16 验收主题」这张纸还是空的…」
3. 扔一句笔记 → 列表「… · T16 验收主题」
4. 「全部」混排两主题文档；「机器学习基础」滤掉 T16 那篇
5. `/topics` 归档「T16 验收主题」；回首页切换器只剩「机器学习基础」

截图：`docs/screenshots/t16-home.png`、`t16-topics.png`。

## 残留（允许 / 历史）

- `docs/prd.md` 术语定稿句、`docs/dev-log.md` T2/T4/T7 叙述
- `docs/tasks/*` 历史任务与简报
- 已应用的 drizzle `0000`–`0003`（不能改；`0004` SQL 必须写出旧表名才能 RENAME）
- `scripts/smoke-t4.sh`、`docs/regression-v0.md` 是当时的 T4/V0 记录，未改

## 改动文件

### dto
- `packages/dto/src/topic.ts`（原 `thread.ts`）
- `packages/dto/src/{index,document,card,memory,job,agent}.ts`

### server
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0004_threads_to_topics.sql` + `meta/0004_snapshot.json`
- `apps/server/src/topics/`（原 `threads/`）
- `apps/server/src/{app,errors}.ts`
- `apps/server/src/documents/document.service.ts` / `title.test.ts`
- `apps/server/src/cards/card.mapper.ts`
- `apps/server/src/agent/{digest,tools,prompts}.ts`
- `apps/server/src/jobs/processors.ts`

### web
- `apps/web/src/api/topics.ts`（原 `threads.ts`）
- `apps/web/src/pages/topics/`（原 `threads/`）
- `apps/web/src/{App,routes,styles}.css` / `shell/Layout.tsx`
- `apps/web/src/api/documents.ts`
- `apps/web/src/pages/{home,editor,doc,admin}/`

### docs
- `README.md` 路由表
- `docs/design-system.md` 侧栏
- `docs/prd.md` 当前架构图 / schema / MVP 表（历史「废弃线程」句保留）
- `docs/dev-log.md` T16
- `docs/screenshots/t16-*.png`
- `docs/tasks/t16-report.md`
