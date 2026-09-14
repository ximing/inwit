# T1 脚手架简报

## 做了什么

pnpm monorepo 骨架已落地，覆盖 `apps/*` 与 `packages/*`，未引入 turbo。

- **根**：`pnpm-workspace.yaml`；`package.json` 提供 `dev`（并行 `@inwit/server` + `@inwit/web`）、`build`、`typecheck`（均为 `pnpm -r`）。
- **`packages/dto`（`@inwit/dto`）**：zod schema 占位文件（User / Capture / Card / Thread / Review / Memory / Job / LLM / Agent），`tsc` 产出 ESM + `.d.ts`。`apps/server`、`apps/web` 以 `workspace:*` 引用。
- **`apps/server`（`@inwit/server`）**：ESM + `tsx watch` / `tsc`。Fastify 5 组装于 `src/app.ts`，`src/index.ts` 监听 **3020**。`GET /health` → `{ ok: true }`。`src/config.ts` 按 vital 写法用 zod 校验环境变量，dotenv 从 `apps/server/.env` 加载（未改该文件）。`src/db/` 为 pg `Pool` + drizzle；`PG_SSL=false` 时不传 `ssl`。`drizzle.config.ts` 就位，schema 留空给后续任务。
- **`apps/web`（`@inwit/web`）**：Vite + React 19 + TypeScript，状态管理 `@rabjs/react`（`RSRoot` + 全局 `AppService` + `observer` 页面）。顶部导航：捕捉 / 复习 / 线程 / 后台（react-router）。`server.proxy["/api"]` → `http://localhost:3020`。端口 **5190**。
- 全部 TypeScript `strict`。`.env` 已被 `.gitignore` 忽略，未写入任何会被 git 跟踪的新文件。

## 验收输出摘要

| 命令 | 结果 |
|---|---|
| `pnpm install` | 成功（pnpm 10.30.3，15.3s） |
| `pnpm -r typecheck` | 全绿（dto / server / web） |
| `pnpm -r build` | 全绿（dto tsc、server tsc、web vite 71 modules） |
| `pnpm --filter @inwit/server dev` 后 `curl localhost:3020/health` | `{"ok":true}` |
| `pnpm --filter @inwit/web dev` 后 `curl -s localhost:5190 \| grep -q '<div id="root"'` | PASS |

验收期间临时拉起的 dev 进程已停止，避免占用 3020 / 5190。

## 遗留问题

- dto schema 仅占位（`z.object({})`），字段在后续任务定义。
- drizzle `src/db/schema.ts` 为空，尚未 generate / migrate。
- `argon2`、`jsonwebtoken` 已安装，本任务未接线（留给用户系统）。
- 未配 eslint / prettier / 测试；web 为占位布局，无真实 API 调用。
