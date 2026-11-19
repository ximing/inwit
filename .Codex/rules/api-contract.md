---
paths:
  - "packages/dto/src/**/*.ts"
  - "apps/server/src/**/*.routes.ts"
  - "apps/web/src/api/**/*.ts"
  - "apps/mobile/src/api/**/*.ts"
---

# 跨端 API 契约协同规范

- **单一契约源**：所有 HTTP 接口的 params、query、body 与响应结构统一在 `packages/dto/src/*.ts` 中用 Zod 定义，并通过 `packages/dto/src/index.ts` 导出。
- **变更顺序**：
  1. 先更新 `packages/dto/src/*.ts` 并导出，必要时运行 `pnpm --filter @inwit/dto build`。
  2. 同步 `apps/server/src/**/*.routes.ts`（统一挂载 `preHandler: [app.authenticate]` 并用 DTO schema `.parse()` 校验入参）与 `*.service.ts`（通过 `toPublicX` 映射返回 DTO）。
  3. 同步更新 `apps/web/src/api/*.ts` 与 `apps/mobile/src/api/*.ts` 的调用方类型与路径。
- **Skill 接口文档同步**：当新增、删除或修改了服务端路由路径、HTTP 方法或绑定的 DTO Schema 时，可运行 `pnpm gen:inwit-skill` 更新 `skills/inwit/references/` 下的接口参考文档。
