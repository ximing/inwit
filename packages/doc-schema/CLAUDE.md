# `packages/doc-schema` 文档模型指令

## 这个目录负责什么

- 跨端（`apps/server`、`apps/web`、`packages/doc-engine`）共享的 ProseMirror / Tiptap 文档 Schema、自定义扩展节点/Mark 与锚点定位算法。

## 放置约束

- `src/schema/` — Tiptap / ProseMirror 节点与 Mark 扩展（如 `card-anchor-mark.ts`、`annotation-mark.ts`、`math.ts`、`mermaid-block.ts`、`table-cell.ts`、`headless.ts`）以及浏览器端 NodeView（`*-view.ts`）。
- `src/anchors.ts`、`src/locate.ts`、`src/blocks.ts` — 实体锚点注入/剥离、引文在文档中的块级定位、ProseMirror JSON 转纯文本或块列表等纯函数。
- `__tests__/` — Schema 序列化、粘贴 Markdown、数学公式、表格与锚点定位的单元测试。
- **不放什么**：不耦合具体业务页面的 Service、网络请求或存储签名逻辑。

## 开发偏好与架构约束

- **无头与浏览器兼容**：`src/schema/headless.ts` 需在 Node 环境（如 `apps/server` 消化与导出管线）下无 DOM 安全运行；依赖浏览器 DOM 的 NodeView（如 `code-block-view`、`mermaid-block-view`、`image-view`）通过独立子路径导出，避免污染服务端导入。
- **构建与验证**：Server 运行时读取 `dist/`，修改后需运行 `pnpm --filter @inwit/doc-schema test` 与 `pnpm --filter @inwit/doc-schema build`。
