# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Inwit — 一个「扔进去、AI 消化、催你复习」的学习伴侣。pnpm monorepo，Node 22+，全 ESM（相对导入必须带 `.js` 后缀，tsconfig NodeNext 风格，新文件保持一致）。

### 子系统与包结构

- `apps/server` — Fastify 5 + drizzle-orm + PostgreSQL 后端服务，以及独立异步 `worker` 进程
- `apps/web` — Vite + React 19 + `@rabjs/react` + react-router + Tiptap Web 应用（同时作为桌面壳加载的远端站点）
- `apps/mobile` — Expo + React Native + `expo-router` + `@rabjs/react` 移动端应用
- `apps/desktop` — Tauri 2 桌面壳（加载 dev 或线上 Web 站点，提供系统菜单、托盘、全局快捷键与区域截图）
- `packages/dto` — 跨端共享的 Zod Schema 与类型定义（API 契约唯一来源）
- `packages/doc-schema` — 跨端共享的 ProseMirror / Tiptap 文档 Schema、块扩展与锚点定位
- `packages/doc-engine` — 供 Mobile WebView 消费的单文件富文本引擎构建包与桥接协议
- `packages/markdown` — Markdown（含 `[[kind:id]]` 实体 token）与 ProseMirror JSON 双向转换
- `packages/brand` — 品牌 Logo 与多端图标生成管线（改 `src/logo.svg` 后跑 `pnpm --filter @inwit/brand raster-icons`）
- `docs/` — PRD、设计系统、UI 设计稿（`docs/design/v2/*.html` 为视觉唯一真相来源）与重构上下文（`docs/rewrite/CONTEXT.md`）
- `skills/inwit` — 面向 Agent 的 HTTP 投喂与操作技能（由 `pnpm gen:inwit-skill` 从路由与 DTO 提取接口参考）

## 全局规则

- **ESM 导入**：TypeScript 相对导入一律带 `.js` 后缀。
- **契约先行**：前后端与移动端共享类型均从 `@inwit/dto` 导入；修改 API 先改 `packages/dto`。
- **数据库迁移**：改表结构必须走 drizzle migration（`apps/server/src/db/schema.ts` → `migrate:generate` → `migrate`），禁止手改数据库。
- **文件与图片访问**：所有图片与文件的上传/读取统一由服务端签发 S3 presigned URL（PUT 上传、GET 带过期时间）；客户端禁止持有存储凭证或直连 bucket 二次获取；DB 只存对象 key，不存 URL。
- **文案与设计**：产品文案全中文，语气克制书面；图标统一使用 `lucide-react` / `lucide-react-native`；各端 App 图标由 `packages/brand` 统一生成，不手改产物。
- **发版**：发版前必须先升级 `apps/web/package.json` 的 `version`（semver，构建时注入前端常量，禁止在 UI 里手写版本号）。

## 常用命令

```bash
pnpm install
pnpm dev                                         # server :3020 + web :5190（并行）
pnpm --filter @inwit/server worker               # Agent 队列 worker，需另开终端；没有它文档停在「消化中…」
pnpm typecheck                                   # 全仓库 tsc
pnpm -r build                                    # 全仓库构建

# 测试
pnpm --filter @inwit/server test                 # 服务端 vitest（支持 -- <file> 或 -t "<pattern>"）
pnpm --filter @inwit/web test                    # Web 端 vitest
pnpm --filter @inwit/mobile test                 # 移动端 vitest
pnpm --filter @inwit/desktop test                # 桌面壳契约测试
pnpm --filter @inwit/server test:retrieval       # 检索链路自检（需真实外部服务）

# 数据库 migration（远程 PG，.env 已配好，可直接跑）
pnpm --filter @inwit/server migrate:generate     # drizzle-kit 生成
pnpm --filter @inwit/server migrate              # 执行迁移
```

## 局部规则导航

进入具体子系统或修改特定类型文件时，遵循对应的局部指令与路径规则：

- **子系统 `CLAUDE.md`**（按目录按需加载）：
  - `apps/server/CLAUDE.md` — 服务端分层、多租户隔离、Job/Agent 管线、混合检索与 SM-2 复习
  - `apps/web/CLAUDE.md` — Web 目录边界、路由与弹窗规范、Tiptap/PDF 工作台、平台传输边界
  - `apps/mobile/CLAUDE.md` — Expo 路由结构、PAT 鉴权传输、WebView `doc-engine` 同步机制
  - `apps/desktop/CLAUDE.md` — Tauri 2 远程站点壳契约、权限白名单与原生 IPC 边界
  - `packages/dto/CLAUDE.md` — API 契约 Schema 编写与导出规范
  - `packages/doc-schema/CLAUDE.md` — ProseMirror / Tiptap 节点扩展与锚点纯函数规范
  - `packages/doc-engine/CLAUDE.md` — WebView 编辑器单文件产物构建与桥接协议规范
- **横切路径规则 `.claude/rules/`**（按文件 glob 按需加载）：
  - `.claude/rules/rab-service-ui.md` — `@rabjs/react` 响应式 Service 与组件开发规范
  - `.claude/rules/web-styles.md` — Web CSS 模块化就近维护与 `style-entry.css` 登记规范
  - `.claude/rules/testing.md` — `*-logic.ts` 纯函数切分、测试环境隔离与架构守护测试
  - `.claude/rules/api-contract.md` — 跨端 API 变更协同与 Skill 引用生成

<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `inwit`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
