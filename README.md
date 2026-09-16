# Inwit

一个「只管往里扔、它替你消化、并催你复习」的学习伴侣。

用对话降低捕捉成本（不要求分类、打标签、选文件夹），用 AI 把碎片内容加工成可复习的原子卡片，再用间隔重复（SM-2）把复习变成推送驱动的每日队列。

**差异化**：Notion / Obsidian 是打开驱动 + 手动整理，Anki 是手动制卡 + 机械重复。Inwit 是 **AI 制卡 + 推送驱动的复习闭环**。

MVP 面向技术学习者 / 备考人群。对话框里可以粘贴笔记，也可以直接提问（例如「L1 和 L2 正则化啥区别」）——回答会自动整理成卡片进入复习队列。

## 概念模型

学习只有四个动作：输入 → 消化 → 记住 → 贯通。对应四个实体，不多不少：

| 实体 | 动作 | 说明 |
|---|---|---|
| **资料**（Document） | 输入 | 课件、参考书、草稿纸。文档 / 闪念 / 剪藏 / AI 回答都是资料 |
| **卡片**（Card） | 消化 | 原子知识单元，从资料切出，带出处锚点 |
| **主题**（Topic） | 贯通的方向 | 你给自己开的一门课：有目标、有资料、有卡片、有知识地图 |
| **关联**（Link） | 贯通的结构 | 卡片↔卡片、卡片↔资料（锚点）、资料/卡片↔主题（归属） |

主题不是文件夹。资料按时间流入主题或未归属池；Agent 维护主题的概念大纲树。未归属资料聚成一类时，Agent 会在首页提议开主题，一键创建并长出初始地图。

## 架构

```
┌────────────────────────────────────────────┐
│ 客户端：Web (Vite+React+rab-react)          │
│         Tauri 桌面端 (V0.5, 截图OCR)        │
│         React Native App (二期)             │
├────────────────────────────────────────────┤
│ 服务端 (Fastify + drizzle-orm)：            │
│   用户系统 / BYOK LLM 配置 / 文档 inbox     │
│   复习队列 / 任务与用量 / 周报               │
├────────────────────────────────────────────┤
│ Agent 层 (全部收敛于 pi-agent-core)：        │
│   消化 Agent：扫描 inbox→切卡→出题→关联     │
│   问答 Agent：直接提问→中文回答→自动转卡片   │
│   主题 Agent：整理知识地图 / 补空白 / 提议开主题 │
│   进化 Agent：换讲法 / 拆卡 / 混淆对对比专题 / 周报复盘 │
│   能力扩展一律开发为 pi-agent 插件/AgentTool │
│ LLM 接入 (@earendil-works/pi-ai)：          │
│   OpenAI / DeepSeek / Claude / 智谱 (BYOK)  │
├────────────────────────────────────────────┤
│ 数据层：                                    │
│   PostgreSQL — 业务数据 + 任务队列           │
│   Qdrant — 向量检索（语义召回，2560 维）     │
│   Meilisearch — 中文稀疏检索（关键词召回）   │
│   百炼 — qwen3-vl-embedding + text-rerank   │
└────────────────────────────────────────────┘
```

pnpm monorepo：

```
inwit/
├── apps/server     Fastify + drizzle + worker
├── apps/web        Vite + React + @rabjs/react（端口 5190，/api 代理到 3020）
├── apps/desktop    Tauri 2 桌面壳（macOS 菜单栏 / Win·Linux 托盘）
├── packages/dto    前后端共享 zod schema
└── docs/           PRD、任务 prompt、开发日志
```

## 启动

需要 Node 22+ 和 pnpm 10。数据库与检索服务的连接写在 `apps/server/.env`（不入库）。

```bash
pnpm install
pnpm --filter @inwit/server migrate
pnpm dev                              # server :3020 + web :5190
pnpm --filter @inwit/server worker     # 消化 / 问答 / 进化 / 周报 Agent 队列，另开一个终端
```

浏览器打开 http://localhost:5190 。没有 worker 的话，文档会停在「消化中…」。

桌面端（需 Rust / 系统 WebView）：

```bash
pnpm --filter @inwit/desktop dev     # 等 Vite :5190，连本地 API :3020
```

macOS 点红灯会藏到菜单栏，并不退出；「退出 Inwit」才退出。全局快捷键 ⌘⇧2 / Ctrl+Shift+2 区域截图（macOS 需「屏幕录制」权限）。生产包把 `VITE_TAURI_API_URL`（默认 `https://inwit.aimo.plus`）打进前端。

GitHub Release 打 `v*.*.*` tag 后，Actions「Build Desktop」会把 macOS / Windows / Linux 安装包挂到该 Release。Server 镜像推 `ghcr.io/ximing/inwit-server`（同一镜像 `node dist/worker.js` 跑 worker）。

## 页面路由

| 路径 | 页面 |
|---|---|
| `/` | 首页（Today）：今日复习入口、捕捉、连续天数与统计 |
| `/login` | 登录 / 注册 |
| `/docs` | 文档工作台（左列表 + 右阅读/编辑同 pane；`?doc=` 打开文档，`&edit=1` 进入编辑，`&anchor=` 滚动到卡片锚点） |
| `/review` | 复习中心（Hub 统计 + SM-2 设置 + 翻卡 Session） |
| `/topics` | 学习主题 |
| `/topics/:id` | 主题详情（知识地图 + 资料流；accept 开题后在这里看地图长出来） |
| `/jobs` | 任务与用量（队列实况、Token 趋势、执行历史） |
| `/settings` | 外观与 BYOK 模型 |

旧路径由前端跳到新地址，书签不用改：

| 旧路径 | 现在 |
|---|---|
| `/doc/:id` | `/docs?doc=:id` |
| `/editor/new` | `/docs?edit=1` |
| `/editor/:id` | `/docs?doc=:id&edit=1` |
| `/card/:id`、`/cards/:id` | `/review` |
| `/admin`、`/captures` | `/jobs` |

其它常用命令：

```bash
pnpm -r typecheck
pnpm -r build
pnpm --filter @inwit/server test
pnpm --filter @inwit/server start      # node dist，需先 build
pnpm --filter @inwit/desktop test      # Tauri 合同测试
pnpm --filter @inwit/brand raster-icons
```

生产 compose（需 `.env`，见 `.env.production.example`）：

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

## 环境变量

写在 `apps/server/.env`（或 `.env.development`）。`config.ts` 用 zod 校验，缺项会拒绝启动。

| 变量 | 说明 |
|---|---|
| `NODE_ENV` | `development` / `test` / `production`，默认 `development` |
| `PORT` | HTTP 端口，默认 `3020` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `WEB_ORIGIN` | CORS 与 cookie 用的前端源，默认 `http://localhost:5190` |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` | PostgreSQL |
| `PG_SSL` | `true` / `false`，默认 `false` |
| `JWT_SECRET` | access/refresh JWT，至少 32 字符 |
| `COOKIE_SECRET` | Fastify cookie 签名，至少 32 字符 |
| `ACCESS_TOKEN_TTL_SECONDS` | 默认 900 |
| `REFRESH_TOKEN_TTL_DAYS` | 默认 30 |
| `LLM_KEY_ENCRYPTION_KEY` | 32 字节 hex，加密用户 BYOK key |
| `QDRANT_URL` `QDRANT_API_KEY` | 向量库 |
| `MEILI_HOST` `MEILI_API_KEY` | 中文稀疏检索 |
| `DASHSCOPE_API_KEY` | 百炼：系统兜底 chat、embedding、rerank |
| `DASHSCOPE_BASE_URL` | 默认 `https://dashscope.aliyuncs.com/api/v1` |
| `EMBEDDING_MODEL` | 默认 `qwen3-vl-embedding` |
| `EMBEDDING_DIMENSIONS` | 默认 `2560` |
| `RERANK_MODEL` | 默认 `qwen3.7-text-rerank` |
| `WORKER_POLL_MS` | 队列轮询间隔，默认 1000 |
| `WORKER_CLAIM_LIMIT` | 每轮最多领取的 job 数，默认 5 |
| `WORKER_STUCK_MS` | running 超时回收，默认 15 分钟 |
| `JOB_MAX_ATTEMPTS` | 失败重试上限，默认 3 |

测试环境只读 `apps/server/.env.test`，不会回落到开发 `.env`。

产品需求见 [docs/prd.md](docs/prd.md)，任务历史见 [docs/dev-log.md](docs/dev-log.md) 与 [docs/tasks/](docs/tasks/)。
