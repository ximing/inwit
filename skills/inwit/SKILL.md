---
name: inwit
description: >
  Operate the Inwit learning app over HTTP: capture notes, create documents,
  chat-to-cards, review queues, search, topics, maps, and jobs. Use when the
  user mentions Inwit, 投喂, 闪念, 复习, 卡片, 知识地图, 接口令牌, or runs /inwit.
  Call catalog endpoints with INWIT_TOKEN; do not invent APIs.
---

# Inwit

Inwit 是「扔进去 → AI 消化成卡片 → 催你复习」的学习伴侣。本 skill 用 HTTP 操作**当前用户的实例**。

你是投喂口，不是第二大脑：把笔记、问号、剪藏送进 Inwit，不要在对话里整理、制卡或排复习。消化、SM-2、知识地图由 Inwit 后台完成。

接口形状以 `references/` 下**当前意图对应的那一个模块**为准。禁止读 `api.json`，禁止一次打开多个模块 md。

## 每个会话

`SKILL_DIR` = 本文件所在目录。

```bash
node "$SKILL_DIR/scripts/inwit.mjs" call GET /api/auth/me
```

需要某条接口的 body/query 时：先按意图 **Read 下表中的一个 md**，或 `show METHOD PATH`。不要用无过滤的 `catalog` 当 schema 来源。

## 凭证

| 变量 | 用途 |
|---|---|
| `INWIT_TOKEN` | 设置页 **接口令牌** 明文，前缀 `iwt_`。写入环境变量，不要写入对话或仓库文件。 |
| `INWIT_BASE_URL` | API 根。缺省 `http://localhost:3020`。线上一般是 `https://inwit.aimo.plus`。 |

已认证路由一律 `Authorization: Bearer $INWIT_TOKEN`。Agent 只用 PAT。模块里 `auth=pat` 的路由拒绝 cookie/JWT。

令牌未设置时 `call` 会失败并提示；去设置页创建/揭示令牌，让用户放到环境变量后再继续。不要打印完整 token。

## 领域

| 实体 | 做什么 |
|---|---|
| Document | 输入：笔记、导入、问答、截图、周报 |
| Card | 消化结果：原子知识 + 题目。文章消化的卡片要在应用里确认后才进入复习 |
| Topic | 一门课的方向，不是文件夹 |
| Map node | 主题下的概念大纲 |
| Job | 异步：digest / chat / extract / ocr / topic / evolve / weekly_report |

文章消化的卡片要在应用里确认后才进入复习；本 skill 可以调用确认接口，但不要把未确认卡当成已经在队列里。

文档长期 `pending` 时先看 jobs 模块里的 `GET /api/jobs/queue`，不要重发同样内容。

创建和阅读文档走 `/api/open/documents`（PAT）。交 markdown **或** html；读出用返回的 `markdown`。不要手搓文档 JSON，也不要用 `PUT /api/documents/:id` 回写正文（会丢批注/卡片锚点）。

提问用 `POST /api/chat`，`question` 末尾带 `？`/`?`。

## 意图 → 只读一个模块

PATH 参数把 `:id` / `:cardId` / `:key` 换成实值。然后 `call METHOD PATH`。

| 用户要… | 只 Read | 先调 |
|---|---|---|
| 连通 / 我是谁 | （不必读模块） | `call GET /api/auth/me` |
| 投喂笔记 / 转存 / 读文档正文 | [references/open.md](references/open.md) | `POST` / `GET /api/open/documents` |
| 提问并制卡 / 文档列表与导入 | [references/documents.md](references/documents.md) | `POST /api/chat` 等 |
| 今日复习 | [references/review.md](references/review.md) | `GET /api/review/today` |
| 卡片 | [references/cards.md](references/cards.md) | 见该模块 |
| 搜索 | [references/search.md](references/search.md) | `GET /api/search` |
| 主题 / 地图 | [references/topics.md](references/topics.md) | 见该模块 |
| 任务进度 / 周报 | [references/jobs.md](references/jobs.md) | `GET /api/jobs/queue` |
| 记忆集合 / 整理历史 | [references/memory.md](references/memory.md) | `GET /api/memory/collections` |
| 批注 | [references/annotations.md](references/annotations.md) | 见该模块 |
| 媒体上传 | [references/assets.md](references/assets.md) | 见该模块 |
| 账号 / 模型设置 | [references/account.md](references/account.md) | 见该模块 |
| 管理后台 | [references/admin.md](references/admin.md) | 见该模块 |

上表没有的模块见 [references/index.md](references/index.md)（只读索引，不要顺着把所有模块打开）。

Query：`--query q=词 --query limit=8`。Body：`--json '{"title":"…","markdown":"…"}'` 或 `--file /tmp/body.json`。大段正文走 `--file`。

投喂响应含 `markdown` 和 `media`（外链图/视频会转存，失败在 `media.failed`，文档仍创建）。

## 约束

- 记忆集合与整理历史只读：`GET /api/memory/collections`、`GET /api/memory/revisions`。不要停用或删除。
- 永久删除（路径含 `/permanent`）、清空主题、取消/重试任务前，先简述影响并得到用户确认。
- 软删进回收站，可用对应 `restore`。
- 错误体：`{"error":{"code":"…","message":"…","details":…}}`。把 `code` + `message` 告诉用户，不要把请求头里的 token 一并倒出。
- `POST /api/open/documents` 会把正文里的 http(s) 图/视频转存为 `asset:` key（最多 40 个 URL，失败保留外链）。不要把对象存储 URL 当持久引用。
- `INWIT_TOKEN` 只从环境读。
