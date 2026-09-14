# T17 简报 —— 知识地图数据模型 + API

依据：`docs/prd.md` §2.6（时间流管进，知识地图管组织）。前置 T16。

## 做了什么

### schema

`0005_map_nodes`：

- 新表 `map_nodes`：`id` uuid pk，`topic_id` → topics CASCADE，`parent_id` 自引用 CASCADE（删节点带走子树），`title`，`status`（uncovered|learning|covered，默认 uncovered），`note`，`position`，`created_at`。索引 `(topic_id, parent_id)`。CHECK：status 枚举、`parent_id <> id`。
- `cards.map_node_id` / `documents.map_node_id` 可空 FK，ON DELETE SET NULL（删节点不删内容）。各加 btree 索引。

应用层限制深度 ≤ 3（根=1）。第 4 层 POST 返回 `MAP_NODE_INVALID_PARENT`。

### mastery / status

**节点 mastery** = 该节点上直接挂载的卡片中，`review_states.last_feedback = 'remembered'` 的比例，范围 [0, 1]。未复习 / forgot / fuzzy 计 0。无卡时 mastery=0。

未采用 ease 归一化：新卡默认 ease=2.5，归一化后会看起来几乎已掌握，和「还没复习」矛盾。

**status 自动重算**（挂卡或复习反馈后写回 `map_nodes.status`；GET 也按活数据计算，避免漂移）：

| 条件 | status |
|---|---|
| 无卡 | `uncovered`（Agent 规划的空白节点、用户手建空节点都是这个正常态） |
| 有卡且 mastery < 0.8 | `learning` |
| 有卡且 mastery ≥ 0.8 | `covered` |

`GET .../map/summary.masteryPct`：整张地图上已挂卡的 remembered 占比 ×100 四舍五入。覆盖率（已覆盖概念/总节点）由 `totalNodes - uncoveredNodes` 给 T19 进度条算。

card_count / doc_count / mastery 都是**本节点直接挂载**，不向子节点汇总（章节行的合计留给 T19）。

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/topics/:id/map` | `{ nodes }` 嵌套树，每节点带 cardCount / docCount / mastery / status |
| GET | `/api/topics/:id/map/summary` | `{ totalNodes, uncoveredNodes, cardCount, masteryPct }` |
| POST | `/api/topics/:id/map/nodes` | `{ title, parentId?, note? }` → 201 |
| PATCH | `/api/map-nodes/:id` | `{ title?, note?, parentId?, position? }`；改父节点时自动追加到新同级末尾 |
| DELETE | `/api/map-nodes/:id` | 204；子树一起删；卡/资料 `map_node_id` 置 NULL |
| PUT | `/api/cards/:id/map-node` | `{ nodeId: uuid \| null }` |
| PUT | `/api/documents/:id/map-node` | 同上。卡/资料若已有别的 topicId 则 409 |

DTO：`MapNode`、`MapTree`、`MapSummary`。`Card` / `Document` 增加 `mapNodeId`。

## 验收

| 检查 | 结果 |
|---|---|
| `pnpm --filter @inwit/server migrate` | 过（0005_map_nodes） |
| `scripts/smoke-t17.sh`（自启 :3027） | **31/31 PASS** |
| 建节点 / 三级树 / 拒第 4 层 | 过 |
| 挂卡+挂资料后 cardCount=1 docCount=1，空父节点仍 uncovered，有卡未复习 → learning | 过 |
| `POST /api/review/:cardId/feedback remembered` 后该节点 status=covered、mastery=1、summary masteryPct=100 | 过 |
| 删节点：卡/资料仍在，`mapNodeId=null`；删根带走剩余子节点 | 过 |
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 277 modules |
| `pnpm --filter @inwit/server test` | 6 files / 42 tests 全绿 |

冒烟账号 `t17-smoke-*@inwit.local`，主题「T17 机器学习」，树：基础概念 → 训练问题 → 梯度消失与爆炸。

## 改动文件

### dto
- `packages/dto/src/map.ts`（新）
- `packages/dto/src/{index,card,document}.ts`

### server
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0005_map_nodes.sql` + `meta/0005_snapshot.json`
- `apps/server/src/maps/{mastery,tree,map.service,map.routes,mastery.test}.ts`
- `apps/server/src/{app,errors}.ts`
- `apps/server/src/cards/{card.mapper,card.service}.ts`
- `apps/server/src/documents/{document.service,title.test}.ts`
- `apps/server/src/review/review.service.ts`

### scripts / docs
- `scripts/smoke-t17.sh`
- `docs/dev-log.md`
- `docs/tasks/t17-report.md`
