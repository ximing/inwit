# T18 简报 —— 主题 Agent：digest 挂地图 + 整理地图 + 空白节点

依据：`docs/prd.md` §2.6 / §4.3.1。前置 T17。pi-agent 规范：所有智能行为都是 `Agent` + `AgentTool`，不在体系外调 LLM。

## 做了什么

### 消化 Agent：读地图、挂卡

文档已归属主题（或刚 `attribute_topic` 软归属）时，digest 多两件工具：

| 工具 | 作用 |
|---|---|
| `read_topic_map(topicId)` | 扁平树：id / 标题 / 路径 / 深度 / 状态 / 计数 |
| `place_on_map(cardId, nodeId \| {newNode})` | 挂到已有节点，或新建节点（≤3 级）再挂 |

prompt 要求：优先已有节点；没有合适的才 `newNode`；不要每次 digest 大改章节。软归属成功后同样必须 `place_on_map`。`write_cards` 若文档已有 `mapNodeId`（fill 场景）会一并继承。

### 「整理地图」job

`POST /api/topics/:id/map/organize` → `jobs(type=topic, payload={topicId, action:'organize'})`。

主题 Agent 工具：`read_topic_context`（目标 + 全部卡片概念 + 资料标题 + 当前地图）→ 一次或多次 `update_knowledge_map`（完整大纲树，最多三级）。

硬约束：已经挂在地图上的卡/资料只能移动不能丢；空白节点 `uncovered=true` 是 Agent 规划的「该学还没学」。动作写入 `agent_executions`；变更前后快照写入 `memories(scope=topic, layer=topic_map, key=snapshot:before|after)`。

同一主题同时只能有一个 pending/running 的 topic job（409 `TOPIC_JOB_IN_PROGRESS`）。

### 「让 AI 补」

`POST /api/map-nodes/:id/fill` → 为该节点建一篇入门文档并入队 `action=fill`。Agent：`read_map_node` → `write_document` → `write_cards`（1–2 张）→ `write_questions` → `place_on_map` → 可选 `update_node_note`。新卡 `dueImmediately`，进今日复习队列。

## 真实 LLM 验收

账号 `t18-smoke-1789365557@inwit.local`，主题「T18 深度学习基础」。`scripts/smoke-t18.sh` 自启 :3028 + worker，**23/23 PASS**。

消化一篇「梯度消失、梯度爆炸和正则化」文档，33–60s `digested`：

| 检查 | 结果 |
|---|---|
| 5 张卡 / 7 道题 | 过 |
| `read_topic_map` + `place_on_map` ×5 | 过（工具链见下） |
| 5 张卡全部挂上地图 | 过 |

整理地图 72s：

```
梯度问题
  ├ 梯度爆炸
  └ 梯度消失
正则化方法
  ├ L1 正则化
  └ L2 正则化
核心辨析
初始化策略 / 梯度裁剪 / Dropout / 早停法   ← 空白节点
```

| 检查 | 结果 |
|---|---|
| 章节结构 depth=2，11 个节点 | 过 |
| 挂载卡片 5 → 5，dropped=0 | 过 |
| `agent_executions` result_summary | `action=organize nodes=11 cards_before=5 cards_after=5 dropped=0 blank=6` |
| memories `snapshot:before`（5 节点 5 卡）/ `snapshot:after`（11 节点 5 卡） | 过 |

对空白节点 fill 33s：2 张入门卡、2 道题、`place_on_map` ×2、写了节点 note；今日复习队列 2 张。

### 工具链（agent_executions.steps）

```
digest:  read_document → search_user_memories… → write_cards → write_questions×5
         → read_topic_map → place_on_map×5
topic:   read_topic_context → update_knowledge_map×4
fill:    read_map_node → write_document → write_cards
         → write_questions×2 → place_on_map×2 → update_node_note
```

### 卡片对账

| 时刻 | 地图上的卡 |
|---|---|
| digest 后 | 5 |
| organize 后 | 5（零丢失） |
| fill 后今日队列 | 2（入门卡，due=now） |

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 277 modules |
| `pnpm --filter @inwit/server test` | 7 files / 51 tests 全绿 |
| `scripts/smoke-t18.sh` | **23/23 PASS**（真实 LLM） |

## 改动文件

### dto
- `packages/dto/src/job.ts`（`topicJobPayloadSchema` / `topicJobPayloadFrom`）

### server
- `apps/server/src/agent/{tools,prompts,digest,topic,topic-tools,run-context}.ts`
- `apps/server/src/maps/{outline,snapshot,apply,map.service,map.jobs,map.routes,tree}.ts`
- `apps/server/src/jobs/processors.ts`
- `apps/server/src/errors.ts`
- `apps/server/src/maps/outline.test.ts`

### scripts / docs
- `scripts/smoke-t18.sh`
- `docs/dev-log.md`
- `docs/tasks/t18-report.md`
