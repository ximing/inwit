# T13 · 视觉打磨：文档工作台 + 左侧导航

先读 `docs/rewrite/CONTEXT.md`，再读 `docs/design/v2/docs.html` 与 `docs/design/v2/inwit.css`。这次是**在现有设计体系内的精修**，沿用 paper 配色 / 宋体阅读 / 朱红 accent，不引入新风格。用户原话反馈（要逐条解决）：

> 1. 文档 tab 下：主题标签和背景太接近；右侧文档部分样式不高级、很奇怪；划线的 toolbar 难看；默认一直展示的 toolbar 难看；大屏空白区域太多；左侧 input 扔进去排版不好看
> 2. 左侧导航下方的头像、主题切换、退出的展示和排版不好

## 任务（`apps/web/src/pages/docs/`、`apps/web/src/shell/Layout.tsx`、`apps/web/src/styles.css`）

### 1. 文档行的主题标签（docs 左栏 + 其他处的 topic chip）

- 现在 chip 底色与卡片背景几乎无差别。给 topic chip 一个**有辨识度的克制底色**：墨绿/朱红 6-8% 透明度底 + 深一档文字色（参考 inwit.css 里 tag 的设计但拉开对比），hover 微加深。深色模式同步调。

### 2. 右侧阅读/编辑 pane 高级感 + 大屏利用率

- `.paper` 阅读列加宽（现在太窄，大屏两侧大片空白）：阅读列 max-width 提到 ~760–820px，整体 pane 内边距适配 ≥1600px 屏
- 标题排版：更大字号/更紧行距/字重层级（宋体 600+），meta 行收紧为一行精致小字（dot 分隔）
- chrome 条（✕ 关闭 / 编辑按钮）：做成 sticky 顶部、滚动时带细微底部分隔线，按钮用 ghost 样式
- 本文卡片区：卡片 mini-grid 增加 hover 浮起（translateY -1px + 阴影），掌握度格子做得更精致（圆角小条）
- 空态：居中引导文案排版优化（图标 + 主文案 + 副文案间距节奏）

### 3. 划线浮出 toolbar（选中文本后的弹出条）与编辑态常驻 toolbar

- 划线 popup：重做成**深色浮动胶囊**（深墨底 #2a251f、白字、圆角 10px、柔和阴影、6px 小箭头），按钮 icon 化（lucide），参考 Notion/Readwise 的 selection toolbar 质感
- 编辑态 formatting toolbar：不要一直挂在顶上占一条。改成**选中文字才浮现的浮动 toolbar**（与划线 popup 同一视觉组件，深色胶囊）；tiptap 有 BubbleMenu 可直接用（`@tiptap/react` 的 BubbleMenu，若版本不支持则自己监听 selection 定位）。加粗/斜体/划线/标题/列表/代码/链接功能不变
- 编辑态顶部只保留：关闭、topic 选择、保存状态、完成

### 4. 左栏捕获框排版

- textarea 与底部操作行对齐：主题选择 chip 左、操作按钮右（问 AI ghost、扔进去 primary），间距统一 8/12px 节奏；focus 时边框用 accent 30% 而不是生硬实色；整体 padding 收紧

### 5. 左侧导航底部（`shell/Layout.tsx`）

- 重排为**用户卡片**：一行 = 圆形头像（首字母，accent 底）+ 邮箱（一行省略）；其下一行 = 两个图标按钮（主题切换 Sun/Moon、退出 LogOut，lucide，ghost 小按钮）；与导航列表之间加细分隔线；整块 padding 与上方 nav 对齐
- 深色模式同样好看

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 逐项目检（浅色+深色）：topic chip 有辨识度；阅读 pane 在大屏不空；两个 toolbar 都是深色浮动胶囊；捕获框对齐；导航底部用户卡片整齐
- 不启动/停止 dev server / worker
