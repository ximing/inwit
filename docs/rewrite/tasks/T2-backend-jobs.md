# T2 · 后端：任务队列实况 + Token 用量接口

先读 `docs/rewrite/CONTEXT.md`。

## 背景

任务页（`docs/design/v2/jobs.html`，先读它）需要让用户看懂 Agent 系统此刻在干什么：进行中的任务（人类可读摘要 + 已运行时长）、排队中的任务（含定时任务的未来执行时间、可取消）、队列概况计数、7 天 Token 用量趋势 + 按类型分布、执行历史（失败带错误详情 + 可重试）。现有 `jobs.service.ts` 只有平铺 list + retry + cancel，`toPublicJob` 没有摘要文案。

## 任务

### 1. Job 摘要 `summary`

- `toPublicJob` 返回中增加 `summary: string` 与 `description: string`：
  - digest（消化）：关联 documents 表取标题 → summary `消化 · 「<文档标题>」`，description `提取知识卡片并更新知识地图`
  - chat（对话）：payload 里的问题文本 → summary `对话 · 「<问题截断 30 字>」`，description `检索已有卡片后生成回答`
  - weekly_report（周报）：payload 的周范围 → summary `周报 · <范围>`，description `生成本周学习复盘`
  - evolve（进化）/ topic（主题）：关联 topics 表取名 → summary `主题进化 · 「<主题名>」`
  - 关联记录取不到时降级为 `消化 · 一篇文档` 这类通用文案，绝不抛错
- 查询时注意 N+1：批量取关联标题

### 2. 队列实况 `GET /api/jobs/queue`

返回（zod schema 进 `packages/dto/src/job.ts`）：

```
{
  running: Job[]        // status=running，含 summary/description、startedElapsedSec（now - updatedAt，秒）
  pending: Job[]        // status=pending，按 runAt 升序，含 summary/description、scheduledFor（runAt ISO）
  counts: { running: number; pending: number; doneToday: number; failed: number }
}
```

- doneToday = 今日（本地日）finishedAt 落在今天且 status=done 的数量
- failed = status=failed 且未重试过的数量（即当前可见失败）
- pending 列表限制 20 条

### 3. 用量 `GET /api/jobs/usage`

数据源 `llmUsageLogs` 表（先读 schema 确认字段）。返回：

```
{
  daily: Array<{ date: string; tokens: number }>   // 近 7 天，本地日，无数据补 0
  byType: Array<{ type: string; tokens: number }>  // 近 7 天按 job type / 调用场景汇总，按 tokens 降序
  total: number
}
```

- 如果 llmUsageLogs 里没有 type 维度，就用它现有的场景/用途字段；实在没有则按 jobId 关联 jobs.type，都没有就在任务文件里说明并只做 daily + total

### 4. 保持现有接口

`GET /api/jobs`（分页列表，加 summary/description 字段）、retry、cancel 行为不变，旧调用方（admin 页）不炸。

## 验收

- `pnpm typecheck` 通过
- `pnpm -F @inwit/server test` 通过；为 queue/usage/summary 新增测试（summary 文案降级路径、counts 计算、usage 聚合）
