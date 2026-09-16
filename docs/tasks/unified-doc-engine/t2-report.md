# T2 报告：数据层改造 — DTO + DB migration + server contentJson 化

## 做了什么

文档内部存储从 markdown 文本切到 ProseMirror JSON。markdown 只留在导入/OCR/agent 写库边界，经 `parseMarkdownToPmJSON` → `horizontalRule` 映射为 `thematicBreak` → `thematicBreaksToPageBreaks` 后落库。

### DTO（`packages/dto`）

- `documentSchema` / create / update：`contentMd` → `contentJson`（`z.object({ type: z.literal('doc') }).passthrough()`）
- 删除 `PDF_PAGE_SEPARATOR`；`titleFromContent` → `titleFromDoc`（`blocksFromPmJSON` 取首个非空块，去 `#`、40 字、未命名文档）
- `cardSchema.anchorBlock` → `anchorBlockIndex: number | null`；create 输入为 optional positive int
- 删除 `pageIndexToAnchorBlock`；`excerptCardInputFromAnnotation` 不再写锚（`anchorText` 仍用 `IMAGE_EXCERPT_QUOTE`）
- `annotationSchema` 增加 `anchorBlockIndex`；text 标注可选，pdf/media 的 superRefine 禁止
- `createSelectionCardsInputSchema` 增加必填 `blockIndex`；selection job payload 可选携带
- dto 增加 `"@inwit/doc-schema": "workspace:*"`

### DB（drizzle，dev 数据直接 drop/alter）

- `documents.content_md` → `content_json jsonb NOT NULL`，默认空 doc `{"type":"doc","content":[{"type":"paragraph"}]}`
- `cards.anchor_block` 删除，新增 `anchor_block_index integer`
- `annotations` 新增 `anchor_block_index integer`

Migration 文件：`apps/server/drizzle/0018_lonely_hairball.sql`（已对远程 dev PG 执行成功）。

### Server 存取

- `toPublicDocument` / create / update / chat / import / extract / OCR / maps fill / weekly / analyze / topic fill：读写 `contentJson`
- chat 问题 → `textToParagraphDoc`（单段落）；空白判断改 `pmJsonToText`（空 doc / 全空白 / ZWSP = blank）
- 检索：`IndexableDocument.contentJson`；embedding 文本由 `pmJsonToText` 现算；payload/meili 键 `content_md` → `content_text`
- `doc-meta` clip/判短输入改为 `pmJsonToText` 产物
- PG ILIKE 回退搜 `content_json::text`；admin preview 用派生文本
- digest / selection **prompt 与 tool 契约未改**（T3）：读文档时用 `pmJsonToText` 喂旧 `contentMd`/`splitMarkdownBlocks`/`resolveAnchor`，写卡改为 `anchorBlockIndex`

接线测试：`apps/server/src/documents/content-json.test.ts`（markdown `---` → 编号 `pageBreak`）。

未改 `apps/web`，未 commit/push。

## 验收命令

```bash
pnpm -F @inwit/server typecheck     # 绿
pnpm -F @inwit/dto typecheck        # 绿
pnpm -F @inwit/doc-schema typecheck # 绿
pnpm -F @inwit/server test          # 35 files / 321 tests passed
pnpm -F @inwit/server migrate       # 0018_lonely_hairball 已应用到远程 dev PG
```

`pnpm typecheck` 全仓库失败：`@inwit/web` 约 30 处 `contentMd` / `anchorBlock` / `PDF_PAGE_SEPARATOR` / `pageIndexToAnchorBlock` / 缺 `blockIndex`，属预期，T4 修。

## 遗留

1. **T3**：digest/selection（以及 chat/evolve 写锚）改为 `(blockIndex, quote)` + `locateQuote`；删 `anchors.ts` 降级链；prompt/`write_cards` 契约改造。
2. **T4**：web 编辑器/DocView/划词/补打 mark 全面吃 `contentJson`。
3. **检索旧索引**：已写入 Qdrant/Meili 的文档仍可能带 `content_md` 键；代码只读 `content_text`。dev 数据可丢，需要的话跑 `backfill:search`。
4. **`@inwit/markdown`** 把 mdast `thematicBreak` 编成 PM `horizontalRule`。server 接线层先映射再调用 `thematicBreaksToPageBreaks`，未改 doc-schema。
5. drizzle-kit generate 在无 TTY 下会问「create or rename」。本次选 create（drop + add），与「不写数据迁移」一致。
