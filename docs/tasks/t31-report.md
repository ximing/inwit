# T31 开发报告：概念图信息卡

## 改动清单

**新增**
- `apps/web/src/features/concepts/concept-card-logic.ts` + `.test.ts`：`placeConceptCard` 纯定位逻辑（右→左→下→上降级、clamp、caret 偏移），6 个用例。
- `apps/web/src/features/concepts/concept-card.tsx`：`CardShell`（自测量、未定位前隐藏、wheel/pointerdown 拦截）+ `ConceptNodeCard`（名称/语境/别名/定义/例子/邻居 chip/详情入口）+ `ConceptRelationCard`（A→谓词→B、语境/解释/例子/详情入口）。

**修改**
- `concept-graph.tsx`：新 props `onOpenDetail` / `detailOpen`；世界→屏幕换算（复用 `viewMeet` + `viewBoxSize`，与 SVG meet 一致）；节点/边锚点计算；卡片层渲染（key=目标 id，切换选中时重放出现动画）；帮助浮层文案更新。
- `concepts.service.ts`：`select` 改为同步轻操作（不发请求）；新增 `openDetail(target?)`（带 404 清选中）；新增 `closeDetail()`；删除 boot 里恢复选中后的详情回拉；`expandNeighbors` 改同步 select。
- `concepts-panel.tsx`：图选中走轻 `select`、列表点击走 `openDetail`、详情 onClose 改 `closeDetail`；Esc 分层（先关详情、再收卡）；图传 `detailOpen`/`onOpenDetail`。
- `concept-detail.tsx`：关系跳转改 `openDetail`；`concept-practice-dialog.tsx`：`refreshDetail` 改 `openDetail`。
- `concepts.css`：`.concept-graph-wrap` 加 `overflow: hidden`；新增 `.concept-card` 一族（含四向 caret、出现动画、chip、详情按钮），并入 prefers-reduced-motion 块。
- `concepts.service.test.ts`：boot 恢复选中不再拉详情（`getConcept` not called）；新增 select/openDetail/closeDetail/404 四个用例；mock 补 `getConceptRelation`。

## 设计要点
- 卡片位置跟随节点（平移/缩放都跟着走），字号恒定不缩。
- 邻居 chip：指出 `谓词 → 邻居名`，指入 `邻居名 → 谓词`，点击直跳邻居。
- 卡片 z-index 6（chrome 5 之上、详情浮层 7 之下）；详情浮层开着时卡片隐藏，关掉后恢复。
- 卡片内容全部来自已有 props（Concept DTO 自带 sense/aliases/definition/example，关系在 edges 里），零新增请求；出处/练习/编辑仍在详情浮层。

## 验证
- `pnpm typecheck` 全绿；`pnpm --filter @inwit/web test` 518 全绿；`pnpm --filter @inwit/web build` 通过。
- 真实链路验收：见 docs/tasks/t31-verify.md（csi agent 执行）。

## 未做
按任务书：不改详情浮层内部、不加请求、不做 hover tooltip/多卡/拖拽、不 commit、不发版。
