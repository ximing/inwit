# T22 简报 —— 错误模式分析：混淆对识别 + 对比专题

依据：`docs/prd.md` §2.4 / §2.7。前置 T21。pi-agent 规范照旧：所有智能行为都是 `Agent` + `AgentTool`，真实 LLM，不 mock。

## 做了什么

### 分析 job

`jobs(type=evolve, payload={action:'analyze_patterns', date:'YYYY-MM-DD'})`。

| 触发 | 规则 |
|---|---|
| 自动 | 当日 forgot+fuzzy ≥3 **且** 近 30 天困难卡（forgot/fuzzy ≥2）≥2 张。payload 带本地日期去重；已有 pending/running，或当日已成功跑过（不是 `skipped=too_few`），不再入队。`runAt` 延迟 15s，避免连刷时只看到一张困难卡。 |
| 手动 | `POST /api/evolve/analyze`。已有 pending/running 则返回现有 job（200），否则立即入队（201）。 |

反馈结果多了可选 `analyzeJobId`。困难卡不足 2 张时处理器直接 `skipped=too_few` 结束，不占死当日名额（too_few / 无 execution 的 done 允许再入队）。

### 处理器（`src/agent/analyze.ts`）

工具：

| 工具 | 作用 |
|---|---|
| `read_struggling_cards` | 近 30 天 forgot/fuzzy ≥2 的卡 + 已有 confusable 边 / memory |
| `link_cards` | 两张困难卡之间建 `type=confusable`（origin=agent），已有则 duplicate |
| `write_memory` | `scope=user, layer=mastery, key=confusable:<较小id>+<较大id>` |
| `write_document` | 最强一对写对比专题。`source=agent`，`status=digested`。两卡同主题则挂 `topicId`。30 天内已出过专题（memory 带 `documentId`+`generatedAt`）则返回已有文档 |
| `write_cards` | 2–3 张对比卡挂到专题文档，`anchor_text` 为文档原句，立即进今日复习 |
| `write_questions` | 每张新卡 1 道 compare 或 judge |

本轮最多 1 篇专题。专题文档走普通文档列表 / 主题资料流（`source=agent` 在列表 meta 标「对比专题」）。

### 迁移

`documents.source` 枚举加 `agent`（`0006_document_source_agent`）。用户 `POST /api/documents` 仍只能 `editor`/`paste`。

## 真实 LLM 验收

`scripts/smoke-t22.sh` 自启 :3031 + worker，账号 `t22-smoke-*@inwit.local`。**22/22 PASS**。

消化「偏差与方差」→ 2 卡。各 `forgot`×2：

| 步骤 | 结果 |
|---|---|
| 第 1、2 次 forgot | 不入队 analyze（当日次数 <3 / 困难卡 <2） |
| 第 3 次（仅 1 张困难卡） | 不入队 analyze；该卡 `repeated_forgot` 拆卡照旧 |
| 第 4 次（2 张困难卡） | 入队 `analyze_patterns`，`date=2026-09-14` |
| analyze `done` | confusable 边 1 条；memory `confusable:<a>+<b>` 带 `documentId`；专题《对比专题：偏差 vs 方差》`source=agent` `digested`；3 张对比卡（compare/judge）进今日队列 |
| 文档列表 | 专题出现，`cardCount=3` |
| 再 `POST /api/evolve/analyze` | job `done`，`source=agent` 文档仍为 1 篇 |

`agent_executions` 工具链：

`read_struggling_cards > link_cards > write_memory > write_document > write_cards > write_cards > write_questions ×3`

（第二次 `write_cards` 幂等返回已有卡。）`result_summary`：`action=analyze_patterns pairs=1 document=1 cards=3 memory=1`。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 282 modules |
| `pnpm --filter @inwit/server test` | 11 files / 81 tests 全绿 |
| `scripts/smoke-t22.sh` | 22/22 PASS |

## 改动文件

### dto / schema
- `packages/dto/src/{document,job,review}.ts`（`DOCUMENT_SOURCES` + `agent`；`evolveAnalyzeJobPayload`；`analyzeJobId`）
- `apps/server/src/db/schema.ts` + `drizzle/0006_document_source_agent.sql`

### server
- `apps/server/src/agent/{analyze,analyze-logic,analyze-tools,analyze-enqueue,evolve,evolve.routes,prompts}.ts`
- `apps/server/src/review/review.service.ts`（forgot/fuzzy 后 maybeEnqueue）
- `apps/server/src/app.ts`
- `apps/server/src/agent/analyze-logic.test.ts`、`evolve-logic.test.ts`、`documents/title.test.ts`

### web / 脚本 / 文档
- `apps/web/src/components/doc-row.tsx`（`source=agent` 标「对比专题」）
- `scripts/smoke-t22.sh`
- `docs/tasks/t22-report.md`、`docs/dev-log.md`、`README.md`
