# `apps/desktop` 桌面壳指令

## 这个目录负责什么

- 基于 Tauri 2（`src-tauri/`）的轻量桌面外壳。
- 开发模式加载 `http://localhost:5190`，生产模式直接加载远程站点 `https://inwit.aimo.plus`，复用 WebView 同源 HttpOnly cookie 会话。

## 放置约束

- `src-tauri/src/` — Rust 侧窗口生命周期、系统菜单、macOS 托盘、全局快捷键与原生截图/剪贴板命令。
- `src-tauri/capabilities/default.json` — 最小权限白名单配置。
- `src-tauri/icons/` — 由 `packages/brand` 统一生成的图标产物，**禁止手改**。
- `__tests__/tauri.contract.test.mjs` — 桌面壳架构与安全契约测试。
- **不放什么**：不打包本地前端静态产物，不在 `package.json` 依赖 `@inwit/web` 或 `@tauri-apps/api`。

## 开发偏好与架构约束

以下约束由 `__tests__/tauri.contract.test.mjs` 强制守护，修改后必须运行 `pnpm --filter @inwit/desktop test`：

- **禁止 Bearer 与存储插件**：不得引入 `tauri-plugin-http`、`tauri-plugin-store`、`tauri-plugin-notification` 或开启 `unsafe-headers`。
- **窗口与平台行为**：保持 1280×800（最小 960×640）及系统默认标题栏；macOS 点击红灯关闭按钮时隐藏窗口而非退出进程（`CloseRequested` → `prevent_close` + `hide`），托盘图标开启 `icon_as_template(true)`。
- **导航与外链安全**：仅允许 http/https/`about:blank` 导航，禁止导航至 `tauri://` 或 `tauri.localhost`；外部链接仅在 `on_new_window` 中通过系统浏览器打开并 `Deny` 新窗口。
- **Web 桥接对齐**：Rust 命令（`capture_region`、`clipboard_image`）与事件名（`screenshot-captured`、`screenshot-failed`）必须与 `apps/web/src/platform/native.ts` 保持一致。
