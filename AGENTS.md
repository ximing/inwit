# 项目指令

## 项目概览

Inwit 是一个「扔进去、AI 消化、催你复习」的学习伴侣。pnpm monorepo，Node 22+，全 ESM。TypeScript 相对导入必须带 `.js` 后缀。

- `apps/server` — Fastify 5、drizzle、PostgreSQL，以及独立的 worker
- `apps/web` — Vite、React 19、`@rabjs/react`。生产站点同时给桌面壳加载
- `apps/mobile` — Expo、React Native、`expo-router`
- `apps/desktop` — Tauri 2 远程站点壳
- `packages/dto` — 跨端 Zod 契约
- `packages/doc-schema` — ProseMirror / Tiptap 文档模型与锚点
- `packages/doc-engine` — 移动端 WebView 用的单文件编辑器
- `packages/markdown` — Markdown 与 ProseMirror JSON 互转
- `packages/brand` — 图标生成。改 `src/logo.svg` 后跑 `pnpm --filter @inwit/brand raster-icons`

Claude 的同文根指令在 `CLAUDE.md`。改全局规则、命令或子系统名单时，两处一起改。

## 全局规则

- TypeScript 相对导入一律带 `.js` 后缀。
- 共享类型从 `@inwit/dto` 导入。改 API 先改 `packages/dto`。
- 改表走 drizzle migration（`apps/server/src/db/schema.ts` → `migrate:generate` → `migrate`）。禁止手改数据库。
- 图片和文件只用服务端签发的 S3 presigned URL。客户端不持有存储凭证。数据库只存对象 key。
- 产品文案用中文，语气克制书面。图标用 `lucide-react` 或 `lucide-react-native`。各端图标由 `packages/brand` 生成，不手改产物。
- 发版前先升级 `apps/web/package.json` 的 `version`。不要在界面里手写版本号。

## 开发入口

- `pnpm dev`：server `:3020` 与 web `:5190`
- `pnpm --filter @inwit/server worker`：没有它，文档会停在消化中
- `pnpm typecheck`
- `pnpm --filter @inwit/server test`、`pnpm --filter @inwit/web test`、`pnpm --filter @inwit/mobile test`、`pnpm --filter @inwit/desktop test`
- `pnpm --filter @inwit/server migrate:generate`，然后 `pnpm --filter @inwit/server migrate`

## 局部规则导航

进入子系统时，该目录的 `AGENTS.md` 会引入同目录 `CLAUDE.md`。不要把子系统细则复制回本文件。

- `apps/server/` — 分层、多租户、Job 与检索
- `apps/web/` — 页面边界、路由、平台传输
- `apps/mobile/` — Expo 路由、PAT、文档引擎同步
- `apps/desktop/` — Tauri 壳契约与权限
- `packages/dto/` — 契约包
- `packages/doc-schema/` — 文档模型
- `packages/doc-engine/` — WebView 引擎

横切规则在 `.Codex/rules/`，只在命中路径时加载。正文与 `.claude/rules/` 同名文件保持一致，改一处时改另一处。

- `.Codex/rules/api-contract.md`
- `.Codex/rules/rab-service-ui.md`
- `.Codex/rules/testing.md`
- `.Codex/rules/web-styles.md`

`packages/markdown/`、`packages/brand/`、`docs/`、`skills/` 没有单独的目录指令。

<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `inwit`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
