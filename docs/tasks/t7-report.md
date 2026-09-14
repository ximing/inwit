# T7 Web 前端（捕捉对话框 + 复习刷卡 + 线程切换）简报

## 做了什么

在 `apps/web` 用 Vite + React 19 + `@rabjs/react` 落地 V0 主界面。全部请求走 Vite `/api` 代理（`localhost:3020`），认证用 httpOnly cookie，前端不碰 token。

### 状态管理

- 全局：`register(AppService)`、`register(AuthService)`，入口 `resolve(AuthService)` 立即 `GET /api/auth/me`
- 页面级：`bindServices` + `observer` + `useService`
  - `LoginService` / `CaptureService` / `ReviewService` / `ThreadsService` / `SettingsService`
- 未登录：`RequireAuth` 跳 `/login`（带回跳 `from`）；已登录访问 `/login` 进主页

### 页面

| 路径 | 页面 | 行为 |
|---|---|---|
| `/login` | 登录 / 注册 | 邮箱 + 密码（≥8），成功进主页 |
| `/` | 捕捉（对话框） | 顶部线程切换：全部 / 各线程 / +新建（标题+可选目标）。时间线每条 capture 显示 消化中… / 已消化出 N 张卡 / 失败；pending 每 3s `GET /api/captures/:id` 直到 digested 后展开 concept / 例子 / 易混点 / 标签。底部粘贴框，⌘↩ 或 Ctrl+Enter → `POST /api/captures`（当前线程带 `threadId`） |
| `/review` | 复习 | `GET /api/review/today`，进度 已刷/总数。先问题（第一道题或 concept）→ 点击/空格翻面 → 忘了 / 模糊 / 想起来了 → `POST /api/review/:cardId/feedback` 自动下一张。刷完展示近 7 天统计 |
| `/threads` | 线程 | 标题 / 目标 / 卡片数 / 捕捉数 / 创建时间；归档 / 取消归档 |
| `/settings` | 设置 | BYOK 列表 / 新增 / 删除 / 设默认 / 测试连通；`apiKeyPreview` 掩码（如 `sk-tes****`） |
| `/admin` | 后台占位 | 留给后续任务 |

路由常量在 `apps/web/src/routes.ts` 的 `ROUTES` / `PAGE_LIST`，`App.tsx` 只引用这些常量。模块加载时断言 `/login` `/review` `/threads` `/settings` 都在 `PAGE_LIST` 里。

UI：手写 CSS，中文界面。海军侧栏 + 冷灰纸面 + 灯色主按钮。

## 启动方式

仓库根目录：

```bash
pnpm --filter @inwit/server dev    # :3020
pnpm --filter @inwit/web dev       # :5190，/api → 3020
# 消化捕捉需要 worker，否则消息会停在「消化中…」
pnpm --filter @inwit/server worker
```

或 `pnpm dev` 同时起 server + web。浏览器打开 http://localhost:5190 。

生产预览：`pnpm --filter @inwit/web build && pnpm --filter @inwit/web preview`（同样 :5190）。

## 验收输出摘要

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | 全绿（dto / server / web） |
| `pnpm -r build` | 全绿（web vite 109 modules） |
| `curl -s localhost:5190` | 200，`text/html`，含 `<div id="root">` |
| `curl -s localhost:3020/health` | `{"ok":true}` |
| Vite 代理 `GET /api/auth/me`（无 cookie） | 401 `INVALID_TOKEN` |
| SPA 路径 `/login` `/review` `/threads` `/settings` | 均 200 `text/html` |
| 产物 `dist/assets/*.js` | 含 `/login` `/review` `/threads` `/settings` |

浏览器实走：注册 → 主页；新建线程；粘贴文本扔进去 →「消化中…」→ worker 切卡后「已消化出 2 张卡」并展开卡片；复习翻面 + 三档反馈 + 完成态；线程归档；设置新增后密钥掩码；退出后访问 `/review` 被守卫打回 `/login`。

验收期间临时拉起的 server / web / worker 已停止，避免占用 3020 / 5190。

## 遗留

- 后台看板仍是占位（T8）。
- 线程卡片数按该线程前 20 条捕捉的详情汇总，不是服务端聚合字段。
- 抽认卡正面直接展示题目原文（含 Agent 的 `{{c1::…}}` cloze 语法），未做填空渲染。
