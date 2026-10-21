# `packages/doc-engine` 移动文档引擎指令

## 这个目录负责什么

- 将基于 `@inwit/doc-schema` 与 Tiptap 的富文本阅读/编辑器通过 `vite-plugin-singlefile` 打包为单文件 `dist/doc-engine.html`，供 `apps/mobile` 的 WebView 加载。
- 定义宿主（React Native）与 WebView 之间的强类型双向通信协议（`src/protocol.ts`）。

## 放置约束

- `src/protocol.ts` — 协议版本号、命令（`DocEngineCommand`）、事件（`DocEngineEvent`）及无依赖的消息校验器（`parseIncomingMessage`）。该文件同时作为 `@inwit/doc-engine` 与 `@inwit/doc-engine/protocol` 的对外类型与运行时入口。
- `src/engine.ts`、`src/bridge.ts`、`src/asset-map.ts` — WebView 内部的编辑器实例管理、postMessage 桥接与对象存储 key 到预签名 URL 的映射替换。
- **不放什么**：不在 `src/protocol.ts` 中引入浏览器 DOM 或 Tiptap 依赖，确保 React Native 宿主侧可直接安全导入。

## 开发偏好与架构约束

- **构建与同步链路**：修改本包后，必须运行 `pnpm --filter @inwit/doc-engine test` 与 `pnpm --filter @inwit/doc-engine build` 生成 `dist/doc-engine.html`，并在移动端通过 `pnpm --filter @inwit/mobile sync:engine` 同步到 `apps/mobile/assets/doc-engine.html`。
- **协议演进**：新增命令或事件时，必须在 `src/protocol.ts` 中同步补齐入站校验逻辑并在 `src/protocol.test.ts` 中添加单测。
