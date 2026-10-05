# T27 实现报告：想法批注（kind='note'）+ 脑图 text/image 节点归并批注体系

## 实现摘要

### 目标 1：DTO 与 DB

- `packages/dto/src/annotation.ts`
  - `ANNOTATION_KINDS` 增加 `'note'`。
  - `createAnnotationInputSchema.quote` 改为 `z.string().trim().max(20_000).optional()`；superRefine 新增 note 分支：quote 必须缺省或 trim 后为空；`note`（trim 非空）与 `imageKey` 至少其一；允许 `anchorBlockIndex`（软锚点）；禁止 `pageIndex` / `geometry` / `positionMs`。其它 kind 走统一「quote 必须非空」校验，text/pdf/media 的既有 allowed/forbidden 规则逐字保留。
  - `annotationSchema`、`updateAnnotationInputSchema` 未动（note 的 quote 落库为 `''`）。
- DB：`enumCheck('annotations_kind_check', …, ANNOTATION_KINDS)` 引用 dto，`migrate:generate` 生成 `apps/server/drizzle/0036_open_major_mapleleaf.sql`（drop + 重建约束，含 'note'）。

### 目标 2：Server

- 新增 `apps/server/src/annotations/annotation-image-logic.ts`：`isAnnotationImageKeyFor(userId, documentId, key)` = excerpt key（`isExcerptKeyFor`）|| 自有 doc-asset key（`isAssetKey` + `users/<userId>/` 前缀 + 无 `..`）。
- `annotation.service.ts`：`createAnnotation` 的 imageKey 校验换用新谓词、`quote: input.quote ?? ''`；`getAnnotationImage` 的 404 分支换用新谓词。
- `tryIndexAnnotation` 确认无需改动：`annotationEmbeddingText` 对 quote 空的 note 索 note 内容；纯图片 note（text 为空）走 Meili-only 分支，不报错、不阻断创建。
- resurface：挑选条件 `note <> ''` 天然排除纯图片 note，note kind 正常参与，未改动。
- `canvas.routes.ts`：POST `/api/documents/:id/canvas`（text/image 创建）保留可用，加 `@deprecated` 注释指明新管线（note 批注 + PATCH 落位）。

### 目标 3：Web 阅读页

- `lib/entity-marks.ts`：`DocEditorHost` 增加 `viewportTopBlockIndex()`（视口顶部所在顶层块，posAtCoords + `blockIndexAt`）与 `scrollBlockIntoView(blockIndex)`（滚到对应顶层块，无 mark、无高亮）；实现为 `viewportTopBlockIndexOf` / `scrollBlockIntoViewOnEditor` 并在 `createDocEditorHost` 接线（DocView 与 paper-editor 共用此工厂）。
- `docs-annotations.service.ts`：新增 `addThought({ documentId, note, imageKey?, anchorBlockIndex? }, { quiet? })`——调 `createAnnotation({ kind: 'note', … })`（不传 quote），成功后插入本地列表、bumpCardWriteGen、echoDocumentRow；非 quiet 时 `openAnnotation`（只在 rail 选中，不做正文定位）。
- `docs.service.ts`：新增 `addThought` 透传、`uploadThoughtImage`（storeDocAsset → imageKey）、`thoughtPop` 状态与 `openThoughtPop/closeThoughtPop`、`thoughtAnchorBlockIndex()`（取不到返回 null，不阻塞）、`bodyFocusBlockIndex` 状态；`focusAnnotation` 与 `selectCanvasNode` 对 kind='note' 走软锚点分支（有 anchorBlockIndex 则滚动 + revealSeq，无则只选中）。
- `thought-composer.tsx`（新）：常驻输入区组件——textarea（「记一条想法…」）+ 贴图按钮（presign 链路，本地缩略图可移除）+ 提交（Ctrl/Cmd+Enter 也可）。
- `thought-pop.tsx`（新）：浮动输入框，复用 `.sel-pop` 浮层骨架（外加 `.thought-pop`），Esc（index.tsx 统一处理）/点击外部关闭，未用 window.prompt。
- `card-rail.tsx`：notes 区块上方挂常驻 `ThoughtComposer`；`AnnotationItem` 对 kind='note' 行首渲染 Lightbulb + 「想法」kicker、不渲染 quote 引用块、有 imageKey 渲染 `AnnotationThumb`，编辑/删除/转卡片等既有操作不变。`isAnnotationAnchorLost` 对 note 恒 false（`isLostTextEntity` 的 `annotationKind !== 'text'` 分支），正文 mark 链路（`missingTextEntities` 只收 kind='text'）天然跳过 note，均未改动。
- `doc-toprow.tsx`：阅读态（`!editing && docId`）加 Lightbulb「记一条想法（N）」按钮，按按钮位置唤起浮层。
- `index.tsx`：keydown 增加 `n` 快捷键（目标在 input/textarea/contenteditable 内、或浮层已打开时不触发）；Escape 优先关闭 thoughtPop；新增 `bodyFocusBlockIndex` 滚动 effect；挂载 `<ThoughtPop />`。
- `pages/settings/index.tsx`：回收站批注列表对 note 空 quote 兜底显示「想法」。
- 样式：`pages/docs/card-rail.css` 追加 `.thought-*`、`.card-rail-thought`、`.thought-pop`、`.note-kind`（功能前缀，card-rail.css 已在 style-entry.css 登记）。

### 目标 4：脑图管线归并

- web `docs.service.ts`：`addCanvasTextAt` 改为 quiet `addThought({ note: MIND_NEW_TEXT })` → `placeOnCanvas(parentId, index)`；`addCanvasImage` 改为 storeDocAsset → quiet `addThought({ note: '', imageKey })` → 有 parent 时 `placeOnCanvas`。history 复用批注 + 摆放的既有 place 记录模式，未新造 history 类型；`insertCanvasNode`/`createCanvasNode` 仅留给旧 text/image 节点的撤销恢复路径。
- `canvas-nodes.tsx`：`noteKicker` 支持 note → 「想法」；quote 为空不渲染引用区（想法无引用块）；编辑新节点时 note 为占位文案则全选（与旧文本节点一致）。
- mobile `reader.service.ts`：两处 `createCanvasNode` 调用（saveCanvasText 创建分支、addCanvasImage）切换为 `createAnnotation({ kind: 'note', … })` + 需要落位时 `updateCanvasNode(…, { parentId })`；annotations 本地列表同步插入；`canvasTitle` 对 note 显示「想法」kicker 与 note 内容。任务书说「3 处」，实际代码只有 2 处调用点（第三处是 import），已在偏差节说明。
- canvas DTO 的 `CANVAS_NODE_KINDS` 保留 `'text'/'image'` 枚举未动。

### 目标 5：存量一次性迁移

- `0036_open_major_mapleleaf.sql`：drizzle 生成段（重建 `annotations_kind_check` 含 'note'）之后按序追加三段手写 SQL：text 节点 → note 批注（id 复用）、image 节点 → note 批注（带 image_key）、canvas_nodes 行改指 annotation（`annotation_id=id`、`text`/`image_key` 置空）。幂等（`WHERE kind IN ('text','image')`）。

## 测试与构建结果

- `pnpm --filter @inwit/server test`：73 文件 / 640 用例全绿。新增覆盖：
  - `annotation.test.ts`：note 校验规则（quote 空/缺省、note 或 imageKey 至少其一、禁止 pageIndex/geometry/positionMs、允许 anchorBlockIndex）+ 其它 kind 的 quote 必填回归。
  - `annotation-image-logic.test.ts`：excerpt 与 doc-asset 两个 key 家族的接受/拒绝（他人 key、跨文档、畸形、.. 穿越）。
  - `card.test.ts`：`cardInputFromAnnotation` 的 note 场景（quote 空 → 无 anchorText、软锚点保留；纯 imageKey 分支走图片卡）。
  - dto 无测试基建，schema/纯函数测试落在 server vitest（既有惯例，`annotation.test.ts`/`card.test.ts` 本就直接测 dto 导出）。
- `pnpm --filter @inwit/web test`：345 用例全绿；`pnpm --filter @inwit/mobile test`：95 用例全绿。
- `pnpm typecheck` 全仓绿；`pnpm -r build` 全绿（mobile 无 build 脚本，以 typecheck 为门槛）；`git diff --check` 干净。

## 迁移执行结果

- `migrate:generate && migrate` 成功（远程 PG inwit_dev）。
- 数据库确认：
  - `annotations_kind_check` 定义含 `'note'`（`CHECK (kind = ANY (ARRAY['text','pdf','media','note']))`）。
  - `SELECT kind, count(*) FROM canvas_nodes GROUP BY kind`：仅剩 `annotation 21`、`card 15`，无 text/image 行。
  - `annotations` 新增 `note 18`（17 条文本节点迁移、1 条图片节点迁移）；`canvas_nodes` 中所有 kind='annotation' 的行 LEFT JOIN annotations 无 orphan（原行 id 均可在 annotations 表查到）。
  - 存量 text/image 节点未做检索索引 backfill（按任务书范围）。

## 与任务书的偏差

1. **mobile `createCanvasNode` 只有 2 处**（saveCanvasText 创建分支、addCanvasImage），任务书写 3 处；第三处是 import 行。两处均已切换，import 已移除。
2. **软锚点取值**：任务书写「正文视口顶部所在块」。实现用 `editor.view.posAtCoords` 取视口顶部命中的块；PDF 文档无正文 editor，取不到就不传（任务书允许「取不到可靠位置就不传」）。
3. **快捷键处理位置**：任务书指向 index.tsx:130-155 的 keydown 处理；实际 Escape 处理在 98-128 行（行号漂移），`n` 挂在同一个 `onKey` 里。
4. **工具栏按钮位置**：阅读态顶行是 `doc-toprow.tsx` 的 doc-fab（paper-toolbar.tsx 是编辑态格式栏，不适合放阅读入口），按钮放在 ModeSwitch 与禅模式之间，沿用 `doc-fab-zen` 样式。
5. **mobile 附带小改**：`canvasTitle` 增加 note 分支（否则管线切换后新节点标题全是「批注」），属于管线切换的必要跟随改动，未做新入口 UI。

## 遗留风险（供 csi 验证 agent 重点关注）

1. **软锚点精度**：`posAtCoords` 在视口顶部恰处块边界/折叠块时可能偏一块； rail 点击想法后正文「跳到对应块附近」即可，精确度需真实页面确认。正文滚到底部再记想法时 rect.top<0 的分支值得重点试。
2. **想法出现在脑图根**：新想法（rail 常驻输入区创建）按 mergeCanvasForest 语义会自动成为脑图根节点——与既有批注一致，但脑图布局下「记一条想法就多一个根节点」的视觉变化需在 map 布局下确认可接受。
3. **撤销语义变化**：脑图「添加文本/图片节点」撤销现在是「移回根」（place 记录），不再是「删除节点」；节点本身要删需走批注删除（回收站）。验证撤销/重做后无残留脏状态即可。
4. **Esc 优先级**：thoughtPop 与 selectionPop/浮层 rail 同时存在时的 Esc 关闭顺序（thoughtPop 最先关）。
5. **快捷键 n**：阅读页正文选区 floating toolbar 出现时、以及脑图节点编辑 textarea 内，按 n 不应唤起浮层（后者已用 editable 检查挡住，前者无冲突预期）。
6. **图片想法取图**：迁移后的图片节点与新建贴图都走 doc-asset key + `getAnnotationImage` presign；缩略图（rail `AnnotationThumb`、脑图 `NoteThumb`）与 presign 过期重试（`retryAnnotationImage`）链路需真实 401/过期场景过一遍。
7. **旧客户端兼容**：POST canvas text/image 端点保留未回归测试（无 e2e 覆盖），如后续下线需另行安排。
8. **mobile 未真机验证**（按范围）：仅类型与单测绿。

## csi 验证（2026-10-05，真实 Chrome + dev server :3020/:5190，账号 Simon）

验证文档：`偏差与方差`（a1000000-…-0020，已消化）+ 两篇临时长文（软锚点用，已删入回收站）。截图存于 /tmp/t27-verify/。结论：**9 项中 7 项通过、1 项部分通过（D）、1 项失败（E，且为既有 bug 非 T27 回归）**。

### A. rail 常驻输入区纯文字想法 — 通过

输入提交 → 出现在批注栏（💡「想法」kicker、无引用块）→ 刷新仍在（API 复核 `kind:'note', quote:''`）。正文无新增高亮/mark。证据：02-a-thought-submitted.webp、03-a-after-refresh.webp。

### B. 带图想法 — 通过

贴图按钮上传（presign → PUT）+ 文字提交：缩略图真实加载（S3 presigned GET，`naturalWidth=120`），文字与 imageKey 落在同一条 annotation 上（API 复核）。证据：06/07-b-*.webp。
注：录入时两次遇到「点击 textarea 不聚焦」（csi DOM click 与 mouse_click 后 activeElement 仍为 BODY，JS focus 后正常）——疑似驱动 artifact，但首次提交因此丢了已输入文字（只存了图）。建议人工点一次输入区确认真机无此问题。

### C. 顶栏按钮 + 快捷键 n — 通过

- 顶栏 Lightbulb 按钮唤起浮层 ✓（08-c-thought-pop.webp）。
- 正文无焦点时 `n` 唤起 ✓（两篇文档各验证一次；csi 的 key_type 合成事件触达不到 window keydown 是驱动限制，send_keys 正常）。
- 浮层 textarea 聚焦时按 `n` 只输入字符、不重复唤起 ✓；rail 输入区聚焦时按 `n` 同样不唤起 ✓；正文 contenteditable 聚焦时不唤起 ✓。
- Esc 关闭浮层 ✓；浮层提交落库并出现在 rail（批注 3→4）✓；浮层无残留脏状态 ✓。
- 疑点：长文二上 `n` 曾有一次未唤起（activeElement=BODY），重试即恢复，未复现规律，记为瞬时抖动。

### D. 脑图归并 — 部分通过

- 「文本节点」按钮 → 创建 `kind='note'` 批注（占位文案「新节点」），出现在画布与批注栏 ✓；「图片节点」按钮 → 创建带 imageKey 的 note 批注 ✓（API 复核，批注 6→7）。
- 脑图创建的批注可被搜到 ✓（`/api/search?q=脑图文本节点二号` 首条命中）。
- 节点编辑语义：Enter=换行、Esc=取消（丢弃编辑）、失焦=提交。曾用 Esc 丢过一次编辑内容，属既有交互但易误触，建议确认是否预期。
- **不一致（低）**：无选中父节点时，文本节点会持久化 canvas 根行，图片节点不落行（仅靠 mergeCanvasForest 兜底显示为根）——`addCanvasImage` 仅在 `parentId` 存在时 `placeOnCanvas`（docs.service.ts:1543）。视觉无差异，但撤销历史与数据一致性上不对等。
- **未实现（验收描述与实现不符）**：「从 rail 把一条想法拖上脑图」——card-rail.tsx 无任何 draggable/拖拽处理，批注项只有 转卡片/编辑/删除 三个操作。实际行为是所有想法按 mergeCanvasForest 自动成为脑图根节点（canvas DOM 实测 7 条 note 批注全部在图）。需产品决策：补拖拽入口，或修改验收描述。

### E. 转卡片 — 失败（既有 bug，非 T27 回归）

转卡本身成功：卡片 front/back=想法文本、`anchorText=null`、正文无新增高亮（`.anchor` 仍为 3 处原有卡片锚点）、toast「已加入复习队列」、文档卡数 3→4 ✓。
**失败点**：批注不显示「已转成卡片」，`hasConvertedCard` 永远为 false，`转为卡片` 按钮不消失、可重复转卡。根因：`docs.service.ts addManualCard` 调 `createCard` 时丢弃了 `cardInputFromAnnotation` 已填好的 `annotationId`（dto/card.ts:233,248），server 只有收到 `annotationId` 才写 `convertedCardId`（card.service.ts:118-123）。HEAD 版本同样缺失，属 T26 遗留 bug。
建议修复：`addManualCard` 的 createCard 调用透传 `...(input.annotationId ? { annotationId: input.annotationId } : {})`。

### F. 回收站 — 通过

删除想法 → DialogService 确认框（文案含「挂在下面的节点会各自成为一棵树」）→ 批注 7→6 → 设置页回收站「批注 · 2」中显示该条（note 内容「新节点」，无空引用块）→ 恢复 → 回到批注栏（6→7）。证据：21-f-delete.webp、22-f-recycle.webp。

### G. 软锚点 — 通过

90 段长文滚到中部（视口顶部=第49段）→ `n` 记想法 → 落库 `anchorBlockIndex=33`（内部编号，非裸段落号）→ 滚回顶部 → 点击 rail 中该想法 → 正文平滑滚动，落点居中在第45–48段一带（`scrollTop 0→1328`），与记录位置偏差 ≤ 数块，满足「跳回对应块附近」。证据：26-g-jumpback.webp。
备注：第一篇 30 段长文曾误判「不滚动」，实为文档滚动区间（466px）小于视口（983px）、目标块本就在视口中央的几何假象；`rect.top<0` 分支未单独命中。abi 的记录端（posAtCoords）与回放端（children.item）语义自洽，往返精度好。

### H. 划线批注回归 — 通过

正文选段（CDP 真实鼠标拖拽）→ 浮动工具栏 →「划线批注」→ sel-pop 记笔记保存 → 批注 7→8，rail 显示引用块+笔记，正文出现下划线式批注 mark，既有 3 处卡片锚点高亮无变化，想法不产生任何正文 mark。证据：33-h-quote-done.webp。
驱动备忘：ToolIcon 在 onMouseDown 触发（selection-toolbar.tsx:49），DOM `.click()` 无效，真实鼠标/CDP mousedown 正常。

### I. 脑图根节点与撤销 — 通过（符合新语义）

选中「新节点」按 Tab 加子节点（「撤销验证子节点」，落为子级，canvas 行 parentId 指向父节点）→ 撤销 → **节点未被删除，canvas 行 parentId 变 null（移回根），annotation 保留**（API 复核）→ 重做 → 重新挂回父节点 ✓。无残留脏状态。根节点增多为 mergeCanvasForest 设计行为（无 canvas 行的批注兜底为根），视觉上按列排布可接受。

### 附带验证

- 检索：多条 note 批注均可被 `/api/search` 命中 ✓。
- Esc 优先级：index.tsx:101 Escape 链中 thoughtPop 最先关闭（代码 + 实测）✓。
- 迁移后图片取图：rail `AnnotationThumb` 的 presigned GET 正常（未制造 401/过期场景，重试链路未覆盖）。
- 曾以为画布上有「卡住的白色浮层」，实为 canvas minimap，非 bug。

### 失败与疑点清单（按严重度）

1. **高（既有 bug）** E：转卡后批注无「已转成卡片」态、可重复转卡——`addManualCard` 透传 `annotationId` 即可修。
2. **中** D：「rail 拖想法上脑图」无实现——需产品确认补拖拽或改验收。
3. **低** D：图片节点无父时不持久化 canvas 行（文本节点会）——`addCanvasImage` 无 parent 也 `placeOnCanvas(null)`。
4. **低** 脑图节点编辑 Esc 静默丢弃内容——确认是否预期。
5. **疑点** rail 输入区 textarea 两次点击不聚焦（疑驱动 artifact，建议人工复核一次）；长文二上 `n` 一次未唤起（未复现）。

验证造数说明：两篇软锚点长文已删入回收站；`偏差与方差` 上保留 8 条批注（含 1 条已转卡想法、1 条划线批注）与 1 张转出的卡片作为证据。

## 修复记录（2026-10-05，针对 csi 失败与疑点清单，改动未 commit）

### 修 1（高，既有 bug）：转卡后批注永不显示「已转成卡片」

- 根因确认：DTO `createCardInputSchema.annotationId` 与 server `createCard`（card.service.ts:118-123，收到 annotationId 才在事务内回写 `annotations.converted_card_id`）本就齐备；`cardInputFromAnnotation` 也已填好 annotationId。唯一断点是 web `DocsService.addManualCard` 重建 createCard payload 时丢弃了该字段。
- 修法：`apps/web/src/pages/docs/docs.service.ts` `addManualCard` 透传 `...(input.annotationId ? { annotationId: input.annotationId } : {})`。转卡成功后 `refreshOne` 会重拉批注列表，`hasConvertedCard` 随之变 true。
- mobile 侧排查：`apps/mobile` 唯一的 createCard 调用是手工建卡表单（reader.service.ts `saveManualCard`），没有批注转卡入口（resurface 的「转成卡片」走 server 端 accept 接口，不经此链路），无同样问题，未改。
- 回归测试：新增 `apps/web/src/pages/docs/manual-card.test.ts`（vi.mock `@/api/cards`），断言 addManualCard 透传 annotationId、无 annotationId 时不带该字段。2 用例。

### 修 2（低）：脑图图片节点无父时不持久化 canvas 行

- 修法（按任务要求）：web `addCanvasImage` 去掉 `if (parentId)` 守卫，始终 `placeOnCanvas(created.id, parentId)`，与文本节点一致。
- 深入发现的隐藏断点：仅去掉守卫不够——`placeOnCanvas`（web）与 `placeInTx`（server）对「plan unchanged」都提前返回，而新批注按 mergeCanvasForest 本就兜底成根（parentId 已为 null），`planOutlineMove(forest, id, null)` 恒 unchanged，行仍不会落库。因此补了两层：
  - `apps/web/src/pages/docs/docs.service.ts` `placeOnCanvas`：`moved.unchanged` 且成员尚无 canvas 行时不再提前返回，继续走 updateCanvasNode 落行。
  - `apps/server/src/canvas/canvas.service.ts` `placeInTx`：move 与 place 两个分支的 unchanged 提前返回都加「无行则补写」守卫（`persistFirstPlacement`，挂到目标父节点末尾 position，避免与既有行位置重叠）。此修复同时让 mobile 的直调 `updateCanvasNode({ parentId: null })` 也能落行。
- mobile 侧：`saveCanvasText` 创建分支与 `addCanvasImage` 原本都只在有 parentId 时落位（比 web 更不对等），两处均改为始终 `updateCanvasNode(documentId, created.id, { parentId })`（parentId 可为 null），与 web 语义对齐。
- server 的 placeInTx 属编排/IO 层，按仓库测试约定（纯单测、无 DB）未加测试；web 行为由现有 canvas-history/mindmap 测试与 typecheck 覆盖。

### 修 3（验收描述修正，不改功能）

- 读码确认：card-rail.tsx 无任何拖拽实现；批注（含想法）经 mergeCanvasForest 自动成为脑图根节点。画布拖拽换父链路对 annotation member 可用：`mindmap-gesture.ts:27` 明确 `kind === 'card' || kind === 'annotation'` 可选中/拖拽，`placeFromDrop`/`placeOnCanvas` 对 member kind 无差别，csi 的 I 项（note 子节点撤销移回根）也实证了 annotation 的 place 记录管线。
- 已把 `docs/tasks/t27.md` 验收第 3 条「从 rail 拖上脑图落位正常」改为「想法（含 rail 创建的）自动作为脑图根节点出现，在画布上拖拽换父/落位正常」。

### 不修只记录（待确认项）

- ~~脑图节点编辑 Esc 静默丢弃、Enter 换行失焦才提交~~ **已按产品决策修改（2026-10-05）**：Enter=提交、Shift+Enter=换行（Cmd/Ctrl+Enter 兼容旧习惯仍提交）、Esc 有未保存改动时弹确认（「有未保存的修改，放弃吗？」），无改动照旧静默退出。改动：`mindmap-gesture.ts` 的 `mindDraftKeyCommand` 加 shift 参数 + 新增 `mindDraftDirty`；`canvas-nodes.tsx` 两处编辑 textarea 接入 `cancelDraftEdit`（确认框抢焦点的 blur 用 skipBlur 吞掉，「继续编辑」时复位并 refocus）；`mindmap-gesture.test.ts` 更新键位用例 + 新增 dirty 判定 3 条。web 347 用例全绿、typecheck/build 绿。尚未做 csi 回归。
- **rail 常驻输入区 textarea 点击不聚焦**（csi 两次 DOM click/mouse_click 后 activeElement 仍为 BODY，JS focus 后正常）与**长文上 `n` 一次未唤起**（未复现）：csi 驱动 artifact 嫌疑大，标记为**待人工确认**。

### 修复后验证结果

- `pnpm --filter @inwit/server test`：73 文件 / 640 用例全绿。
- `pnpm --filter @inwit/web test`：52 文件 / 347 用例全绿（+2 新增回归用例）。
- `pnpm --filter @inwit/mobile test`：16 文件 / 95 用例全绿。
- `pnpm typecheck` 全仓绿；`pnpm -r build` 全绿；`git diff --check` 干净。
- 改动文件：`apps/web/src/pages/docs/docs.service.ts`（修 1 + 修 2）、`apps/web/src/pages/docs/manual-card.test.ts`（新增）、`apps/server/src/canvas/canvas.service.ts`（修 2）、`apps/mobile/src/pages/docs/reader.service.ts`（修 2）、`docs/tasks/t27.md`（修 3）。
- 遗留：修 1 的端到端效果（转卡 → converted_card_id 落库 → rail 显示已转卡）建议在下一次真实浏览器链路里复核一次；修 2 的「无父图片节点落行」同理。

### 修复后 csi 回归（2026-10-05，同一 dev 环境，session t27-regress）

1. **验收 E 重跑 — 通过**：rail 上对「T27 脑图文本节点二号」点「转为卡片」→ API 复核 `hasConvertedCard=true`（converted_card_id 落库）→ rail 该项显示「已转成卡片」且「转为卡片」按钮消失（不可重复转卡）。证据：35-fix-e-converted.webp。
2. **验收 D 脑图部分重跑 — 通过**：脑图上先点空白取消选中（无父节点）→「图片节点」上传 → 新 note 批注（bb89fb…）**canvas 行落库**（parentId=null，position=12）→ 刷新页面行仍在、位置不丢，画布上 4 个图片节点全部正常渲染。
3. **既有 quote 批注转卡 — 通过**：对划线批注「正则化的本质…」（kind='text'）转卡 → `hasConvertedCard=true`、rail 显示「已转成卡片」；正文锚点高亮随新卡 +1（3→4，quote 批注转卡保留 anchorText 的既有语义，非异常）。
