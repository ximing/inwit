<p align="center">
  <img src="packages/brand/design/app-icon.png" width="96" alt="Inwit" />
</p>

<h1 align="center">Inwit</h1>

<p align="center"><strong>只管往里扔。它替你消化，并催你复习。</strong></p>

<p align="center">
  一个 AI 制卡、推送驱动的学习伴侣。<br />
  你负责输入，Agent 负责切成原子卡片、排出每日队列、维护知识地图。
</p>

<p align="center">
  <a href="https://inwit.aimo.plus">inwit.aimo.plus</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#架构">架构</a>
  ·
  <a href="#贡献">贡献</a>
</p>

<p align="center">
  <img alt="Node >= 22" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=nodedotjs&logoColor=white" />
  <img alt="pnpm 10" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-see%20README-lightgrey" />
</p>

---

## 理念

知识工具默认你愿意整理。Anki 默认你愿意制卡。大多数人两件事都做不到，于是笔记躺着，卡片荒着。

Inwit 把学习收成四个动作，不多不少：

**输入 → 消化 → 记住 → 贯通**

你只做第一件：把笔记、论文片段、截图、或一句问号扔进来。切卡、出题、打标签、排间隔、画知识地图，都交给后台的 Agent。复习不是打开驱动的课表，是按遗忘曲线推到今天的队列——打开就刷，刷完即走。

基础层（卡片 + SM-2）不依赖 AI 也能跑。AI 只做增强：换讲法、拆小、出对比专题、写周报。越用越懂你忘在哪里。

## 它不是什么

| | 他们在做的 | Inwit 在做的 |
|---|---|---|
| Notion / Obsidian | 打开驱动，手动整理 | 输入驱动，Agent 整理 |
| Anki | 手动制卡，机械重复 | AI 制卡，推送驱动的复习闭环 |

主题不是文件夹。资料按时间流入主题或未归属池；Agent 维护一张概念大纲树。空白节点可以让 AI 补一张入门卡——这是复习之外的第二个学习驱动。

---

## 产品长什么样

首页是一张纸。上面是捕捉，下面是今天该回忆的数量、本周复盘，以及最近 Agent 在忙什么。

<p align="center">
  <img src="docs/screenshots/readme/01-today.png" alt="Inwit 首页：捕捉、今日复习与最近动态" width="920" />
</p>

<p align="center"><sub>浅色 · 白日书桌。深色是灯下夜读，同一套纸感。</sub></p>

<p align="center">
  <img src="docs/screenshots/readme/09-today-dark.png" alt="Inwit 首页深色主题" width="920" />
</p>

文档工作台把阅读、编辑和卡片放在同一个窗格。Agent 切出的原子卡挂在原文锚点上，侧栏可以直接翻看、暂停或改写。

<p align="center">
  <img src="docs/screenshots/readme/02-docs.png" alt="文档工作台：原文锚点高亮与侧栏卡片" width="920" />
</p>

复习中心给今日队列、打卡热图和近七日节奏。点进去是翻卡：先自己想，再翻面，三档反馈决定下次出现的时间。

<p align="center">
  <img src="docs/screenshots/readme/03-review-hub.png" alt="复习中心：到期队列、打卡与节奏" width="920" />
</p>

<p align="center">
  <img src="docs/screenshots/readme/04-review-question.png" alt="复习翻卡：问题面" width="48%" />
  <img src="docs/screenshots/readme/05-review-answer.png" alt="复习翻卡：答案与三档反馈" width="48%" />
</p>

主题是一门课的方向。地图由 Agent 维护：已覆盖、学习中、尚未碰到的概念一眼能看见。虚线节点可以让 AI 补。

<p align="center">
  <img src="docs/screenshots/readme/06-topics-map.png" alt="主题知识地图" width="920" />
</p>

每周会自动写一份复盘：成功率、反复打滑的概念、下一周该补哪块。任务页能看见消化、问答、进化这些 Agent 跑得怎样。

<p align="center">
  <img src="docs/screenshots/readme/08-weekly-report.png" alt="每周学习复盘" width="48%" />
  <img src="docs/screenshots/readme/07-jobs.png" alt="任务队列与 Token 用量" width="48%" />
</p>

---

## 概念模型

四个实体，对应四个动作：

| 实体 | 动作 | 说明 |
|---|---|---|
| **资料**（Document） | 输入 | 课件、草稿、剪藏、截图、AI 回答。全部是文档 |
| **卡片**（Card） | 消化 | 原子知识：一条概念 + 一个例子 + 一个易混点，带出处锚点 |
| **主题**（Topic） | 贯通的方向 | 你给自己开的一门课：有目标、有资料、有卡片、有知识地图 |
| **关联**（Link） | 贯通的结构 | 卡片↔卡片、卡片↔资料（锚点）、资料/卡片↔主题（归属） |

复习不是实体，是卡片上的 SM-2 状态。未归属的资料可以由消化 Agent 软归属，用户只有确认权，没有整理义务。

---

## 架构

服务端优先。Web / 桌面 / 移动共用同一套 API 与 DTO。

```
┌─────────────────────────────────────────────────────────┐
│  客户端                                                  │
│  Web (Vite + React 19 + @rabjs/react)                   │
│  桌面 (Tauri 2，系统截图 / OCR)                           │
│  移动 (Expo / React Native)                              │
├─────────────────────────────────────────────────────────┤
│  服务端  Fastify 5 + drizzle-orm                         │
│  认证 · BYOK 模型 · 文档 inbox · 复习队列 · 任务与用量     │
├─────────────────────────────────────────────────────────┤
│  Agent 层（全部收敛于 pi-agent-core，不在体系外直调 LLM）  │
│  消化  扫描 inbox → 切卡 → 出题 → 挂地图                   │
│  问答  直接提问 → 中文回答 → 自动转卡片                    │
│  主题  整理知识地图 / 补空白 / 提议开题                    │
│  进化  换讲法 / 拆卡 / 混淆对比 / 周报复盘                 │
│  LLM   @earendil-works/pi-ai，用户 BYOK + 系统兜底        │
├─────────────────────────────────────────────────────────┤
│  数据                                                    │
│  PostgreSQL   业务数据 + 任务队列                         │
│  Qdrant       向量召回（2560 维）                         │
│  Meilisearch  中文稀疏召回                                │
│  百炼         embedding + rerank                         │
│  S3           附件（客户端只拿预签名 URL，不持有密钥）      │
└─────────────────────────────────────────────────────────┘
```

检索是混合召回：Qdrant 语义 + Meili 关键词 → RRF 融合 → rerank。所有查询按 `userId` 隔离。

Agent 跑在独立 worker 进程里。没有 worker，文档会停在「消化中…」。

### 仓库结构

pnpm monorepo，全 ESM（相对导入带 `.js` 后缀，tsconfig 为 NodeNext）。

```
inwit/
├── apps/server       Fastify + drizzle + worker（:3020）
├── apps/web          Vite + React + @rabjs/react（:5190，/api 代理到 3020）
├── apps/desktop      Tauri 2 桌面壳
├── apps/mobile       Expo / React Native
├── packages/dto      前后端共享 zod schema（API 契约的唯一来源）
├── packages/doc-schema / doc-engine / markdown
├── packages/brand    App 图标源（改 logo.svg 后 raster-icons）
└── docs/             PRD、设计稿、任务与开发日志
```

改 API：先改 `packages/dto`，再同步 server 的 parse/service 和 web 的调用方。

---

## 快速开始

需要 **Node 22+** 和 **pnpm 10**。数据库与检索的连接写在 `apps/server/.env`（不入库）。

```bash
pnpm install
pnpm --filter @inwit/server migrate
pnpm dev                                 # server :3020 + web :5190
pnpm --filter @inwit/server worker        # 另开一个终端：消化 / 问答 / 进化 / 周报
```

浏览器打开 [http://localhost:5190](http://localhost:5190)。

<p align="center">
  <img src="docs/screenshots/readme/00-login.png" alt="登录页" width="560" />
</p>

### 桌面端

需要 Rust 与系统 WebView：

```bash
pnpm --filter @inwit/desktop dev          # 等 Vite :5190，连本地 API :3020
```

macOS 点红灯会藏到菜单栏，并不退出；「退出 Inwit」才退出。全局快捷键 ⌘⇧2 / Ctrl+Shift+2 区域截图（macOS 需「屏幕录制」权限）。

### 生产与安装包

生产桌面包把 `VITE_TAURI_API_URL` 打进前端；Android APK 把 `EXPO_PUBLIC_API_BASE_URL`（以及 Expo `extra.apiBaseUrl`）打进客户端。由仓库变量 / workflow 输入 `INWIT_API_URL` 注入，默认 `https://inwit.aimo.plus`。

GitHub Release 打 `v*.*.*` tag 后，Actions「Build Desktop and Android」会把 macOS / Windows / Linux 安装包和 Android APK 挂到该 Release。Server 镜像推 `ghcr.io/ximing/inwit-server`（同一镜像 `node dist/worker.js` 跑 worker）。

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

生产 compose 需 `.env`，见 [`.env.production.example`](.env.production.example)。

---

## 页面路由

| 路径 | 页面 |
|---|---|
| `/` | 首页（Today）：今日复习、捕捉、连续天数 |
| `/login` | 登录 / 注册 |
| `/docs` | 文档工作台（`?doc=` 打开，`&edit=1` 编辑，`&anchor=` 滚到卡片锚点） |
| `/review` | 复习中心（Hub + SM-2 设置 + 翻卡；`?tab=reports` 为周报） |
| `/topics` | 学习主题 |
| `/topics?topic=:id` | 主题详情（知识地图 + 资料流） |
| `/jobs` | 任务与用量 |
| `/settings` | 外观、BYOK 模型、接口令牌 |

旧路径由前端跳到新地址，书签不用改：`/doc/:id` → `/docs?doc=`，`/editor/:id` → `&edit=1`，`/card/:id` → `/review`，`/admin` → `/jobs`。

---

## 常用命令

```bash
pnpm -r typecheck
pnpm -r build
pnpm --filter @inwit/server test
pnpm --filter @inwit/server test -- src/review/sm2.test.ts
pnpm --filter @inwit/server migrate:generate   # schema 变更后生成
pnpm --filter @inwit/server migrate            # 执行
pnpm --filter @inwit/desktop test              # Tauri 合同测试
pnpm --filter @inwit/brand raster-icons
```

改 `apps/server/src/db/schema.ts` 必须走 drizzle migration，不手改数据库。

发版前先升级 `apps/web/package.json` 的 `version`（semver）。Vite 构建时打进前端常量，设置页底部展示；不要在 UI 里手写版本号。

---

## 环境变量

写在 `apps/server/.env`。`config.ts` 用 zod 校验，缺项会拒绝启动。测试环境只读 `apps/server/.env.test`，不回落开发 `.env`。

| 变量 | 说明 |
|---|---|
| `NODE_ENV` | `development` / `test` / `production` |
| `PORT` | HTTP 端口，默认 `3020` |
| `WEB_ORIGIN` | CORS 与 cookie 用的前端源，默认 `http://localhost:5190` |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` `PG_SSL` | PostgreSQL |
| `JWT_SECRET` / `COOKIE_SECRET` | 至少 32 字符 |
| `LLM_KEY_ENCRYPTION_KEY` | 32 字节 hex，加密用户 BYOK key |
| `QDRANT_URL` `QDRANT_API_KEY` | 向量库 |
| `MEILI_HOST` `MEILI_API_KEY` | 中文稀疏检索 |
| `DASHSCOPE_API_KEY` | 百炼：系统兜底 chat、embedding、rerank |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | 默认 `qwen3-vl-embedding` / `2560` |
| `RERANK_MODEL` | 默认 `qwen3.7-text-rerank` |
| `WORKER_POLL_MS` `WORKER_CLAIM_LIMIT` `WORKER_STUCK_MS` `JOB_MAX_ATTEMPTS` | 队列 |

附件走远端 S3，服务端签发预签名 URL；客户端不持有存储密钥，DB 只存对象 key。需要的变量见 `ATTACHMENT_S3_*`（`.env.production.example` 有完整清单）。Bucket CORS 需允许前端来源的 GET、PUT、HEAD，并暴露 `ETag`。

---

## 贡献

欢迎 issue 和 pull request。较大的行为变更，请先开 issue 对齐，再动手。

1. Fork，从 `master` 拉功能分支。
2. `pnpm install` 后按「快速开始」把 web + server + worker 跑起来。
3. 提交前至少：

   ```bash
   pnpm typecheck
   pnpm --filter @inwit/server test
   pnpm --filter @inwit/web build
   ```

约定（完整版在仓库根目录 [`CLAUDE.md`](CLAUDE.md)）：

- **API 契约只出在 `@inwit/dto`**。先改 zod schema，再改 server / web。
- **Schema 变更走 drizzle**（`schema.ts` → `migrate:generate` → `migrate`）。
- **Agent 可测逻辑放 `*-logic.ts`**，编排和 IO 放旁边的模块；后端测试不连真实数据库。
- **前端一页一个 Service**（`@rabjs/react`），不要另引状态库。文案中文，语气克制书面。不要用 `window.alert` / `prompt` / `confirm`，走全局 DialogService。
- **样式按功能就近**：页面 CSS 放 `apps/web/src/pages/<功能>/`，不要往全局 `styles.css` 堆业务规则。新 CSS 必须在 `style-entry.css` 登记。
- **图片与文件**只走服务端预签名 URL。

UI 视觉以 [`docs/design/v2/`](docs/design/v2/) 为设计稿。产品需求见 [`docs/prd.md`](docs/prd.md)。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/prd.md](docs/prd.md) | 产品需求与概念模型 |
| [docs/design-system.md](docs/design-system.md) | 「纸上学习」设计系统 |
| [docs/design/v2/](docs/design/v2/) | UI 重构设计稿 |
| [CLAUDE.md](CLAUDE.md) | 给编码代理的仓库约定 |
| [docs/dev-log.md](docs/dev-log.md) | 开发日志 |
| [docs/tasks/](docs/tasks/) | 历史任务与报告 |

---

## 许可证

源码目前公开在 GitHub，**尚未选择 SPDX 许可证**。个人学习、阅读和提 PR 欢迎；二次分发或商用请先开 issue 与维护者沟通。
