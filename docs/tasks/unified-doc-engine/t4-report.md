# T4 报告：web 全链路 — 编辑器/阅读器 JSON 化 + mark 锚定渲染 + 标注/卡片新流程

## 做了什么

前端内部不再走 markdown 往返。文档正文以 ProseMirror JSON 读写；锚定高亮改为扫描实体 mark 的 decoration 并集；划词提交 `(blockIndex, quote)`；打开/轮询后幂等补打 mark。

### 1. 编辑器 / 阅读器 JSON 化

- `editor.service.ts`：`draftMd`/`lastSavedMd` → `draftJson`/`lastSavedJson`（`JSON.stringify` 比较）；空白用 `pmJsonToText`；load/save 走 `contentJson`
- `paper-editor.tsx`：`seedMarkdown` → `seedDoc`；`onChange(editor.getJSON())`；删除 `contentFromSeed` 的 markdown parse/serialize
- `DocView.tsx`：`source` 改为 PM JSON；删除 `contentFromSource`
- today / topics / docs 捕获框：`createDocument({ contentJson: textToPmDoc(text) })`；空白文档用 `EMPTY_PM_DOC`
- 列表 merge / `stageFor.hasContent` / PDF OCR pending 全部改读 `contentJson`
- `@inwit/markdown` 已从 `@inwit/web` 依赖与 lockfile 移除

### 2. 锚定渲染

- 重写 `anchor-highlight.ts`：扫 `cardAnchor` / `annotationMark` → 扫线并集 decoration（同种重叠一层底色；卡片 `.anchor` 与标注 `.anchor-note` 可区分）
- 激活 id 给对应 mark 完整范围加 `is-on` / `is-active`；`updateDecorations('anchorHighlight')` 仍由 PaperEditor / DocView 触发
- 点击从 mark / decoration 的 `data-card-ids`（JSON 数组）与 `data-annotation-id` 收集 ids，回调签名不变
- `lib/anchors.ts` 旧 `AnchorSpec` / `findSubstringRanges` / `groupAnchorsByText` / `wrapAnchors` 删除，改为 `EntityMeta`（`id → kind, note`）
- 陌生 id 的 mark 不着色（decoration 只认当前实体列表）

### 3. 划词 / 建卡

- 编辑器 selection 取 `{ blockIndex, quote, from, to }`；text 标注 POST 带 `anchorBlockIndex`，成功后对原 range 打 `annotationMark`
- 划词产卡 `queueSelectionCards(docId, text, blockIndex)`；手动建卡带 `anchorText` 时一并给 `anchorBlockIndex`
- PDF 摘录卡不再写已删除的 `pageIndexToAnchorBlock`；`IMAGE_EXCERPT_QUOTE` 不打文字锚
- PDF 页码映射改为 `blocksFromPmJSON` 的 `pageIndex`（不再用 `PDF_PAGE_SEPARATOR`）

### 4. 幂等补打

- PaperEditor / DocView 在 setContent 与 cards/annotations 变化后：`findEntityAnchors` vs 实体列表，缺 mark 且有 `anchorBlockIndex`+quote 的用 `locateQuote` 补打
- 编辑器会话会触发防抖保存落库；DocView 只改内存 doc
- locate 失败保持无锚；侧边栏「原文已删除」置灰，点击不高亮不跳转（PDF/带图摘录除外）

### 5. 一致性

- `transformPasted` 剥离粘贴内容里的 `annotationMark` / `cardAnchor`
- 保存前未做陌生 id 清理（按任务书「也可以只在渲染层忽略」）

未改 server / dto / DB，未 commit/push，未停 dev server。

## 测试

- 新增 `pm-doc.test.ts`、`entity-marks.test.ts`；重写 `pdf-pane/page-logic.test.ts`
- `upload-asset.test.ts` 空白判断改为 `isBlankPmDoc`

## 验收命令

```bash
pnpm typecheck                 # 全仓库绿
pnpm -F @inwit/web test        # 12 files / 98 tests passed
pnpm -F @inwit/web build       # 绿
pnpm -F @inwit/server test     # 36 files / 320 tests passed
```

浏览器（csi，localhost:5190，已登录）：

- 文档工作台列表可开
- 新建文档 → 编辑器输入「间隔重复是把复习间隔逐渐拉长的记忆方法。」→ 防抖 PUT `contentJson` 为 PM 段落 → 切预览 DocView 同源文渲染
- 旧库空 `contentJson` 文档（T2 无数据迁移）显示空态，卡片「原文已删除」——符合无锚规则
- chat 文档 `answer` 仍渲染；见下方契约缺口

## 遗留 / 契约缺口

1. **`answer` / `description` 仍是 markdown 字符串**（DTO 未改）。前端已不能 `parseMarkdownToPmJSON`，现用 `textToPmDoc` 按空行切段，粗体/标题等源语法会原样显示。若要恢复排版，需 T5 或后续把 answer 存 JSON，或单独保留展示层 markdown 解析。
2. **捕获框 / 粘贴建文档**不再把 `#` 列表等 markdown 编成对应节点，正文进单一/多段落。与 PLAN「系统内部无 markdown 往返」一致。
3. **T2 迁移后的旧文档**大量 `contentJson` 为空段落、`anchorBlockIndex = null`，侧栏会显示「原文已删除」。dev 数据可丢，不是本次回归。
4. **陌生 id 的 mark**只在 decoration 层忽略，保存时不会主动剥掉。
5. **T5**：编排验收与更完整的浏览器回归（划词打 mark、digest 后补打、PDF 页跳转）。

## 回归修复（Tauri 误入 web）

计划外的桌面端接线混进了 `@inwit/web`，`@tauri-apps/plugin-store` 未装导致 vite 无法 resolve `src/api/tauri.ts`，页面起不来。已彻底撤掉 web 上的 Tauri 依赖，T4 改动保留。

- 删除 `apps/web/src/api/tauri.ts`、`tauri.test.ts`
- `client.ts` / `auth.service.ts` / `auth.ts` / `vite-env.d.ts` 恢复为 git HEAD（`git diff HEAD` 为空；这些文件本无 T4 改动）
- `package.json` 去掉 `@tauri-apps/api`、`@tauri-apps/plugin-http`、`@tauri-apps/plugin-store`，并 `pnpm install --no-frozen-lockfile`
- 顺带：`screenshot.service.ts` 去掉对已删 `./tauri` 与 `@tauri-apps/*` 的引用（web 上 `available=false` 空实现）；主题页 `ScreenshotButton` 误用未定义 `topicId`，改为 `service.topic?.id`

验收：

```bash
curl -s --noproxy '*' http://localhost:5190/                 # 200，返回 index.html
curl -s --noproxy '*' http://localhost:5190/src/api/client.ts # 200，transform 为 cookie fetch，无 tauri
pnpm typecheck                 # 全仓库绿
pnpm -F @inwit/web test        # 12 files / 99 tests passed
pnpm -F @inwit/web build       # 绿
```
