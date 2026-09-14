# T4 捕捉 inbox + 线程 + 任务队列 worker 简报

## 做了什么

在 `apps/server` 落地捕捉 inbox、学习线程和基于 PostgreSQL `jobs` 表的后台队列（不引 Redis）。消化 / 进化处理器本任务只做 stub，队列机制完整可用，真正切卡留给 T5。

### 捕捉 API（全部 `authenticate`）

| 路由 | 行为 |
|---|---|
| `POST /api/captures` | `{ content, threadId? }` → `captures(type=text,status=pending)`，同事务写 `jobs(type=digest, payload={captureId})`，**立即**返回 capture，不等消化 |
| `GET /api/captures?threadId=&status=&limit=&offset=` | 当前用户列表，`created_at DESC` 分页 |
| `GET /api/captures/:id` | 详情，含消化出的卡片及题目（T4 stub 下 `cards: []`） |
| `DELETE /api/captures/:id` | 204。取消该捕捉仍 pending 的 digest job |

**删卡选择：保留卡片。** `cards.capture_id` 在 T2 已是 `ON DELETE SET NULL`，删除捕捉不拆复习队列。pending digest 会标 `failed` + `last_error=cancelled`，避免 T5 worker 对着已删捕捉跑 Agent。

写入归档线程返回 409 `THREAD_ARCHIVED`。

### 线程 API

| 路由 | 行为 |
|---|---|
| `GET /api/threads?status=` | 当前用户线程，`updated_at DESC` |
| `POST /api/threads` | `{ title, goal? }`，`status=active`，201 |
| `GET /api/threads/:id` | 详情 |
| `PATCH /api/threads/:id` | `title` / `goal` / `status` 部分更新 |
| `POST /api/threads/:id/archive` | `status=archived` |
| `DELETE /api/threads/:id` | 204。捕捉 / 卡片的 `thread_id` 随 FK `ON DELETE SET NULL` 回到 inbox |

### 任务队列 worker

- 独立进程：`pnpm --filter @inwit/server worker`（`tsx src/worker.ts`）；构建产物 `pnpm --filter @inwit/server start:worker`
- 轮询 `jobs`：`status=pending AND run_at<=now`，事务内 `FOR UPDATE SKIP LOCKED`，再 `UPDATE … SET status='running' WHERE id=… AND status='pending'` 防并发
- 失败：`attempts` 上限 3（claim 时 +1），退避 2s / 8s / 32s，耗尽后 `failed` 并写 `last_error`
- `running` 超过 `WORKER_STUCK_MS`（默认 5min）收回 `pending`，避免 worker 崩溃后任务卡死
- **digest / evolve stub**：打日志、把 job 标 `done`、**不改** `capture.status`（保持 `pending`）

### 任务看板 API

| 路由 | 行为 |
|---|---|
| `GET /api/jobs?status=&type=&limit=&offset=` | 当前用户 job 分页 |
| `POST /api/jobs/:id/retry` | 仅 `failed` → 重新 `pending`（`attempts=0`, `run_at=now`）；其它状态 409 |
| `POST /api/jobs/:id/cancel` | 仅 `pending` → `failed` + `last_error=cancelled`（schema 无 `cancelled` 态） |

schema 未改，无新迁移。

## 验收输出摘要

`pnpm -r typecheck && pnpm -r build` 全绿（dto / server / web）。

`./scripts/smoke-t4.sh` 起 tsx server + worker（`WORKER_POLL_MS=200`），curl 注册后跑通：

```
== T4 smoke @ http://127.0.0.1:3020 ==
PASS  register returns user.id
PASS  unauthenticated captures is 401
PASS  capture1 id / status pending / type text
PASS  capture2 id
PASS  digest jobs consumed as done
PASS  captures list total>=2
PASS  capture detail still pending (stub) + cards array
PASS  thread created
PASS  threaded capture has threadId
PASS  thread filter only that thread / excludes inbox capture
PASS  thread patch title
PASS  retry requeues as pending
PASS  retried job consumed as done
PASS  cancel pending job -> failed (lastError=cancelled)
PASS  archive sets status archived
PASS  capture into archived thread is 409
PASS  delete capture is 204 / 404

passed=29 failed=0
```

worker 日志可见 stub 消费与 retry 二次 `digest.stub` → `job.done`：

```
{"msg":"digest.stub","meta":{"jobId":"e99e4fff-…","captureId":"af614eee-…"}}
{"msg":"job.done","meta":{"jobId":"e99e4fff-…","type":"digest"}}
```

## 遗留问题

- digest / evolve 真正切卡、出题、改 `capture.status=digested` 由 T5 替换 `src/jobs/processors.ts` 的 stub。
- 取消没有独立 `cancelled` 状态，看板靠 `failed` + `last_error=cancelled` 区分；若后续要单独筛「已取消」，再迁一版 check。
- 卡住的 `running` 任务按 `updated_at` 超时回收，没有 vital 那种 lease token；T5 Agent 跑得久时若超过 5 分钟会被误回收，那时再加 heartbeat / lease。
