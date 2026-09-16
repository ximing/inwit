# T14 · 主题页重构：三栏工作台 + 详情重设计

先读 `docs/rewrite/CONTEXT.md`，再读 `docs/design/v2/topics.html`、`docs/design/v2/docs.html`（三栏工作台范式）与 `docs/design/v2/inwit.css`。T13 刚打磨过 docs 工作台与导航，沿用其组件与样式约定。

用户原话：

> 主题进入详情页后也很难看，几乎可以说没有设计。主题也可以变成三栏布局，减少一次跳转，然后重新设计下主题详情页。

## 现状

- `pages/topics/index.tsx`（主题卡片网格列表）+ `pages/topics/detail.tsx`（`/topics/:id` 详情，含 MapTab/FeedTab/NodeDrawer）+ 两个 service
- 交互：列表 → 点卡片 → 跳详情页（一次路由跳转，返回再跳回来）

## 目标布局（与 /docs 工作台同范式）

```
[app 导航 rail] [主题列表栏 320–360px] [主题详情 pane（自适应）]
```

- URL：`/topics?topic=<id>` 选中态，可刷新可后退；空态 = 未选主题
- 旧路由 `/topics/:id` → 301 重定向 `/topics?topic=<id>`

## 任务

### 左栏：主题列表

- 每行一个主题（紧凑行，非大卡片）：名称一行省略、学习目标一行省略（斜体弱色）、底部 meta：N 卡 · M 篇文档 + 掌握度细进度条
- 选中行高亮（同 docs 工作台的 is-on 行）
- 顶部：「＋ 新建主题」按钮（点击直接在列表顶部出现输入行，回车创建并选中）
- 底部：「已归档 · N」折叠区，展开显示归档主题行（可选中查看，详情 pane 里可取消归档）

### 右 pane：主题详情（重设计）

**空态**：引导文案（参考 docs 空态风格）。

**详情态**：

1. **头部**：主题名（宋体大字，可点击进入行内编辑）；学习目标一行（未填写时显示引导占位"一句话锚定这个专题的消化方式"，点击行内编辑保存——现有 API 已支持）；右上「…」菜单（归档/取消归档、删除）
2. **统计条**：N 张卡 · M 篇文档 · 掌握度 X%（进度条或环形，精致小件）· 最近消化时间
3. **分节 tab**（就地切换，不跳路由）：
   - **文档**：该主题下文档流（复用 docs 工作台的行样式：标题 + meta + 消化中脉冲 tag），点击 → 跳 `/docs?doc=<id>`（这是允许的跨页，因为是换工作台）；流顶部一个迷你捕获框（扔内容进这个主题，逻辑同 docs 捕获但 topic 固定）
   - **图谱**：现有 MapTab 内容原样搬入（含 NodeDrawer 交互），视觉与 pane 适配
   - **动态**：现有 FeedTab 内容搬入
4. 归档主题：头部显示「已归档」tag，捕获框禁用

### 实现

- `pages/topics/index.tsx` 改为工作台布局；`detail.tsx` 的内容组件拆入并按 tab 复用；两个 service 合并/调整为 `topics.service.ts`（列表+选中+详情）
- 路由：`/topics/:id` 重定向逻辑加进 routes 配置（参考 /doc/:id 的做法）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 三栏无跳转切换主题；新建/归档/取消归档/删除可用；图谱与动态 tab 功能不丢；URL 同步正确
- 浅色/深色模式都目检
- 不启动/停止 dev server / worker
