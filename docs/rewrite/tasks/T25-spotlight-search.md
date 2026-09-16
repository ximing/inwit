# T25 · 首页搜索改版：Spotlight 命令面板

先读 `docs/rewrite/CONTEXT.md`。沿用设计体系（纸张、朱红 accent、宋体点缀）。

## 用户反馈

> 首页搜索太难看了

现状：首页点搜索图标后捕获框被替换成一个粗描边大搜索框 + 下方大白卡结果列表，笨重。

## 任务（`apps/web/src/pages/today/`、`components/search/`）

### 首页搜索改为 Spotlight 式居中命令面板

- 触发：首页问候语旁的搜索图标、**⌘K**，都是打开一个**居中偏上的浮层面板**（Raycast/Spotlight 范式）：
  - 面板：页面宽度的 ~560–620px，置顶 18% 左右；圆角 14px，纸面底 + 柔和大阴影（深色模式用提亮一档的面板底）；背后 scrim 半透明压暗，点 scrim / Esc 关闭
  - 顶部输入行：大一号字号（16–17px）、左 lucide Search 图标、右 Esc hint chip；**无边框盒感**，输入行与结果区之间只有一条细分隔线
  - 结果区：紧凑行（40–44px 行高），左小图标（文档 FileText / 卡片 Layers）、主文字一行省略、右侧弱色 meta（topic / 所属文档）；分组小标题「文档」「卡片」克制灰字
  - **键盘导航**：↑↓ 移动、Enter 跳转、Esc 关闭；当前行高亮（accent 8% 底）
  - 鼠标 hover 同款高亮；空查询时显示引导（「搜索文档和卡片」+ ⌘K 提示）；无结果态一句话
  - 防抖/loading/错误重试沿用现有 search.service
- 首页的捕获框**不再被替换**，保持原位

### 文档页搜索保持现状（内联左栏），但视觉对齐

- 结果行的图标、行高、hover 与面板一致；搜索框去掉粗 focus 描边，改 1px 细边 + accent 20% 柔光

### 复用

- SearchResults 拆出统一的行组件供面板和左栏共用；⌘K 在首页现在改为打开面板（文档页保持聚焦内联框）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 实机：首页 ⌘K/图标开面板、键盘 ↑↓+Enter 跳转、Esc 关闭；docs 内联搜索回归不破
- 浅色/深色目检（面板浮层在两态都精致）
- 不启动/停止 dev server / worker / s3rver
