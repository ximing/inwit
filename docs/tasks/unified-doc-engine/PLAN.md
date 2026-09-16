# 统一文档引擎（unified-doc-engine）— 目标架构与决策定稿

> 本文档是本轮重构的唯一设计真相。每个任务开始前完整阅读本文 + `docs/rewrite/CONTEXT.md`。
> 大原则：**不做任何兼容逻辑**（产品未部署，dev 数据可丢弃），直接改到目标干净架构。

## 1. 核心决策

### 1.1 文档存 PM JSON，markdown 概念退出系统内部

- `documents.contentMd: text` → `documents.contentJson: jsonb`，存 tiptap/ProseMirror JSON，是唯一真相。
- markdown 只存在于**导入边界**：md/txt 文件、PDF/OCR 提取结果、agent 生成的周报/对比文档，这些外部产出是 markdown 文本，写库前经 `@inwit/markdown` 的 `parseMarkdownToPmJSON` 转成 PM JSON。系统内部（存储、API、编辑器、检索）没有 markdown 往返。
- `serializePmJSONToMarkdown` 方向废弃不用；需要纯文本的地方（检索 embedding、agent prompt、doc-meta）用 `@inwit/doc-schema` 的 `pmJsonToText` 现算。

### 1.2 分页用节点，不用分隔符

- 新增 block 级 atom 节点 `pageBreak`，attrs: `{ pageIndex: number }`（1-based）。
- PDF 提取/OCR 每页之间插一个 `pageBreak` 节点，替代现有 `PDF_PAGE_SEPARATOR`（`\n\n---\n\n`）。
- 转换规则：导入 markdown 里的 thematicBreak（`---`）→ `pageBreak` 节点，`pageIndex` 从 1 递增。
- `pmJsonToText` 中 pageBreak 输出 `\n\n--- 第 N 页 ---\n\n`，保留页序信息供检索/agent。
- PDF 标注的 `pageIndex`、摘录卡片的页码语义不变，定位方式变为「找 pageIndex === n 的 pageBreak 节点」。

### 1.3 锚定 = 文档 schema 内的实体引用 mark

- `annotationMark`（inline mark），attrs: `{ annotationId: string }`。
- `cardAnchor`（inline mark），attrs: `{ cardIds: string[] }`（多卡共锚 = 数组追加）。
- 标注/卡片实体独立存表，文档 JSON 里只存 ID；`quote`/`anchorText` 降级为**展示快照**（侧边栏、检索），不再承担定位职责。
- mark 不渲染视觉样式：renderHTML 输出带 `data-*` 属性的 `<span>`，无背景色。所有视觉由前端 decoration 层负责：
  - 常态高亮 = 所有锚范围做**并集**，统一底色（重叠区不加深）。
  - 激活高亮 = 点击卡片/标注时按 id 找到其 mark 的完整范围（含与别人的重叠部分），叠激活色。
  - 点击 = 命中区域收集所有实体 id，沿用 `onAnchorClick(ids[])` / `onAnnotationClick(ids[])`。
- PM transaction 自动维护 mark 位置——这就是位置转换机制，不存 from/to，不做手动映射。

### 1.4 一致性三条兜底规则

1. **粘贴剥实体 mark**：编辑器 `transformPasted` 移除 `annotationMark`/`cardAnchor`，保证一个实体只有一处锚。
2. **陌生 id 惰性清理**：渲染时忽略指向不存在实体的 mark；编辑器下次保存时顺带清掉。
3. **原文被删 → 无锚展示**：mark 随文字消失后，实体仍在侧边栏可见，显示「原文已删除」态，点击不高亮。

### 1.5 写入者唯一（并发规则，不上实时协作）

- **文档正文的唯一写入者是客户端编辑器会话**（防抖全量 PUT，现状不变）。
- 服务端只在「没有编辑会话」的场景写 contentJson：导入完成、OCR 提取（此时文档 pending 不可编辑）。
- digest 产卡时 server **不改文档**：只建卡片行（带 `anchorBlockIndex` + quote 快照）；客户端打开/轮询到新卡片后，用共享的 locate 逻辑**幂等补打** `cardAnchor` mark，编辑器会话随下次保存落库；DocView 只读场景打内存 mark 不落库。
- 将来上 Yjs 时：mark 方案原样兼容，「补打」机制删除，server 变为实时 peer 直接打 mark。本期为此做的伏笔：`@inwit/doc-schema` 共享包让 server 能无头实例化同一 schema。

### 1.6 Agent 用结构化引用，永不输出文档操作

- 喂给 digest agent 的文档 = `blocksFromPmJSON` 产出的带编号块视图：`[{ index: 1, pageIndex: 1, text: "..." }, ...]`（pageBreak 占一块、text 为空）。
- `write_cards` tool 参数改为 `{ concept, example, confusionPoint, blockIndex, quote }`；quote 只需在指定块内匹配。
- server 建卡时用共享 `locateQuote` 校验 quote 确实在该块内，失败则该卡无锚（不报错，卡片照建）。
- `apps/server/src/agent/anchors.ts` 的 `resolveAnchor`/`splitMarkdownBlocks`/`sliceIgnoringWs` 整条降级链删除。
- 划词产卡（selection-cards）：客户端从编辑器 selection 算出 top-level blockIndex + quote 文本一起提交。

## 2. 数据层变更

### DB migration（drizzle，直接改列，dev 数据可丢）

- `documents`：`content_md text` → `content_json jsonb NOT NULL`（默认空 doc `{"type":"doc","content":[{"type":"paragraph"}]}`）。
- `cards`：`anchor_block varchar(8)` → `anchor_block_index integer`（删旧列加新列）。
- `annotations`：新增 `anchor_block_index integer`（nullable；pdf/media 标注不用）。

### DTO（packages/dto）

- `documentSchema.contentMd` → `contentJson`（宽松 schema：`z.looseObject({ type: z.literal('doc') }).passthrough()` 之类，够用即可，不深度校验 PM 结构）。
- `createDocumentInputSchema` / `updateDocumentInputSchema` 相应改。
- `cardSchema.anchorBlock` → `anchorBlockIndex: number | null`；`createCardInputSchema` 同步（`anchorBlockIndex` int 可选）。
- `annotationSchema` 增加 `anchorBlockIndex: number | null`；`createAnnotationInputSchema` 的 text 标注允许带 `anchorBlockIndex`。
- `PDF_PAGE_SEPARATOR` 常量删除；`titleFromContent(contentMd)` 改为基于 PM JSON（或 blocks）取首个非空块文本；`pageIndexToAnchorBlock` 删除（页码直接存 pageIndex 语义处）。

## 3. 共享包 `@inwit/doc-schema`（packages/doc-schema）

新包，ESM、`types: "./src/index.ts"` 吃源码风格同 `@inwit/dto`。依赖 `@tiptap/core` 及相关扩展、`prosemirror-model`/`prosemirror-state`（headless 可用）。**不依赖 React、不依赖 DOM。**

内容：

- **schema 元素**（tiptap Extension，schema-only，无 NodeView）：
  - `PageBreak` node：block、atom、`pageIndex` int attr；parseHTML `div[data-page-break]`；renderHTML 输出 `<div data-page-break data-page-index>`。
  - `AnnotationMark`：`annotationId` attr；renderHTML `<span data-annotation-id>`。
  - `CardAnchorMark`：`cardIds` string[] attr；renderHTML `<span data-card-ids>`（JSON 序列化数组）。
  - `getHeadlessSchema()`：用 `@tiptap/core` 的 `getSchema` 从「StarterKit 子集 + 表格 + taskList + image/video + pageBreak + 两个 mark」构建 prosemirror Schema，供纯函数和 server 无头使用。**节点/mark 集合必须与 web 编辑器一致**，web 的 `createDocExtensions` 改为从本包导入这三个元素（React NodeView 留在 web 侧 `.extend()`）。
- **纯函数**（输入输出都是 plain PM JSON，内部用 headless schema 做位置计算）：
  - `blocksFromPmJSON(doc)` → `{ index, pageIndex, text }[]`：top-level 块，1-based；pageBreak 块 text 为 `''`；pageIndex 为当前页（遇 pageBreak 后递增）。
  - `pmJsonToText(doc)` → string：块间 `\n\n`，pageBreak 输出 `--- 第 N 页 ---`。
  - `locateQuote(doc, blockIndex, quote)` → `{ from, to } | null`：先块内精确 `indexOf`，再块内空白容错匹配；不行返回 null（不做全文降级）。
  - `applyEntityAnchor(doc, kind: 'card' | 'annotation', id, range)` → 新 doc JSON：用 prosemirror Transform 的 `addMark` 打 mark；card 时若范围已有 `cardAnchor` mark 则合并 cardIds 数组。
  - `findEntityAnchors(doc)` → `{ kind, id(s), from, to }[]`：扫描全部实体 mark（前端 decoration 层和「补打时判断谁缺 mark」都用它）。
  - `stripEntityAnchors(doc)` → 新 doc JSON：移除两种实体 mark（粘贴剥离用）。
  - `thematicBreaksToPageBreaks(doc)` → 新 doc JSON：导入转换用，thematicBreak → pageBreak 并编号。
- **测试**：vitest，覆盖以上纯函数（构造 JSON fixture 测，不需要 DOM）。

## 4. Server 链路改造点（T2/T3 范围内逐处落实）

- `document.service.ts`：`toPublicDocument`、create/update/chat 全部改 contentJson；空白判断用 `pmJsonToText`（`document-logic.ts` 的 ZWSP 逻辑删除）。
- 导入/OCR 完成写库处：markdown → `parseMarkdownToPmJSON` → `thematicBreaksToPageBreaks` → contentJson。
- agent 生成文档（weekly_report、对比专题、`source='agent'`/`'chat'`）：agent 照旧输出 markdown，**写库前**走同样的转换管道。
- `retrieval/pipeline.ts`：`documentEmbeddingText` 改用 `pmJsonToText` 产物；payload 里 `content_md` 键改名 `content_text`。
- `agent/doc-meta.ts`：clip 对象改为 `pmJsonToText` 产物。
- digest：`agent/digest*.ts`/`tools.ts` 的 prompt 改为编号块视图；`write_cards` 参数改 `{blockIndex, quote}`；建卡校验 + 写 `anchorBlockIndex`；删 `anchors.ts` 降级链及其测试，替换为 locate 相关测试。
- selection-cards：DTO 增加 `blockIndex`，server 侧同一套 locate 校验。

## 5. Web 链路改造点（T4 范围内逐处落实）

- `editor.service.ts`：`draftMd/lastSavedMd` → JSON（比较用 `JSON.stringify`）；load/save 全走 contentJson；`hasSubstance`/`isBlankMarkdown` 删除（用 `pmJsonToText` 判空）。
- `paper-editor.tsx`：`contentFromSeed`/`serializePmJSONToMarkdown` 删除，直接喂/取 JSON。
- `DocView.tsx`：`source` 改为 PM JSON。
- `anchor-highlight.ts` 重写：不再 indexOf；扫描实体 mark → decoration 并集常态高亮 + activeId 精确高亮 + 点击收集 id。`lib/anchors.ts` 的 `AnchorSpec`/findSubstringRanges 等删除，改为按 id 索引的轻量结构。
- 划词标注：记录 selection 的 `{blockIndex, quote}` → POST 创建 → 成功后把 `annotationMark`（真实 id）打到原 range。
- 幂等补打：文档打开/轮询刷新后，对照 `findEntityAnchors` 结果，缺 mark 的卡片/标注用 `(anchorBlockIndex, quote)` locate 补打；编辑器会话落库，DocView 只内存。
- 粘贴剥离：`transformPasted` + `stripEntityAnchors`。
- 侧边栏：无锚实体显示「原文已删除」态。
- 摘录卡片（截图）：`anchorText = IMAGE_EXCERPT_QUOTE` 无文字锚，保持无锚（或后续锚 pageBreak，本期不做）。

## 6. 编排与验收

- 执行者：grok CLI（headless，`--yolo`），每个任务一个 session（固定 UUID 便于 resume 修错）。
- 编排者（Claude）负责：任务书、串行调度、每任务后的验收（`pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build`、migration 执行）、最终 csi 浏览器回归。
- 纪律（继承 CONTEXT.md）：不 git commit/push；不停 dev server；DB 变更只走 drizzle migration；文案全中文。
