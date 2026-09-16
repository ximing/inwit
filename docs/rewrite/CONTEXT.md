# Inwit UI/UX 大重构 — 共享上下文（每个任务必读）

## 你要做什么

这是一次产品级 UI/UX 重构 + 功能迭代。**设计稿是唯一视觉真相来源**：

- `docs/design/v2/today.html` — 首页（Today）
- `docs/design/v2/docs.html` — 文档工作台（左列表 + 右阅读/编辑同 pane）
- `docs/design/v2/review.html` — 复习中心（Hub 统计 + SM-2 设置 + 翻卡 Session）
- `docs/design/v2/jobs.html` — 任务与用量
- `docs/design/v2/topics.html` — 主题
- `docs/design/v2/settings.html` — 设置
- `docs/design/v2/inwit.css` — 共享 design tokens（CSS 变量、按钮、chip、tag、prose 等）

开始前先完整阅读与你任务相关的 HTML/CSS 稿子，照稿实现（结构、文案、间距、颜色），不要自由发挥视觉。

## 仓库事实

- pnpm monorepo：`apps/server`（Fastify + drizzle + Postgres）、`apps/web`（React 19 + @rabjs/react 响应式 Service 模式 + react-router）、`packages/dto`（zod schema 共享类型）
- 前端状态模式：`bindServices` + `observer` + `useService`，每页一个 `*.service.ts`（参考现有 `apps/web/src/pages/today/today.service.ts`）
- 现有编辑器已经是 **tiptap**（`apps/web/src/pages/editor/paper-editor.tsx`），不是 textarea
- API 风格：Fastify 路由注册在 `apps/server/src/**/*.routes.ts`，统一 `app.authenticate`；service 层在 `*.service.ts`；表结构在 `apps/server/src/db/schema.ts`；migration 用 `pnpm -F @inwit/server migrate:generate` 生成 + `pnpm -F @inwit/server migrate` 执行（远程 PG，.env 已配好，可直接跑）
- DTO 变更要同步 `packages/dto/src/*.ts`（zod schema + 导出）
- 图标统一用 **lucide-react**（如未安装：`pnpm -F @inwit/web add lucide-react`）
- 文案全部是中文，语气参考现有产品文案（克制、书面、不卖萌）

## 验收命令（你的任务完成前必须全部通过）

```bash
cd /Users/ximing/project/mygithub/inwit
pnpm typecheck          # 全仓库 tsc
pnpm -F @inwit/server test   # 后端 vitest（如果改了后端）
pnpm -F @inwit/web build     # 前端构建（如果改了前端）
```

## 纪律

- 只做任务书范围内的事，不顺手重构无关代码
- 不 git commit、不 git push
- 不启动/停止 dev server（已有 vite:5190 + server:3020 在跑，热更新会自动生效）
- 改 DB schema 必须走 drizzle migration，不手改数据库
- 遇到 mockup 与现有功能冲突时，以"不丢失现有功能"为准，视觉以 mockup 为准
