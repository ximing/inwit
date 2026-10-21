# `packages/dto` 契约包指令

## 这个目录负责什么

- 服务端（`apps/server`）、Web 端（`apps/web`）与移动端（`apps/mobile`）共享的 API 契约唯一来源（`@inwit/dto`）。
- 使用 Zod 定义请求参数、请求体、响应体及领域实体数据结构，并导出对应的 TypeScript 类型。

## 放置约束

- `src/*.ts` — 按业务域划分的 Zod Schema 与 `z.infer` 推导类型（如 `document.ts`、`card.ts`、`review.ts`、`concept.ts`）。
- `src/index.ts` — 汇总导出所有对外公开的 Schema、常量与类型。
- **不放什么**：不放任何平台相关代码、数据库模型、HTTP 请求实现或带副作用的运行时逻辑。

## 开发偏好与架构约束

- **双模式消费**：`package.json` 中 `"types": "./src/index.ts"` 使 Web/Mobile 在开发与类型检查时直接读取源码，而 `"import": "./dist/index.js"` 供 Server 运行时加载编译产物。修改 DTO 后，若需运行服务端测试或构建，先执行 `pnpm --filter @inwit/dto build`。
- **导出完整性**：在领域文件中新增的 Schema 或类型必须在 `src/index.ts` 显式导出。
- **时间与 ID 约定**：跨网络传输的 DTO 时间字段统一定义为 ISO 字符串，不在契约层暴露 `Date` 实例。
