# T20 简报 —— Agent 提议开主题 + 收尾

依据：`docs/prd.md` §2.6（主题可以由 Agent 提议诞生），`docs/design-system.md` §6.5（提示条规范）。前置 T16–T19。pi-agent 规范照旧：所有智能行为都是 `Agent` + `AgentTool`。

## 做了什么

### 提议 job（`jobs type=topic, action=suggest`）

消化一篇**仍未归属**的文档后，若近 30 天未归属已消化资料 ≥4 条，延迟 12s 入队（避免连贴几篇时扫描过早）。也可手动 `POST /api/topics/suggest-scan`（立即跑；已有 pending/running 则返回现有 job）。

主题 Agent 工具：

| 工具 | 作用 |
|---|---|
| `read_unattributed_pool` | 近 30 天未归属资料标题 + 卡片概念、活跃主题、已有建议 |
| `write_topic_suggestion` | 写入 `memories(scope=user, layer=profile, key=topic_suggestion_<slug>)` |

写入硬约束（服务端，不靠模型自觉）：≥4 条未归属文档；活跃主题标题不重叠；同一 key / 标题 / ≥3 条文档交集视为同类。待处理不重复；忽略后 30 天内不再提；待处理超过 7 天自动当作忽略（提示条「一周不点自动消失」）。

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/topics/suggest-scan` | 入队 suggest job |
| GET | `/api/topic-suggestions` | 当前待处理建议 |
| POST | `/api/topic-suggestions/:key/accept` | 建主题 + 归属资料 + 入队 organize |
| POST | `/api/topic-suggestions/:key/dismiss` | 标记忽略 |

### 首页提示条

`--anchor` 淡底、`radius-md`：「💡 你最近 N 条资料都关于「X」。」[开个主题] [忽略]。accept 后跳 `/topics/:id`，空地图文案「正在长出地图…」。

### 收尾

- README 补四实体概念模型 + 路由说明
- `docs/dev-log.md` 追加 T20 / T16–T20 一句话
- 产品源码无「线程」残留；空状态按 §8 口语邀请（任务队列 / Agent 执行 / 用量 / 主题资料流）

## 真实 LLM 验收

`scripts/smoke-t20.sh` 自启 :3029 + worker，账号 `t20-smoke-*@inwit.local`。**21/21 PASS**。

5 篇未归属「Rust 所有权 / 移动 / 借用 / 可变借用 / 生命周期」全部 `digested` 后自动入队 suggest（约 5s）：

| 检查 | 结果 |
|---|---|
| GET `/api/topic-suggestions` | `topic_suggestion_rust-ownership-and-borrowing`，「Rust 所有权与借用」，4 篇 |
| accept | 主题建好，4/5 资料归属，organize 入队 |
| organize | 8 节点 · 7 卡 |

忽略路径：归档刚建的主题后投入 4 篇摄影构图资料 → suggest → 「摄影构图与光线基础」→ dismiss → 再扫描 GET 为空（30 天内不重复）。

### 浏览器（明暗）

CSI 真 Chrome，`http://127.0.0.1:5190`，账号 `t20-ui@inwit.local`。

1. 首页顶部黄底提示条，文案与按钮符合 §6.5；暗色 `--anchor` `#4A3F1F`、亮色 `#F3E3B3`
2. [忽略] 后提示条消失
3. [开个主题] 跳到 `/topics/:id`，按钮「整理中…」，空态「正在长出地图…」

截图：`docs/screenshots/t20-banner-light.png`、`t20-banner-dark.png`、`t20-accept-map.png`。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 282 modules |
| `pnpm --filter @inwit/server test` | 8 files / 64 tests 全绿 |
| 产品源码 `apps/*/src` `packages/dto/src` 搜 `线程` | 0 |
| `scripts/smoke-t20.sh` | 21/21 PASS |
| 浏览器提示条明暗 + 忽略/开题 | 过 |

## 改动文件

### dto / server
- `packages/dto/src/{topic,job}.ts`（建议 schema；`action=suggest` 可不带 topicId）
- `apps/server/src/topics/{suggest,suggest-logic,suggest.test,topic.routes}.ts`
- `apps/server/src/agent/{topic,digest,prompts,suggest-tools}.ts`
- `apps/server/src/jobs/{enqueue,queue}.ts`（enqueue 拆出，避免 suggest ↔ worker 循环依赖）
- `apps/server/src/errors.ts`

### web
- `apps/web/src/api/topics.ts`
- `apps/web/src/pages/home/{index.tsx,home.service.ts}`
- `apps/web/src/pages/{topics/detail,admin/index,admin/trend}.tsx`
- `apps/web/src/styles.css`

### docs
- `README.md` 概念模型 + 路由
- `docs/dev-log.md` T20
- `scripts/smoke-t20.sh`
