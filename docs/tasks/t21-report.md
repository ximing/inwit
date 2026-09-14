# T21 简报 —— 进化 Agent 核心：反馈写 Memory + 换讲法重出题 + 拆卡

依据：`docs/prd.md` §2.4 / §4.3.1。前置：fuzzy / forgot(lapses≥2) 已入队 `jobs(type=evolve)`，处理器原为 stub。pi-agent 规范照旧：所有智能行为都是 `Agent` + `AgentTool`，真实 LLM，不 mock。

## 做了什么

### 反馈写 Memory（不影响 SM-2）

`POST /api/review/:cardId/feedback` 在写 `review_logs`、按 SM-2 更新 `review_states` 之后，upsert：

| 字段 | 值 |
|---|---|
| scope | `user` |
| layer | `mastery` |
| key | `card:<cardId>` |
| content.recent | 该卡最近 5 次 `{feedback, reviewedAt}`（按时间升序） |

已有 mastery 上的 `note` / `lastEvolve` 会保留。SM-2 数字不变。

入队 payload 从 T6 的 `reason:'forgot'` 改为 `reason:'repeated_forgot'`（历史 `forgot` 仍被解析成 `repeated_forgot`）。

### 进化 Agent（`src/agent/evolve.ts`）

`jobs(type=evolve, payload={cardId, reason:'fuzzy'|'repeated_forgot'})`。工具：

| 工具 | 作用 |
|---|---|
| `read_card` | 卡 + 题 + 复习状态 + 最近反馈 + mastery memory |
| `write_questions` | 只追加 1 道题，旧题保留。fuzzy 必须换题型 |
| `split_card` | 1–2 张子卡（source=agent，同 `document_id`），次日到期，related 边 reason=「由原卡拆小」。已拆过则返回已有子卡 |
| `write_memory` | layer=mastery，与 `recent` 合并 |
| `link_cards` | 已有；split 已建边，通常不必再调 |

- **fuzzy**：换题型追加 1 道新题，memory 记「第一次讲法没讲透，换了个角度」。
- **repeated_forgot**：拆小 1–2 张子卡，每卡 1 道题，原卡保留。

执行明细写 `agent_executions.steps`，用量写 `llm_usage_logs`。

## 真实 LLM 验收

`scripts/smoke-t21.sh` 自启 :3030 + worker，账号 `t21-smoke-1789374774@inwit.local`。**19/19 PASS**。

消化「梯度消失与爆炸」→ 2 卡。

| 路径 | 结果 |
|---|---|
| card A `fuzzy` | evolve `done` ~9s。原 2 题 cloze+compare → 追加 1 道 **judge**。memory note：「第一次讲法没讲透，换了个角度：……从『参数几乎不更新』这一可观察后果出发」 |
| card B `forgot` ×2 | 第一次不入队；第二次 `lapses=2`，`reason=repeated_forgot`。evolve `done` ~24s。2 张子卡（明天到期、各 1 题、`source=agent`、同文档），related 边 reason=「由原卡拆小」，原卡仍在 |

`agent_executions` 工具链：

- fuzzy：`read_card > write_questions > write_memory`（`reason=fuzzy questions=+1 memory=1`）
- split：`read_card > split_card > split_card > write_questions > write_questions > write_memory`（第二次 split 幂等返回已有子卡）

`llm_usage_logs` 10 条。`memories` 两条 `layer=mastery`，`content.recent` 为本次反馈。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 282 modules |
| `pnpm --filter @inwit/server test` | 10 files / 73 tests 全绿 |
| `scripts/smoke-t21.sh` | 19/19 PASS |

## 改动文件

### dto / server
- `packages/dto/src/job.ts`（`EVOLVE_REASONS`、`evolveJobPayloadFrom` 兼容历史 `forgot`）
- `apps/server/src/review/{evolve-reason,mastery-memory,review.service}.ts`
- `apps/server/src/agent/{evolve,evolve-tools,evolve-logic,prompts}.ts`
- `apps/server/src/jobs/processors.ts`（stub → `processEvolve`）
- `apps/server/src/review/mastery-memory.test.ts`、`apps/server/src/agent/evolve-logic.test.ts`

### 脚本 / 文档
- `scripts/smoke-t21.sh`
- `docs/tasks/t21-report.md`、`docs/dev-log.md`
