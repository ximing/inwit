# T3 · 前端：设计系统 + 应用骨架 + 路由收敛

先读 `docs/rewrite/CONTEXT.md`，再通读 `docs/design/v2/inwit.css` 和 `docs/design/v2/today.html`（rail 导航结构）。

## 任务

### 1. 设计系统落地

- `apps/web/src/styles.css` **全量重写**：把 `docs/design/v2/inwit.css` 的 design tokens（CSS 变量、.shell/.rail/.nav-item/.btn/.chip/.tag/.capture/.prose/.paper 等）搬进来
- 保留并适配**深色模式**：现有项目用 `data-theme` 或 class 切换（先看现有实现），为暗色补齐一套 token 值（墨黑纸张感：bg #1c1915 系、surface #26221c 系、accent 稍亮）。mockup 没给暗色稿，你按"灯下夜读"的感觉配，保持对比度可读
- 删除所有旧页面私有 class（page-home、doc-card、capture-bar 等旧名）——后续任务会按新 class 重写各页面；本任务里旧页面允许暂时变丑，但不能编译报错
- 图标：`pnpm -F @inwit/web add lucide-react`

### 2. Layout（rail 导航）

重写 `apps/web/src` 的 Layout 组件（找到现有 Layout）：

- 左侧 224px rail：brand（Inwit + 扔进去，它来消化）、6 个导航项（首页 `/`、文档 `/docs`、复习 `/review`、主题 `/topics`、任务 `/jobs`、设置 `/settings`）、底部用户区（头像首字母 + 邮箱 + 深浅色切换 + 退出）
- 图标（lucide-react）：Home、FileText、Repeat、Tags、Activity、Settings
- 当前路由高亮（is-on 样式，含左侧 accent 竖条）
- 复习项带 badge：今日待复习数（调 `GET /api/review/today` 或已有 stats 接口取 count，Layout 里轻量轮询或挂载时取一次；为 0 不显示）
- 深浅色切换、退出登录功能保留现有逻辑，只换皮

### 3. 路由收敛

`apps/web/src/App.tsx`：

- `/` → Today 首页（本任务先建空壳 `pages/today/index.tsx`：rail 内居中文案"首页（T4 实现）"占位，下同）
- `/docs` → 文档工作台（`pages/docs/`，T5 实现）
- `/review` → 复习中心（T6 实现）
- `/topics` → 主题（现有页面先挂载，T7 换皮）
- `/jobs` → 任务（`pages/jobs/`，T7 实现）
- `/settings` → 设置（现有页面，T7 换皮）
- 旧路由 301：`/doc/:id` → `/docs?doc=:id`，`/editor/:id` → `/docs?doc=:id&edit=1`，`/card/:id` → `/review`，`/captures`、`/admin` → `/jobs`
- `src/routes.ts` 同步更新 ROUTES 常量与 helper（docPath、editorPath 等改为生成新路径），删除死代码
- 旧页面目录 `pages/home` `pages/doc` `pages/editor` `pages/card` `pages/admin` 在本任务**保留但不再挂载**（后续任务会复用其中的 service 逻辑/删除），确保 typecheck 过即可，可以顺手修 import 但不要求美观

### 4. 全局小组件

按 mockup 实现可复用组件放 `apps/web/src/components/`：按钮变体（btn-primary/secondary/ghost）、chip、tag、空态 empty、page-head。现有 `doc-row.tsx`、`Markdown.tsx` 保留（T5 会用）。

## 验收

- `pnpm typecheck` 通过、`pnpm -F @inwit/web build` 通过
- 浏览器访问 `/` `/docs` `/review` `/topics` `/jobs` `/settings` 都有 rail 骨架 + 对应占位/旧页面内容；旧路由跳转重定向正确
- 深色模式切换不炸
