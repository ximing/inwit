# T19 简报 —— 主题页重构：知识地图主视图

依据：`docs/design-system.md` §6.5。前置 T17 / T18。数值照抄，不发挥。

## 做了什么

### `/topics/:id` 地图主视图

头部：主题名衬线 `--text-xl` + 目标一行 + 2px `--accent` 进度条 +「已覆盖 x/y 概念 · N 张卡 · 掌握 z%」（覆盖率 = 非空白节点 / 总节点）。次按钮「整理地图」（job 进行中转圈「整理中…」，轮询 `GET /api/jobs/:id`），幽灵「归档」。

Tab：地图 | 资料流。

地图树：

- 章节行（有子节点）：`▾/▸` + `--text-base` 500 + 右侧 N卡·M资料（子树合计，T17 留给本任务）`--ink-faint` xs
- 概念节点：40px 行高，缩进 20px/级；10px 状态点 covered 实心 `--ok` / learning 左半 `--warn` / uncovered 虚线空心 `--ink-faint`；节点名衬线，空白节点淡色 + 幽灵「让 AI 补」
- 点击概念 → 右侧滑出面板（复用阅读页 `card-drawer`）：标题、note、小卡列表、资料列表
- 折叠态 `localStorage` 键 `inwit.map.collapsed.<topicId>`
- 空地图：「还没有地图」+ 主按钮「让 AI 整理一张地图」

资料流：首页 `DocRow`，时间倒序，归属小字「挂在：节点名」。

### 其它页

- `/topics` 每条覆盖率 2px 小条，标题进详情
- 复习轻提示：有 `map_node` 时显示 `主题 · 章节 / 节点`

### 为面板 / 轮询补的只读 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/map-nodes/:id` | 节点 + 卡摘要 + 资料 |
| GET | `/api/topics/:id/map/job` | 进行中的 topic job 或 null |
| GET | `/api/jobs/:id` | 轮询 organize / fill |

`ReviewQueueItem.mapPlacement: { topicTitle, nodePath } | null`。

## 浏览器

`regression@inwit.dev`，CSI 真 Chrome，`http://127.0.0.1:5190`。主题「机器学习基础」原先无地图（6 篇文档、卡未挂节点）。

1. `/topics` 覆盖率条为 0；点进详情空态「还没有地图」
2. 「让 AI 整理一张地图」→ 按钮转圈「整理中…」→ 25s 树出现：16 节点，已覆盖 6/16 · 13 张卡 · 掌握 31%。章节可折叠，空白节点虚线点 +「让 AI 补」
3. 点「梯度消失与爆炸」右侧滑出面板：note、3 张小卡、资料《梯度消失》；点小卡进 `/cards/:id`
4. 折叠「模型泛化…」子节点消失；`localStorage` 记下 id；刷新仍折叠
5. 资料流每条「挂在：…」（如 挂在：梯度消失与爆炸）
6. 「交叉验证」让 AI 补 → 36s → 2 张入门卡 + 资料《交叉验证入门》，节点变为在学；覆盖 7/16 · 15 张卡
7. 复习队列当前卡轻提示：`机器学习基础 · 模型评估与验证 / 交叉验证`
8. 暗主题同一棵树，token 正确

截图：`docs/screenshots/t19-map-light.png`、`t19-map-dark.png`、`t19-node-panel.png`。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 282 modules |
| hex 除 `tokens.css` 外 | 0 |
| 浏览器全链路（明暗） | 过：空主题整理出树、折叠记忆、节点面板、fill 出卡、资料流归属、复习路径 |

## 改动文件

### dto / server
- `packages/dto/src/map.ts`（`MapNodeDetail`）
- `packages/dto/src/review.ts`（`mapPlacement`）
- `apps/server/src/maps/{map.service,map.routes}.ts`
- `apps/server/src/jobs/{jobs.service,jobs.routes}.ts`
- `apps/server/src/review/review.service.ts`

### web
- `apps/web/src/api/{maps,jobs,topics,client}.ts`
- `apps/web/src/pages/topics/{index,detail,topic.service,topics.service}.tsx`
- `apps/web/src/pages/{home,review}/`
- `apps/web/src/components/doc-row.tsx`
- `apps/web/src/{App.tsx,routes.ts,styles.css}`

### docs
- `README.md` 路由表
- `docs/dev-log.md` T19
- `docs/screenshots/t19-*.png`
- `docs/tasks/t19-report.md`
