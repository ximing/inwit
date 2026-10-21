# `apps/web` 前端指令

## 这个目录负责什么

- Inwit Web 客户端（Vite + React 19 + `@rabjs/react` + react-router + Tiptap + EmbedPDF）。
- 本地开发运行在 `:5190`（`/api` 代理至 `:3020`）；生产构建产物由服务端托管，同时作为 Tauri 桌面壳加载的远端站点。

## 放置约束

- `src/pages/<page>/` — 页面级视图组件、页面专属 `*.service.ts`、子组件及就近样式（如 `pages/docs/` 下的富文本编辑器 `paper-editor.tsx`、思维导图画布、PDF 阅读器 `pdf-pane/`）。
- `src/features/` — 跨页面复用的完整业务特性模块（如 `concepts/`、`study-workspace/`）。
- `src/components/` — 跨页面共享的通用组件与对应样式，不耦合单一页面的私有状态。
- `src/services/` — 全局单例或跨页共享 Service（如 `AuthService`、`DialogService`、`ThemeService`、`AssetUrlsService`）。
- `src/api/` — 薄 fetch 封装，按领域划分文件，统一走 `src/api/client.ts` 与 `transport.ts`。
- `src/lib/` — 与视图解耦的纯函数与 `*-logic.ts`（配 co-located `*.test.ts`）。
- `src/platform/` — 桌面壳运行时检测（`runtime.ts`）与 Tauri 原生能力适配（`native.ts`）。

## 开发偏好与架构约束

- **路由唯一来源**：所有路径生成、导航与路由守卫一律使用 `src/routes.ts` 中的 `ROUTES`。
- **对话框与反馈**：禁止调用 `window.alert`、`window.prompt`、`window.confirm`，统一使用全局 `DialogService`（`src/services/dialog.service.ts`）。
- **平台与传输边界（由 `src/platform/boundaries.test.ts` 强约束）**：
  - `src/api/` 仅使用相对路径与 `credentials: 'include'`（HttpOnly cookie 会话），**严禁**设置 `Authorization` 请求头、严禁导入 `@tauri-apps` 或调用 `platform/native`。
  - 全仓仅 `src/platform/native.ts` 允许动态导入 `@tauri-apps/api/*`，且不得依赖 `plugin-http`、`plugin-store` 或业务 `src/api/`。
  - `src/platform/runtime.ts` 必须保持纯同步环境检测，不得包含任何网络或原生 I/O。
- **视觉与构建验收**：UI 重构以 `docs/design/v2/*.html` 与 `docs/design/v2/inwit.css` 为视觉唯一真相来源；修改完成后需运行 `pnpm --filter @inwit/web test` 与 `pnpm --filter @inwit/web build`。
