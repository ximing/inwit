# T1 报告：`@inwit/doc-schema`

## 做了什么

新建共享包 `packages/doc-schema`（`@inwit/doc-schema`），工程结构对齐 `@inwit/dto` / `@inwit/markdown`：ESM、`types` 吃源码、`main/exports` 指向 `dist`。

Schema 元素（tiptap Extension，无 NodeView）：

- `PageBreak`（`pageBreak`，block atom，`pageIndex` 1-based）
- `AnnotationMark`（`annotationMark`，`annotationId`）
- `CardAnchorMark`（`cardAnchor`，`cardIds: string[]`，坏 JSON 解析为空数组）
- `Video`（`video`，block atom）
- `VitalEntity`（`vitalEntity`，attrs/parse/render 与 web 原 `VitalEntityNode` 一致）
- `getHeadlessSchema()`：StarterKit（heading 1–6、link `openOnClick:false` / `autolink:true`、默认 codeBlock）+ Table + TaskList/TaskItem(nested) + Image(inline，与 web 编辑器一致) + Subscript/Superscript + 上述节点/mark

纯函数（输入输出均为 PM JSON；位置计算走 `Node.fromJSON(getHeadlessSchema(), doc)`）：

- `blocksFromPmJSON` / `pmJsonToText` / `locateQuote` / `applyEntityAnchor` / `findEntityAnchors` / `stripEntityAnchors` / `thematicBreaksToPageBreaks`

测试：`packages/doc-schema/__tests__/doc-schema.test.ts`（11 个用例，无 DOM）。

Web 最小接线：

- `apps/web/package.json` 增加 `"@inwit/doc-schema": "workspace:*"`
- `createDocExtensions` 改用包内 `VitalEntity`，并加入 `PageBreak` / `AnnotationMark` / `CardAnchorMark`
- Image/Video 的 React NodeView 仍留在 `extensions.ts`

未改 server、DTO、DB；未 commit/push。

## 验收命令

```bash
pnpm -F @inwit/doc-schema test   # 1 file / 11 tests passed
pnpm typecheck                   # 5 packages 全部 Done（含 doc-schema / web / server）
pnpm -F @inwit/web build         # vite build 成功
```

`pnpm -F @inwit/web build` 依赖包的 `dist/`（exports 指向 `./dist/index.js`，与 dto/markdown 相同）。本机先跑了 `pnpm -F @inwit/doc-schema build` 再编 web。

## 遇到的问题

1. **lockfile**：新增 workspace 包后 `pnpm install` 因 frozen-lockfile 失败，改用 `pnpm install --no-frozen-lockfile` 写入 `pnpm-lock.yaml`。
2. **web 构建缺 dist**：未 build 包时 Vite 报 `Failed to resolve entry for package "@inwit/doc-schema"`。build 出 dist 后通过。
3. **Video attrs**：任务书写 `{src, mime}`，web 现有节点还有 `poster`。为与编辑器 JSON 对齐，headless `Video` 保留 `poster`。
4. **`@tiptap/pm`**：`@tiptap/core` 的 peer，已列入依赖；位置计算仍按任务书使用 `prosemirror-model` / `prosemirror-state`。
5. **`thematicBreaksToPageBreaks`** 只替换 top-level `{type:'thematicBreak'}`（任务书原文）。`@inwit/markdown` 当前产出的是 `horizontalRule`，导入链路的转换在后续任务处理。
