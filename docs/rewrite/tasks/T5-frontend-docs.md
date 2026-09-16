# T5 · 前端：文档工作台（/docs）

先读 `docs/rewrite/CONTEXT.md`，再完整读 `docs/design/v2/docs.html`（结构+文案的唯一真相）和 `docs/design/v2/inwit.css`。T3 已搭好骨架与设计 tokens。

## 背景

这是改动最大的一页：**文档列表、阅读、编辑合并为一个工作台**，消灭旧 `/doc/:id` `/editor/:id` 路由。左栏 = 捕获框 + 主题筛选 + 文档流；右 pane = 空态 / 阅读态 / 编辑态（同 pane 就地切换）。URL 同步：`/docs?doc=<id>`、`/docs?doc=<id>&edit=1`，可刷新可分享可后退。

现有可复用资产：`pages/doc/doc.service.ts`（加载、轮询 digest 状态、卡片 drawer、anchor 高亮）、`pages/editor/editor.service.ts` + `paper-editor.tsx`（tiptap 编辑器 + 自动保存）、`pages/today/today.service.ts`（capture + 最近文档 + 主题选择）、`components/doc-row.tsx`、`lib/Markdown.tsx`（AnchoredMarkdown 划线锚点）。本任务完成后删除 `pages/doc`、`pages/editor`、`pages/card`。

## 任务（`apps/web/src/pages/docs/`）

### 左栏（384px，独立滚动）

1. 捕获框（紧凑版，稿子里 .ws-capture）：逻辑同 T4 的捕获（主题选择、扔进去、问 AI）
2. 主题筛选 chips：全部 / 各主题 / ＋主题（复用现有逻辑）
3. 文档流（.row 紧凑行：标题一行省略 + meta：topic tag、N卡、相对时间；digest pending 的显示"消化中"脉冲 tag；AI 复盘/AI 回答显示对应 tag）
4. 无限加载（沿用现有 load more 逻辑，改为滚动到底自动加载或保留按钮）
5. 当前选中文档行高亮 is-on

### 右 pane

**空态**（未选文档）：稿子里的引导文案（✎ + "从左边选一篇，或者直接扔一句话"）。

**阅读态**：
- chrome：✕ 关闭（回空态、清 URL 参数）、右侧"编辑"按钮
- 标题 + meta（topic 选择器可换主题、相对时间、N 张卡、digest 状态）
- .paper 阅读区：复用 AnchoredMarkdown；chat 来源文档显示 AI 回答块（稿子 .doc-answer，现有 doc 页有此逻辑）；linkHint 保留
- 划线（mark）点击 → 下方对应卡片展开并高亮（替代旧的 drawer；保留 Esc/点外部取消高亮）
- **本文卡片区**（.doc-cards）：卡片 mini-grid，问题 2 行截断、点击展开答案、掌握度 mastery 条（按 intervalDays 映射 1-4 格：<3 天 1 格、<7 2 格、<21 3 格、≥21 4 格）、下次复习文案（明天再见/N 天后再问）、"去复习 →"链 /review
- digest pending 时保留现有轮询，完成后自动刷新出卡片

**编辑态**（点"编辑"或 URL 带 edit=1）：
- 同 pane 切换：标题变无边框大输入框、悬浮工具条（稿子 .toolbar：B I S H 列表 代码 链接）、内容区为**现有 tiptap paper-editor 原样嵌入**（功能不变：自动保存、保存状态指示）
- chrome：✕ 关闭、topic 选择器、保存状态（已保存 · HH:mm / 保存中…）、右侧"完成"回阅读态
- 自动保存逻辑完全复用现有 editor.service

### URL 与导航

- 选文档 → `?doc=id`；编辑 → 加 `&edit=1`；关闭 → 清参数；浏览器前进后退行为正确
- 从首页/周报等入口带参进来直接打开对应状态

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 与 docs.html 视觉一致；阅读/编辑就地切换无路由跳转
- 编辑自动保存真实生效（刷新后内容在）；划线-卡片联动可用；digest pending 轮询可用
- 旧 pages/doc、pages/editor、pages/card 已删除，路由 `/doc/:id`、`/editor/:id` 重定向到 /docs 生效
