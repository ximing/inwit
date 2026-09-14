# T11 数据模型演进简报 —— documents + card_links（captures 退役）

## 做了什么

产品从「聊天流捕捉」切到「文档为中心」。`captures` 由表级迁移退役，卡片挂 `document_id` + 出处锚点列，卡片之间有 `card_links`。

### 迁移策略（选同一个 drizzle SQL 文件，不用事后脚本）

`apps/server/drizzle/0002_documents_card_links.sql` 在同一条 migrate 里：

1. 建 `documents` / 索引 / FK
2. `INSERT INTO documents SELECT … FROM captures`（**保留原 uuid**）
3. `cards` 加 `document_id` / `anchor_text` / `anchor_block`，按 `capture_id` 回填
4. 删 `cards.capture_id` 及旧 FK/索引
5. 建 `card_links`
6. `DROP TABLE captures`

选 SQL 内联而不是 migrate 后脚本，是为了 schema + 回填 + 丢表同一次事务语义（drizzle 按 statement 顺序执行）。`jobs.payload.captureId` **故意不改**：已完成的 job 不再重跑；新 job 写 `{documentId}`；processor / 取消 pending / admin join 都用 `coalesce(documentId, captureId)`，因为 documents 沿用了原 capture id。

映射：

| 来源 | 目标 |
|---|---|
| `raw_content` | `content_md` |
| 首行（空则全文）截 40 字 | `title` |
| `type=chat` | `source=chat` |
| 其它 type（本库只有 `text`） | `source=paste` |
| `status` / `answer` / `created_at` / `updated_at` | 直拷 |
| `last_error` | 丢弃（PRD / T11 列清单没有这一列；失败原因仍在 `agent_executions.error`） |

`idx_documents_user_created` 是 `(user_id, created_at)` btree（drizzle 生成 ASC）。`ORDER BY created_at DESC` 仍能用该索引。

### 代码

- `POST /api/captures` → `POST /api/documents` `{title?, contentMd, threadId?}`，title 缺省 `titleFromContent`
- GET 列表 / 详情 / 删除同步改名；`POST /api/chat` 仍在，写 `documents(source=chat)`，`answer` 列沿用
- digest：`read_capture` → `read_document`，session / payload 用 `documentId`
- `GET /api/cards/:id/links` → `{outgoing, incoming}`（CardLink + `{id, concept, tags}`）
- `DELETE /api/card-links/:id`（用户可删 agent 边）
- dto：`Document` / `CardLink`；`Card` 加 `documentId` + `anchorText` + `anchorBlock`；`Capture` 标 deprecated 并 alias 到 `Document`
- 前端为过 typecheck/build 接到新 API（主页仍是原时间线，T13 会换成文档列表）

`write_cards` 的锚点必填、`link_cards` 工具留给 T14。

## 行数对账（`inwit_dev`，migrate 当时）

| 项 | 迁移前 | 迁移后 |
|---|---:|---:|
| captures / documents | 12 | **12** |
| cards | 16 | 16 |
| cards.`capture_id` IS NULL | 0 | 列已删 |
| cards.`document_id` IS NULL | — | **0**（无历史孤儿） |
| card_links | — | 0 |

`documents.source` × `status`：

| source | status | n |
|---|---|---:|
| chat | digested | 3 |
| paste | digested | 5 |
| paste | pending | 4 |

4 条 pending 文档是原 `captures.status=pending` 直拷。对应 digest job 当时已是 `done`/`failed`（payload 仍是 `{captureId}`），属于迁移前的状态不一致，不是本迁移丢数据。重试失败 job 会走 `captureId` 回退，命中同 uuid 的 document。

`captures` 表已不存在；`cards.capture_id` 已不存在。

## 验收

| 检查 | 结果 |
|---|---|
| `pnpm --filter @inwit/server migrate` | 全绿 |
| 行数对账 | 12=12，`cards.document_id` 无 NULL |
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿（web vite 117 modules） |
| `pnpm --filter @inwit/server test` | 4 files / 21 tests 全绿 |
| `scripts/smoke-t11.sh` | 11/11 PASS |

Smoke（新用户 `t11-smoke-*@inwit.local`，server :3023 + worker）：

1. 未登录 `POST /api/documents` → 401
2. 注册
3. `POST /api/documents` `{contentMd: 梯度消失…}` → `source=paste`、`status=pending`、title 取前 40 字
4. 轮询至 `digested`，2 张卡，`documentId` 对齐，`anchorText`/`anchorBlock` 字段在（值为 null，T14 再填）
5. `GET /api/cards/:id/links` → `{"outgoing":[],"incoming":[]}`

## 改动文件

### dto
- `packages/dto/src/document.ts`（新）
- `packages/dto/src/capture.ts`（deprecated alias）
- `packages/dto/src/card.ts`
- `packages/dto/src/job.ts`
- `packages/dto/src/admin.ts`
- `packages/dto/src/index.ts`

### schema / 迁移
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0002_documents_card_links.sql`
- `apps/server/drizzle/meta/0002_snapshot.json`
- `apps/server/drizzle/meta/_journal.json`

### server
- `apps/server/src/documents/document.service.ts`（新）
- `apps/server/src/documents/document.routes.ts`（新）
- `apps/server/src/documents/title.test.ts`（新）
- `apps/server/src/cards/card.mapper.ts`（新）
- `apps/server/src/cards/card.service.ts`（新）
- `apps/server/src/cards/card.routes.ts`（新）
- `apps/server/src/app.ts`
- `apps/server/src/errors.ts`
- `apps/server/src/jobs/queue.ts`
- `apps/server/src/agent/tools.ts`
- `apps/server/src/agent/digest.ts`
- `apps/server/src/agent/chat.ts`
- `apps/server/src/agent/prompts.ts`
- `apps/server/src/agent/run-context.ts`
- `apps/server/src/admin/admin.service.ts`
- `apps/server/src/review/review.service.ts`
- 删除 `apps/server/src/captures/capture.service.ts`、`capture.routes.ts`

### web（为 typecheck；T13 换主界面）
- `apps/web/src/api/documents.ts`（新）
- 删除 `apps/web/src/api/captures.ts`
- `apps/web/src/pages/capture/capture.service.ts`
- `apps/web/src/pages/capture/index.tsx`
- `apps/web/src/pages/threads/threads.service.ts`
- `apps/web/src/pages/threads/index.tsx`
- `apps/web/src/pages/admin/index.tsx`

### 其它
- `scripts/smoke-t11.sh`
- `docs/dev-log.md`
- `docs/tasks/t11-report.md`（本文件）

## 遗留

- 消化 Agent 还不写 `anchor_*`、还不建 `card_links`（T14）。
- 历史 smoke（`scripts/smoke-t4.sh` 等）仍打 `/api/captures`，只作当时验收档案，不再当回归套件。
- README 仍写「捕捉 inbox」；路由与文案收口在 T13/T15。
- 4 条 pending 文档对应的 digest job 在迁移前已 `done`，文档状态没跟上——不在本任务范围。
