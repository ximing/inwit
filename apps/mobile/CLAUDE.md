# `apps/mobile` 移动端指令

## 这个目录负责什么

- Inwit 移动端客户端（Expo + React Native + `expo-router` + `@rabjs/react`）。
- 通过 `react-native-webview` 承载 `@inwit/doc-engine` 构建的富文本阅读与编辑引擎。

## 放置约束

- `app/` — 仅放 `expo-router` 文件系统路由入口，保持极薄包装，将实际渲染与交互委托给 `src/pages/`。
- `src/pages/` — 各业务页面视图与页面级 Service。
- `src/services/`、`src/components/`、`src/lib/` — 移动端全局 Service、跨页通用 RN 组件与纯逻辑模块。
- `src/api/` — 移动端 HTTP 客户端封装（使用 Bearer / PAT 令牌鉴权，与 Web 端的 cookie 会话分离）。
- `src/doc-engine/` — WebView 文档引擎组件（`DocEngineView.tsx`）、命令队列与事件解析。
- `assets/doc-engine.html` — 由 `packages/doc-engine` 构建并经脚本同步的产物，**禁止直接手改**。

## 开发偏好与架构约束

- **路由常量**：页面跳转与守卫统一使用 `src/routes.ts` 的 `ROUTES` 与 `docPath()`。
- **文档引擎同步**：修改 `packages/doc-engine` 或 `packages/doc-schema` 后，需先跑 `pnpm --filter @inwit/doc-engine build`，再通过 `pnpm --filter @inwit/mobile sync:engine`（已在 `prestart` / `prebuild` 自动挂载）同步到 `assets/doc-engine.html`。
- **桥接协议**：RN 与 WebView 之间的通信严格遵循 `@inwit/doc-engine/protocol` 定义的命令与事件结构，图片等私有资源通过 `AssetUrlsService` 换取预签名 URL 后经 `injectAssetUrls` 注入。
