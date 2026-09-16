# T16 · 后端：手动批注（带想法）+ 手动写卡 + 选段 AI 写卡

先读 `docs/rewrite/CONTEXT.md`。

## 背景现状（已核实）

- 卡片：`cards` 表有 `concept`/`example`/`confusionPoint`/`tags`/`anchorText`/`anchorBlock`，source CHECK 已含 `'manual'`（无需改）；review 入队用 `apps/server/src/review/state-init.ts` 的初始化（digest 卡默认明天到期，**手动卡传 dueAt=now 立即可复习**）
- 锚点：前端 `lib/anchors.ts` 从卡片 anchorText 生成划线；目前**没有独立批注（annotation）存储**
- job 类型 CHECK：`'digest','evolve','weekly_report','topic','chat'`；新类型要走 migration 改 CHECK（参考 0008 的做法）
- digest agent：`apps/server/src/agent/` 下 digest-logic.ts（纯逻辑可测）+ digest.ts（编排）

## 任务

### 1. 批注表 `annotations`（drizzle migration）

```
id uuid pk defaultRandom
user_id → users (cascade)
document_id → documents (cascade)
quote text not null        -- 划线的原文
note text not null default ''   -- 我的想法
created_at / updated_at timestamptz
index (user_id), index (document_id)
```

DTO：`packages/dto/src/` 新增 annotation schema（Annotation、CreateAnnotationInput{documentId,quote,note?}、UpdateAnnotationInput{note}），index 导出。

路由（`apps/server/src/annotations/` 新目录，遵守分层模式）：
- `GET /api/documents/:id/annotations` — 文档的批注列表（属主校验）
- `POST /api/annotations` — 创建
- `PATCH /api/annotations/:id` — 改 note
- `DELETE /api/annotations/:id` — 删除

### 2. 手动写卡 `POST /api/cards`

- 入参：`{documentId, concept, example, anchorText?}`（zod 进 dto；topicId 继承文档的）
- 落库 source='manual'，confusionPoint=''，tags=[]
- 同事务初始化 review_state，**dueAt=now**（立即可复习），ease 用用户 startingEase
- 返回 Card DTO

### 3. 选段 AI 写卡

- `POST /api/documents/:id/selection-cards` 入参 `{text}`（选中原文）→ 事务内 enqueueJob 新类型 `'selection'`，payload `{documentId, selectionText}`；jobs/agent_runs 的 type CHECK migration 加 `'selection'`
- agent 侧新增 selection 处理（复用 digest 的 LLM 基础设施）：针对选中段落出 1–3 张卡，anchorText 取选中文字的子串（必须能在原文找到），卡片 source='agent'，documentId 关联，初始化 review state（明天到期，同 digest）；产出落 llmUsageLogs（jobs 页用量才能看到）
- job summary/description：「选段写卡 · 《文档标题》」
- 纯逻辑（prompt 构造、产出解析）放 `selection-logic.ts` + 单元测试

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build`（dto 变了）全过
- migration 已生成并执行到远程 dev 库
- curl 实测（server :3020 在跑）：建批注/改 note/删除/列表；POST /api/cards 后 GET /api/review/stats 的今日待复习 +1；POST selection-cards 后 /api/jobs/queue 能看到 pending（worker 不在跑没关系，入队即可）
- 不启动/停止 dev server / worker
