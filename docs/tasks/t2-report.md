# T2 drizzle schema + 迁移简报

## 做了什么

在 `apps/server` 落地完整 drizzle schema，生成 SQL 并迁移到 `inwit_dev`。`packages/dto` 补齐与表对应的 zod schema / TS 类型，server schema 通过 `$type<...>` 引用这些联合类型。

### Schema（`apps/server/src/db/schema.ts`）

12 张表，列名 snake_case，主键 `uuid DEFAULT gen_random_uuid()`（drizzle `uuid().defaultRandom()`）。枚举列用 `varchar` + `CHECK`（对齐 vital，后续加值只需改约束，不必 `ALTER TYPE`）。

| 表 | 要点 |
|---|---|
| `users` | email unique、`password_hash`、created/updated_at |
| `llm_configs` | provider 五选一、`api_key_encrypted`、model、`is_default`、`base_url` 可空；每用户最多一条 default（partial unique） |
| `threads` | title / goal / status(`active\|archived`) |
| `captures` | type(`text\|ocr\|voice\|clip\|chat`)、status(`pending\|digested\|failed`)、`thread_id` 可空 FK、`last_error` |
| `cards` | concept / example / confusion_point、`tags text[]`、source(`manual\|agent\|chat`)；`capture_id` / `thread_id` 可空 |
| `card_questions` | type(`cloze\|compare\|judge`) |
| `review_states` | SM-2：ease real default 2.5、interval_days、due_at default `now()+1 day`、reps、lapses、last_feedback；UNIQUE `(user_id, card_id)` |
| `review_logs` | feedback(`forgot\|fuzzy\|remembered`) |
| `memories` | scope(`user\|thread`) + `scope_id`、layer 四层、key、content jsonb；user 范围必须 `scope_id IS NULL`，thread 范围必须有 `scope_id` |
| `jobs` | type 五类、status 四态、payload jsonb、run_at / finished_at、attempts、last_error |
| `agent_executions` | `steps jsonb`（`{tool, input_summary, output_summary, duration_ms}`）、`result_summary`、job_id 可空 |
| `llm_usage_logs` | capability(`chat\|embed\|rerank`)、prompt/completion/total_tokens、cost_estimate `numeric(14,8)` |

索引覆盖常用过滤：`cards.user_id`、`review_states(user_id, due_at)`、`jobs(status, run_at)`，以及 captures / memories / usage 等列表与看板查询列。`cards.tags` 走 GIN。

合理化（相对 §5 草案）：

- 多数表加 `updated_at`。
- `cards.capture_id` 可空：手动制卡没有捕捉来源；删 capture 时 `ON DELETE SET NULL`，卡片保留。
- `cards.thread_id` 可空：主归属线程或 inbox。
- `captures.last_error`、`jobs.attempts` / `last_error`：消化失败与 worker 重试。
- `agent_executions.result_summary`：看板「切了几张卡」类产出摘要。
- `memories` 两条 partial unique：支持按 `(user, scope, layer, key)` upsert，且正确处理 `scope_id` NULL。

### 迁移

- `src/db/migrator.ts` + `src/db/migrate.ts`：照 vital，CLI 调 `drizzle-orm/node-postgres/migrator`，读 `apps/server/drizzle/`。
- `package.json`：`migrate` = `tsx src/db/migrate.ts`；`migrate:generate` = `drizzle-kit generate`。
- 生成文件：`apps/server/drizzle/0000_init.sql`（journal tag `0000_init`）。
- `config.ts` 在 loadEnv 后设置 `PGGSSENCMODE=disable`（远程 PG 否则会走 GSSAPI 加密失败）。`PG_SSL=false` 时仍不传 `ssl`。

### DTO（`packages/dto`）

补齐 `User` / `LlmConfig` / `LlmUsageLog` / `Thread` / `Capture` / `Card` / `CardQuestion` / `ReviewState` / `ReviewLog` / `Memory` / `Job` / `AgentExecution`。时间戳为 ISO string。`User` / `LlmConfig` 不含 `passwordHash` / `apiKeyEncrypted`。`agent_executions.steps` 的 JSON 键保持 snake_case，与任务说明一致。

## 验收输出摘要

| 命令 | 结果 |
|---|---|
| `pnpm --filter @inwit/server exec drizzle-kit generate --name init` | 12 tables，写出 `drizzle/0000_init.sql` |
| `pnpm --filter @inwit/server migrate` | `migrations applied`（二次执行同样成功，幂等） |
| `psql … -c '\dt'` | 12 张表全部可见（见下） |
| `pnpm -r typecheck` | 全绿（dto / server / web） |
| `pnpm -r build` | 全绿（dto tsc、server tsc、web vite 71 modules） |

`\dt`：

```
 public | agent_executions | table | inwit_dev_user
 public | captures         | table | inwit_dev_user
 public | card_questions   | table | inwit_dev_user
 public | cards            | table | inwit_dev_user
 public | jobs             | table | inwit_dev_user
 public | llm_configs      | table | inwit_dev_user
 public | llm_usage_logs   | table | inwit_dev_user
 public | memories         | table | inwit_dev_user
 public | review_logs      | table | inwit_dev_user
 public | review_states    | table | inwit_dev_user
 public | threads          | table | inwit_dev_user
 public | users            | table | inwit_dev_user
(12 rows)
```

抽查：`users.id` / `review_states.id` 均为 `uuid DEFAULT gen_random_uuid()`；`review_states.ease` default 2.5，UNIQUE `(user_id, card_id)`，索引 `(user_id, due_at)`；`jobs` 索引 `(status, run_at)`；`llm_usage_logs.cost_estimate numeric(14,8)`。

## 遗留问题

- 捕捉「问答转卡片」的 `captures.answer` 未建列，留给 T9（任务说明允许缺列再迁）。
- job status 未含 `cancelled`；T4 取消接口需映射到 `failed` 或另加迁移。
- 无 `refresh_tokens` 表；T3 若要 refresh 落库需新表或改用长 TTL cookie。
- DTO 时间戳是 string，drizzle 行类型是 `Date`，API 边界需要 `toISOString()`。
