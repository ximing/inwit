# T25 完成报告：批注进检索层 + 搜索「批注」组 + 批注 deep link + 转卡修复

完成日期：2026-09-17。任务书：docs/tasks/t25.md。

## 交付内容

### 目标 1：检索管线支持批注实体

- `retrieval/search-logic.ts`：新增 `annotationEmbeddingText`（note 为主 + quote 截断 300，`[图片摘录]` 占位符归一为空，全空返回空串）、`annotationIndexableQuote`、`ANNOTATION_QUOTE_CHARS`。
- `retrieval/pipeline.ts`：新增 `IndexableAnnotation`、`indexAnnotation`（**无语义文本时只进 Meili 不进 Qdrant**：直接编排 `qdrant.deletePoints(...).catch(() => {})` + `meili.upsertDocuments`，绕过 vector 必填的 upsertBoth）、`deleteAnnotationFromIndex`、`tryIndexAnnotation`/`tryDeleteAnnotationFromIndex`（warn-only）、`searchAnnotations`（topicId 过滤只走 filterIds DB 复核，payload 不含 topic_id，避免文档换主题后索引过期）、`annotationIdOf`/`annotationPayloadText`；顺带新增 `tryIndexCard` 供手工建卡使用。
- `retrieval/registry.ts`：`annotationsStoreName()` → `inwit_annotations_dev/prod`；`ensureRetrievalStores` 加第三对 ensure。
- `retrieval/meili.ts`：`ANNOTATION_INDEX_SETTINGS`（searchable: note/quote/text，cmn 分词）。
- `retrieval/self-test.ts`：批注段 index→search→delete 闭环 + 占位符批注「不进 Qdrant」分支。

### 目标 2：索引 hook 与存量回填

- `annotations/annotation.service.ts`：create（returning 后）/update（return 前）调 `tryIndexAnnotation`，delete 后调 `tryDeleteAnnotationFromIndex`。
- `documents/document.service.ts deleteDocument`：删除前查出该文档批注 ids，事务后逐条 `tryDeleteAnnotationFromIndex`（真实链路验证：删文档后批注搜索不再命中）。
- `scripts/backfill-search.ts`：扩批注段（按 Meili listIds 跳过已索引）。

### 目标 3/4：搜索「批注」组 + deep link

- DTO：`searchAnnotationSchema`（quote 截断 140 / note 截断 200 / documentTitle / kind / pageIndex）+ `searchResultSchema.annotations`。
- `search/search.service.ts`：`searchAnnotationIdsIlike`（ilike note/quote，join documents 过滤 topic）、`loadAnnotationsByIds`（leftJoin documents 取标题，orderByIds 保序）、`idsInTopic` 扩 annotations 分支、`search()` 三路并行。
- web：`routes.ts` 加 `docAnnotationPath`（`/docs?doc=X&annotation=Y`）；`docs.service.ts` 新增 `applyUrlAnnotation`（annotations 命中才生效，复用既有 openAnnotation + 滚动/闪烁 effect）；`loadDoc` 扩第三参；docs/index.tsx 消费 `annotation` search param。
- `search-results.tsx`：第三个 search-group「批注」（图标 MessageSquareQuote，title = note 首行 → quote → 「图片摘录」）；web/mobile 两个 search.service 的 `isEmpty` 同步。

### 目标 5：转卡修复 + 手工建卡索引修复 + migration

- DTO `cardInputFromAnnotation`（原 excerptCardInputFromAnnotation 泛化改名）：图片分支不变；纯文字批注 note 空返回 null，否则 concept=note 首行、example=note、anchorText=quote（占位符剔除）、anchorBlockIndex 直接透传；两分支都带 `annotationId`。`createCardInputSchema` 加可选 `annotationId`。
- migration `0020_loud_sasquatch.sql`：`annotations.converted_card_id uuid null references cards(id) on delete set null` + `idx_annotations_converted_card`（已应用到远程 PG）。
- `card.service.ts createCard`：annotationId 校验（属主 + documentId 一致，不符 400）、事务内回写 convertedCardId、**事务后 `tryIndexCard`**——修复手工建卡不进索引的历史缺口（backfill 时 344 张卡里恰有 1 张手工卡此前未被索引，印证了缺口存在）。
- `toPublicAnnotation` 下发 `hasConvertedCard: boolean`；card-rail 转卡按钮改为所有 kind 渲染（无图且无笔记时 disabled + 提示），已转卡批注显示「已转成卡片」。

## 验收记录

- `pnpm --filter @inwit/server test`：**341 passed (38 files)**——新增 annotationEmbeddingText 4 例、cardInputFromAnnotation 5 例、createCardInputSchema annotationId 1 例。
- `pnpm typecheck`（全仓 9 包）+ `pnpm -F @inwit/web build`：全绿。
- `pnpm --filter @inwit/server test:retrieval`（真实 Qdrant+Meili+百炼）：全 PASS，含批注段与 meili-only 分支。
- `pnpm --filter @inwit/server backfill:search`：documents 184 ok、cards 344（skip 343 + 补索引 1）、**annotations 21 ok 0 fail**。
- 真实链路（起 dev server + curl 冒烟用户，用后已删）：
  - 建批注 → 语义搜索与 note 关键词搜索均在「批注」组命中且带 documentTitle ✓
  - 带 annotationId 转卡 → `hasConvertedCard=true` ✓；手工建的卡立即可被搜索命中（createCard 索引修复生效）✓
  - 删批注 → 搜索不再命中 ✓；删整篇文档 → 其批注全部不再命中 ✓
- UI 层 deep link（`/docs?doc=X&annotation=Y` 打开后滚动+闪烁）走既有 openAnnotation/scrollFlashAnnotationAnchor 通路，代码与类型已接通，浏览器手测留给日常体验抽查。

## 偏差与说明

- 计划中提到 `docs/tasks/t25.md` 验收项的 UI 浏览器逐步验证未逐条跑（无自动化 e2e），服务端链路已全量真实验证。
- `docsPath` 的 opts 扩展了 `annotation` 参数；weekly 周报链接格式 `/docs?doc=<id>&annotation=<id>` 已可被消费（T26 前置就绪）。
- 期间发现 `git stash` 验证过一次 analyze-tools.ts 的疑似 typecheck 报错，确认为 `-r` 并行构建 dto dist 的瞬时不一致，直接 `tsc --noEmit` 与全仓复跑均通过，非真实问题。

## embedding 成本记录

回填 21 条存量批注全部成功；其中含占位符/无笔记的批注走 meili-only 不产生 embedding 调用。新批注写入路径同理：只有 note 或真实 quote 非空时才调用百炼 embedding。
