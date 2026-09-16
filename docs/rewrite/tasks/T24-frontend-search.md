# T24 · 前端：首页与文档页搜索（共用组件）

先读 `docs/rewrite/CONTEXT.md`。T23 已提供 `GET /api/search?q=` → `{ documents: DocumentListItem[], cards: Card[] }`（双路召回+RRF+rerank，带降级）。

## 任务

### 1. 共享搜索组件（`apps/web/src/components/search/`）

- `SearchBox`：搜索输入框（lucide `Search` 左图标、Esc/✕ 清空、300ms 防抖、loading 态），风格融入设计体系（纸张底、克制边框、focus accent 柔光）
- `SearchResults`：分组列表——**文档**组（docDisplayTitle + description 一行 + topic tag，点击跳 `/docs?doc=<id>`）和**卡片**组（concept 两行截断 + 所属文档名，点击跳 `/docs?doc=<documentId>` 并高亮该卡——复用现有 activeCardId 联动）；组标题克制小字；无结果态「没有搜到，换个说法试试」；错误态可重试
- `api/search.ts` 封装

### 2. 文档页（/docs 左栏）

- 主题筛选 chips 上方放 SearchBox
- 搜索中：文档流替换为 SearchResults（左栏宽度内单列）；清空/esc 恢复文档流
- 卡片结果的「高亮该卡」：跳过去后右 pane 打开该文档 + 右侧卡片栏对应卡片高亮（现有联动机制接上）

### 3. 首页（/）

- 捕获框上方或右上方放一个搜索入口：点 lucide 搜索图标，捕获框**就地切换**为 SearchBox（同一位置、同一尺寸节奏，切换有过渡）；有结果时下方就地显示 SearchResults；Esc/清空切回捕获框
- 这样首页维持单一 hero 区域，不多长一块

### 4. 快捷键

- `Cmd/Ctrl+K`：在 / 和 /docs 聚焦搜索框；其它页面按下跳 /docs 并聚焦
- 输入框右端放 `⌘K` hint 小字

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 实机流程：/docs 搜索命中文档与卡片、点击跳转+卡片高亮；/ 搜索入口切换、结果跳转；⌘K 生效
- 浅色/深色目检
- 不启动/停止 dev server / worker / s3rver
