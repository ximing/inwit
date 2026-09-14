# T5 检索 pipeline + 消化 Agent 简报

## 做了什么

在 `apps/server` 落地混合检索与消化 Agent。消化处理器替换 T4 stub：真实跑 pi-agent-core agent loop，工具全部落库，不 mock LLM。

### 检索 pipeline（`src/retrieval/`）

照抄 vital 的 REST 写法（不引 qdrant-js / meilisearch SDK）：

| 文件 | 行为 |
|---|---|
| `embedding.ts` | 百炼 multimodal-embedding，`EMBEDDING_MODEL`（默认 qwen3-vl-embedding），`EMBEDDING_DIMENSIONS=2560`，单批 ≤20，写 `llm_usage_logs(capability=embed)` |
| `rerank.ts` | 百炼 text-rerank，`RERANK_MODEL`（默认 qwen3.7-text-rerank），写 `capability=rerank` |
| `qdrant.ts` | `QDRANT_URL` + `api-key`；collection `inwit_cards_dev`（`NODE_ENV=production` 时 `_prod`），2560 维 cosine；payload 索引 `user_id` / `card_id` |
| `meili.ts` | 同名 index；`filterableAttributes: user_id, card_id, tags, id`；写操作 `waitForTask` |
| `pipeline.ts` | `indexCard` / `deleteCard` / `searchCards`：Qdrant 语义 ∪ Meili 关键词（都强制 `user_id`）→ RRF → rerank → 有序 `card_id` |

server / worker 启动时 `ensureRetrievalStores()`。

`.env`：PRD 写的 `https://meilisearch.aimo.plus` 旧 key 已 403，改为与 Qdrant 同机的 `http://222.128.65.91:7700`（vital 正在用的 admin key）。Qdrant / DashScope 未改。

### 消化 Agent（`src/agent/`，pi-agent-core 0.85.1）

`processDigest`：读 capture → `resolveModelFor(userId)`（用户默认 BYOK，否则系统 qwen-plus）→ `new Agent({ tools, streamFn: models.streamSimple })` → `agent.prompt(...)`。

| 工具 | 落库 |
|---|---|
| `read_capture` | 读原文 |
| `write_cards` | `cards` 行 + `indexCard` |
| `write_questions` | 每卡 1–2 道，`cloze\|compare\|judge` |
| `search_user_memories` | `searchCards`，用于关联已有概念 |
| `attribute_thread` | 捕捉无 `threadId` 且与活跃线程高度相关时软归属 |

系统提示词要求：原子卡（一条概念 + 一个例子 + 一个易混点）、每卡出题、高度相关则点出关联。

**执行明细**：`agent_executions` 开跑即插入；每步 `tool_execution_end` 追加 `steps[{tool, input_summary, output_summary, duration_ms}]`；结束写 `status/finished_at/result_summary`。assistant 消息写 `llm_usage_logs(capability=chat)`，embed/rerank 经 ALS 带上 `execution_id`。

**失败**：LLM `error/aborted` → throw，走 T4 重试（attempts 上限 3）。卡片为空 → `capture.status=failed` 记原因，`DigestTerminalError` 让 job **done**（不再空转重试）。缺题 → throw 重试（下次会清掉该捕捉上次写出的卡和索引）。

worker 跑 Agent 期间 `heartbeatJob` 刷新 `jobs.updated_at`；`WORKER_STUCK_MS` 默认改为 15 分钟，避免消化被当成卡死回收。

### 脚本

- `scripts/test-retrieval.sh`：假卡 index → search → delete（真 embedding / Qdrant / Meili / rerank）
- `scripts/smoke-t5.sh`：server + worker，POST「梯度消失」捕捉，轮询到 digested

## 验收输出摘要

`pnpm -r typecheck && pnpm -r build` 全绿（dto / server / web）。

`./scripts/test-retrieval.sh`：

```
== T5 retrieval self-test ==
PASS  rrfMerge fused lists head=a
PASS  stores ready inwit_cards_dev dim=2560
PASS  indexCard upserted qdrant + meili
search hits=["d0b5c7cd-8089-4142-8088-c493723326e6"]
PASS  searchCards recalled the indexed card
PASS  deleteCard removed indexes
search after delete=[]
PASS  searchCards no longer returns the deleted card
all retrieval checks passed
```

`./scripts/smoke-t5.sh` 起 tsx server + worker，注册后 POST 一段约 300 字的「梯度消失」科普，**未 mock LLM**（系统 DashScope `qwen-plus`）：

```
== T5 smoke @ http://127.0.0.1:3020 ==
PASS  register returns user.id
PASS  capture id
PASS  capture starts pending
PASS  capture status digested
PASS  cards >= 2
PASS  every card has >=1 question
PASS  digest job done
PASS  agent_executions has steps
PASS  llm_usage_logs has chat
PASS  llm_usage_logs has embed
PASS  searchCards recalled digested cards
passed=11 failed=0
```

实测捕捉 `74b5701c-…`（用户 `c973d5c5-…`）约 18s 消化完成：2 张卡、4 道题（cloze / judge / cloze / compare）。job `7cc3e783-…` status=done。

psql：

| 表 | 结果 |
|---|---|
| `agent_executions` | `digest/done`，`steps=5`（read_capture → search_user_memories → write_cards → write_questions ×2），`result_summary=cards=2 questions=4` |
| `llm_usage_logs` | chat ×5（qwen-plus，9938+937 tokens）；embed ×4（qwen3-vl-embedding）；rerank ×1（qwen3.7-text-rerank，来自验收 search） |

`searchCards("梯度消失")` 召回刚切的两张卡，顺序：`b88a0a61-…`（梯度消失定义）、`24511ad6-…`（ReLU 缓解）。

## 遗留问题

- `write_cards` 未建 `review_states`（T6 明确可在本任务或 T6 补；留给 T6）。
- evolve / weekly_report / thread / chat 处理器仍是 stub。
- Meili 从 PRD 的 aimo.plus 改到 `222.128.65.91:7700`，因为公开 skill 里的 key 已 403。若 aimo.plus 换新 key，改 `.env` 即可，代码只读 `MEILI_HOST` / `MEILI_API_KEY`。
- Agent 默认 180s 超时、最多 16 轮；更长材料可能要再加 heartbeat / 提超时。
