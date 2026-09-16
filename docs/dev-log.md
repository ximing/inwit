# Inwit 开发日志

按任务归档。完整 prompt 仍在 `docs/tasks/tN.md`（开发历史，保留不动）。当时的验收简报仍在 `docs/tasks/tN-report.md`，正文已整合到本文件。

---

## T1 脚手架

pnpm monorepo 骨架：`apps/server`（Fastify 5，端口 3020，`GET /health`）、`apps/web`（Vite + React 19 + `@rabjs/react`，端口 5190，`/api` 代理 3020）、`packages/dto`（zod 占位）。`pnpm install` / `typecheck` / `build` 全绿。dto 与 drizzle schema 当时还是空的。

## T2 drizzle schema + 迁移

12 张表落到 `inwit_dev`：users、llm_configs、threads、captures、cards、card_questions、review_states、review_logs、memories、jobs、agent_executions、llm_usage_logs。枚举用 `varchar` + `CHECK`。DTO 与表对齐。遗留：`captures.answer` 未建列（留给 T9）；job 无独立 `cancelled` 状态。

## T3 认证 + BYOK LLM

注册 / 登录 / 登出 / `GET /api/auth/me`。Access + Refresh JWT 写 httpOnly cookie，不落库；access 过期时用 refresh 静默换发。LLM 配置 CRUD + 设默认 + 连通测试；key 加密存储（`v1:` 前缀），对外只给 `apiKeyPreview`。系统兜底 DashScope `qwen-plus`。

## T4 捕捉 inbox + 线程 + 任务队列

`POST /api/captures` 写 `type=text` 并入队 `jobs(type=digest)`，立即返回。线程 CRUD / 归档。Worker 独立进程，PG `FOR UPDATE SKIP LOCKED` 领取，失败 3 次退避。消化处理器当时是 stub。删捕捉保留卡片（`capture_id SET NULL`），取消仍 pending 的 digest。

## T5 检索 pipeline + 消化 Agent

Qdrant 语义 ∪ Meili 关键词 → RRF → 百炼 rerank。消化 Agent 是 pi-agent-core loop：`read_capture` / `search_user_memories` / `write_cards` / `write_questions` / `attribute_thread`。真实 LLM，不 mock。实测梯度消失材料约 18s，2 卡 4 题。Meili 从 PRD 的 aimo.plus 改到与 Qdrant 同机（公开 key 已 403）。

## T6 复习队列 SM-2

`scheduleReview`：forgot→1、fuzzy→3、remembered→5。今日队列 `due_at <= 今天结束`。反馈写 `review_logs` 并更新状态；fuzzy 或连续 forgot（lapses≥2）入队 evolve stub。新卡默认次日到期。`write_cards` 同步建 `review_states`。vitest 覆盖 SM-2 分支。

## T7 Web 前端

登录/注册、捕捉时间线（线程切换、粘贴消化、3s 轮询）、复习抽认卡三档反馈、线程页、设置 BYOK、后台入口。认证走 cookie，前端不碰 token。海军侧栏 + 冷灰纸面 + 灯色主按钮。

## T8 管理后台三看板

`/api/admin/jobs`、`/usage/summary`、`/executions`（按当前登录用户过滤，无独立 admin 角色）。前端三个 tab：任务队列（可重试失败任务）、Token 用量（汇总 + 手写 SVG 折线）、Agent 执行明细（steps 时间线）。

## T9 问答 Agent + 收尾

见 `docs/tasks/t9-report.md`。`POST /api/chat` → `captures(type=chat)` + `jobs(type=chat)`；worker 跑问答 Agent（`search_cards` / `write_cards` / `write_questions`），回答写入 `captures.answer`，知识点落 1–3 张卡并立即进入今日复习。捕捉页以问号结尾或点「问 AI」走这条链路。根 README 与本开发日志一并补齐。

## T11 documents + card_links（captures 退役）

见 `docs/tasks/t11-report.md`。`captures` 整表迁入 `documents`（同 uuid；`text→paste`、`chat→chat`），`cards.capture_id` 改为 `document_id` 并加 `anchor_text` / `anchor_block`。新表 `card_links`。API：`POST/GET/DELETE /api/documents`，digest 工具 `read_document`，payload `{documentId}`（历史 `captureId` 可回退）。`GET /api/cards/:id/links`、`DELETE /api/card-links/:id`。行数 12=12，卡片无孤儿。

## T12 设计系统落地

见 `docs/tasks/t12-report.md`。tokens / 双主题 / 220px 侧栏骨架。主界面仍是时间线，T13 换成文档列表。

## T13 文档主页 + tiptap

见 `docs/tasks/t13-report.md`。首页改为文档列表 + 快捷捕捉条；`/editor/new|:id` tiptap 纸面编辑（首行 H1 作标题、浮动工具条、⌘S / 2s 自动保存）；`PUT /api/documents/:id`；`/captures` 回 `/`。阅读页 `/doc/:id` 先做纸面 markdown，锚点留给 T14。

## T14 消化 Agent v2 + 阅读页锚点

见 `docs/tasks/t14-report.md`。`write_cards` 必填 `anchor_text` / `anchor_block`；新工具 `link_cards`（origin=agent + reason）。阅读页 `/doc/:id`：批注黄锚点、点击右侧滑出卡片。`GET /api/cards/:id/links` 带 reason。

## T15 卡片详情 + 复习重构 + 视觉收尾

见 `docs/tasks/t15-report.md`。`GET /api/cards/:id` + `/cards/:id` 详情（出处回跳 `?anchor=`、相关卡片分组、复习状态）。复习页 560px 纸面、rotateY 翻面、关联轻提示、顶部 2px 进度条。空状态按 §8 重写；后台视觉降为「任务与用量」。

## T16 全量改名 thread → topic

见 `docs/tasks/t16-report.md`。表 `threads`→`topics`，外键 `thread_id`→`topic_id`，Memory `scope=topic` / `layer=topic_map`，job/agent 类型 `topic`。API `/api/topics`，前端 `/topics`，侧栏与文案统一「主题」。无兼容层。

## T17 知识地图数据模型 + API

见 `docs/tasks/t17-report.md`。新表 `map_nodes`（自引用三级树），`cards` / `documents` 加 `map_node_id`。地图 CRUD + 挂卡/挂资料 + summary。节点 status 按该节点卡片 `last_feedback=remembered` 占比自动重算（无卡 uncovered，<80% learning，≥80% covered）。

## T18 主题 Agent —— digest 挂地图 + 整理 + 空白节点

见 `docs/tasks/t18-report.md`。digest 新增 `read_topic_map` / `place_on_map`（优先挂已有节点）。`POST /api/topics/:id/map/organize` 入队 `jobs(type=topic, action=organize)`，主题 Agent 输出完整大纲树，已挂载卡/资料零丢失，空白节点标「该学还没学」；前后快照写入 `memories(layer=topic_map)`。`POST /api/map-nodes/:id/fill` 为空白概念生成 1–2 张入门卡并进今日复习。真实 LLM 冒烟 23/23：digest 5 卡全挂上；organize 5→5、11 节点 6 个空白；fill 2 卡进队列。

## T19 主题页重构 —— 知识地图主视图

见 `docs/tasks/t19-report.md`。`/topics/:id` 改为地图主视图：衬线标题 + 2px 覆盖率条 + 地图/资料流 tab。大纲树按 §6.5（40px 行、20px 缩进、10px 状态点、折叠记 localStorage）。空地图「让 AI 整理一张地图」；空白节点「让 AI 补」。主题列表加覆盖率条；复习轻提示带主题·节点路径。

## T20 Agent 提议开主题 + 收尾

见 `docs/tasks/t20-report.md`。未归属资料近 30 天 ≥4 条聚成一类时，进化/主题 Agent 写入 `memories(scope=user, layer=profile, key=topic_suggestion_<slug>)`。digest 完成未归属文档后轻量入队 `jobs(type=topic, action=suggest)`，也可 `POST /api/topics/suggest-scan`。`GET /api/topic-suggestions` 待处理建议；accept 建主题、归属资料并自动 organize；dismiss 后 30 天内不再提。首页 `--anchor` 淡底提示条「💡 你最近 N 条资料都关于「X」」。README 补齐四实体概念模型。

## T21 进化 Agent 核心

见 `docs/tasks/t21-report.md`。每次复习反馈 upsert `memories(scope=user, layer=mastery, key=card:<id>, recent≤5)`，不改 SM-2。fuzzy 入队 evolve 换题型追加 1 道新题；连续 forgot（lapses≥2）入队 `reason=repeated_forgot`，拆 1–2 张子卡（次日到期、related「由原卡拆小」、原卡保留）。pi-agent 工具：`read_card` / `write_questions` / `split_card` / `write_memory` / `link_cards`。

## T22 错误模式分析

见 `docs/tasks/t22-report.md`。`jobs(type=evolve, action=analyze_patterns)`：当日 forgot+fuzzy ≥3 且近 30 天困难卡 ≥2 张时自动入队（带日期去重，15s 防抖），也可 `POST /api/evolve/analyze`。pi Agent 读困难卡 → confusable 边 + `memories(key=confusable:<a>+<b>)` → 最多一篇 `documents.source=agent` 对比专题，2–3 张对比卡进今日复习。同一对 30 天内不重复出专题。

## T23 周报复盘

见 `docs/tasks/t23-report.md`。`jobs(type=weekly_report)`：worker 启动/每小时扫描，本周（周一起）还没有 done/pending 且本周有学习活动则入队；也可 `POST /api/reports/weekly/generate`。pi Agent 用 SQL 统计写一篇「M/D–M/D 学习复盘」（`source=agent`）并记 mastery memory。首页 `--anchor` 提示条跳进文档；阅读页「AI 复盘」徽标；建议重学带 `/cards/:id` 链接；复习完成态「本周复盘 →」。

## 2026-09-14 UI/UX 大重构（rewrite T1–T8）

范围：路由收敛、复习设置/统计、任务队列接口、设计系统重写。设计稿在 `docs/design/v2/`。

- **复习设置 / 统计**（T1）：`users.review_settings` jsonb；`GET/PUT /api/review/settings`（无记录返回默认：每日上限 20、新卡 5、ease 2.5、fuzzyScale 1.2、learningSteps `[1,3,6]`）。非法 body 走统一校验，`400 VALIDATION_ERROR`。SM-2 按用户设置参数化；今日队列尊重每日/新卡上限，`ReviewToday.truncated` 记被顺延张数。`GET /api/review/stats` 在 `last7Days` / `overdueCount` 之上扩展 `streak`、`totalCards`、`masteredCount`、`retention7d`、`reviews7d`、`daily`、`forecast`。
- **任务队列接口**（T2）：`GET /api/jobs/queue`（running / pending / counts）、`GET /api/jobs/usage`（近 7 天 daily + byType + total）。`Job` 增加人类可读 `summary` / `description`；queue 条目另带 `startedElapsedSec` / `scheduledFor`。原 `GET /api/jobs`、retry、cancel 仍在。
- **路由收敛 + 设计系统**（T3）：rail 六项——首页 `/`、文档 `/docs`、复习 `/review`、主题 `/topics`、任务 `/jobs`、设置 `/settings`。`styles.css` 按 v2 tokens 重写，lucide-react 图标。旧路由重定向：`/doc/:id`→`/docs?doc=`，`/editor`→`/docs?edit=1`，`/card` `/cards`→`/review`，`/admin` `/captures`→`/jobs`。
- **前端换皮**（T4–T7）：Today / Docs 工作台 / 复习中心 / 主题 / 任务页 / 设置按 mockup 落地。任务页走 queue + usage，不再挂 `/admin`。
- **收尾**（T8）：`scripts/smoke-t21.sh` 19/19、`smoke-t22.sh` 22/22、`smoke-t23.sh` 22/22（无残留 worker 时 `pgrep` 在 pipefail 下会误退出，已补 `|| true`）；新增 `scripts/smoke-t24.sh` 覆盖 settings / stats / queue / usage。`docs/regression-v0.md`、README 路由表同步。

## T24 PDF 原生预览 + 批注 + 扫描版 OCR

见 `docs/tasks/t24-report.md`。一份文档两种视图：`contentMd` 仍是 digest / 检索 / 锚点真相，PDF 原件作 S3 展示附件。导入改 S3 分片直传（5MB/片，天花板 2GB）；`extract` / `ocr` 异步 job，扫描版走独立 `ocr_configs` + qwen-vl-ocr 逐页 Chat API（pdfjs-dist + @napi-rs/canvas 拆页）。阅读页 EmbedPDF v2.15.0 pin，自有批注格式经 `annotation-adapter.ts` 隔离；PDF 强制预览以保护页锚点。框选转卡走同步 `POST /api/cards`（`imageKey`），不走 selection job。回归修了三件事：vite `?url` 根相对路径在 blob worker 里 fetch 失败、unpdf 污染 `globalThis.pdfjsWorker` 与 pdfjs-dist 冲突、CDP `pointercancel` 不触发 `endSelection`（另有 zoom 0 尺寸闸死 viewport）。截图 `docs/screenshots/t24-*.png`。

## T21–T23 一句话

进化 Agent 闭环收尾：反馈写 Memory + 换讲法/拆卡（T21），混淆对对比专题（T22），周报复盘文档 + 首页提示条（T23）。

## T16–T20 一句话

从「线程」改成「主题」，再长出知识地图：全量改名（T16），地图数据（T17），Agent 整理/补空白（T18），地图主视图（T19），未归属资料成簇时 Agent 提议开主题（T20）。

## T11–T15 一句话

产品从捕捉时间线切到「文档是土壤、卡片是单元」：库表迁 documents + card_links（T11），纸感双主题（T12），文档列表/编辑器（T13），锚点+关联（T14），卡片详情/复习翻面/全站收尾（T15）。
