# Inwit — AI-First 知识管理应用 PRD

> 版本：v0.1（需求基线）
> 状态：待开发
> 技术基调：TypeScript 全栈 / 服务端优先 / pi-agent 作为 Agent 运行时

---

## 1. 产品定位

**一句话**：一个"只管往里扔、它替你消化、并催你复习"的学习伴侣。

- 用对话降低捕捉成本（不要求分类、打标签、选文件夹）
- 用 AI 把碎片内容加工成可复习的「原子卡片」
- 用间隔重复（SM-2 类算法）把复习变成推送驱动的每日队列
- 用复习反馈数据驱动 Agent 自进化，越用越懂用户

**差异化**：Notion/Obsidian 是"打开驱动 + 手动整理"，Anki 是"手动制卡 + 机械重复"。Inwit 是 **AI 制卡 + 推送驱动的复习闭环**。

**目标用户（MVP）**：技术学习者 / 备考人群（对"主动回忆"价值感知最强）。职场知识管理为二期人群。

---

## 2. 四大功能支柱

### 2.1 随手捕捉 —— 输入即聊天

- 主界面是一个对话框：粘贴笔记、论文片段，或直接提问（如"L1 和 L2 正则化啥区别"）
- 零整理成本：不要求分类 / 标签 / 文件夹
- 入口能力分阶段：
  - V0：纯文本（Web）
  - V0.5：Tauri 桌面端，系统级截图 + OCR 捕捉
  - V1：语音转文字、网页剪藏（浏览器插件）

### 2.2 AI 消化 —— 后台自动加工

- **异步执行**：用户粘贴后立刻返回，消化 Agent 在后台任务队列中运行
- 消化 Agent（基于 pi-agent-core 的 agent loop）职责：
  1. 把长内容切成「原子卡片」：一条概念 + 一个例子 + 一个易混点，独立可复习
  2. 自动打标签，建立知识关联（如「梯度消失」→「反向传播」「sigmoid」）
  3. 为每张卡片生成自测题：填空 / 对比题 / "这句话哪里错了"判断题
  4. 发现已学关联概念时，生成提示（"这和你第 3 周学的 X 是一回事的两种说法"）
- 用户直接提问时：AI 回答**自动**转为卡片进入复习队列（可撤销）
- 任务队列有管理后台，可见当前任务状态（pending / running / failed / done）

### 2.3 定时回忆 —— 推送驱动

- 每日「今日复习队列」：按间隔重复算法（SM-2 变体）排期，打开就刷，刷完即走
- 抽认卡交互：先看问题 → 主动回忆 → 翻面验证
- 三档反馈：**忘了 / 模糊 / 想起来了**，直接决定下次出现时间
- 队列来自真实遗忘曲线，不是固定计划表
- 积压策略：过期卡片合并入今日队列并按优先级重排，不清零惩罚（细节待定，见 §9）

### 2.4 反馈学习 —— 自进化飞轮

- 每次三档反馈都是一次对 Memory 的写入
- 模糊的概念：换种讲法重新出题
- 反复忘的概念：降难度、拆成更小的卡片
- 错误模式分析：识别高频混淆对（如"偏差 vs 方差"），自动生成对比专题
- 周报复盘：回忆成功率、知识图谱新增连接、建议重学的 3 个概念
- **基础层（卡片 + SM-2）不依赖 AI 即可运行**，AI 层只做增强

### 2.5 概念模型 —— 四个基本实体（第一性原理）

学习只有四个动作：输入 → 消化 → 记住 → 贯通。对应产品的四个实体，不多不少：

| 实体 | 动作 | 心智类比 |
|---|---|---|
| **资料**（Document） | 输入 | 课件、参考书、草稿纸。文档/闪念/PDF/剪藏/AI 回答都是资料的 source 类型 |
| **卡片**（Card） | 消化 | 原子知识单元，从资料消化而来，带出处锚点 |
| **主题**（Topic） | 贯通的方向 | 你给自己开的一门课：有目标、有资料、有卡片、有进度 |
| **关联**（Link） | 贯通的结构 | 卡片↔卡片、卡片↔资料（锚点）、资料/卡片↔主题（归属） |

复习不是实体，是卡片上的状态（SM-2 掌握度）。
**术语定稿：废弃"线程"，统一为"主题"**（thread→topic 全量改名，无兼容包袱）。

### 2.6 主题 —— 时间流管进，知识地图管组织

**主题不是文件夹，是 Agent 替你维护的一张知识地图。** 用户永远不整理资料。

- **时间流（进来的地方）**：资料按到达顺序流入主题（或未归属池），天然排序，零负担
- **知识地图（组织的地方）**：Agent 维护主题的概念大纲树；新资料消化时，卡片被挂到地图对应节点（或开新节点）。地图是主题的**主视图**，资料列表是辅助视图
- **空白节点**：地图上 Agent 标出"这门课里你还没碰的概念"（虚线态），点击可让 AI 生成入门卡片——这是复习之外的第二个学习驱动
- **主题可以由 Agent 提议诞生**：进化 Agent 发现未归属资料聚成一类时，首页提示「你最近 N 条资料都关于 X，开个主题？」，一键创建（含初始地图）

**主题规则**：
- 创建即一句话：标题 + 可选学习目标（写入主题级 Memory，锚定 Agent 行为）
- 一张卡**主要归属**一个主题（或未归属池），可被其他主题引用（不做多对多归属）
- 未归属资料由消化 Agent **自动软归属**（检索 pipeline + rerank），可撤销、可忽略——用户只有确认权，没有整理义务

### 2.7 文档与关联 —— 一切输入皆文档

**输入即文档**：所有输入都是 markdown 文档（tiptap 编辑器）。录入入口：主页 = 文档列表 + 顶部快捷捕捉条；编辑器是完整形态。消化 Agent 从文档切卡片，卡片记录**出处锚点**（文档 + 原文段落，逐字引用）。

**关联是双向的、可隐可显**：文档→卡片（锚点高亮）、卡片→卡片（关系边，Agent 隐性建、用户可见可删）、卡片→文档（出处回溯）、卡片/资料→地图节点（归属）。

**展示形态**：文档阅读页锚点高亮+侧滑卡片、卡片详情页出处+相关卡片、复习流「关联 N 张」轻提示、主题知识地图主视图。全局图谱视图留待以后。

**演进方向**：PDF 导入与标注——PDF 是一种新 source 的文档，标注即锚点，架构已兼容。

---

## 3. 自进化 Memory 架构

Memory 分三层，全部落库，Agent 可读可写：

| 层级 | 内容 | 消费者 |
|---|---|---|
| 用户画像 Memory | 学习目标、当前在学主题、语言习惯 | 消化 Agent（控制切卡详略） |
| 掌握度 Memory | 每个概念的遗忘曲线参数、错误模式 | 进化 Agent（换讲法 / 拆小 / 出专题） |
| 知识关联 Memory | 概念间关系边（"是一回事 / 是前置 / 易混淆"） | 关联提示 + 周报 |
| 主题 Memory（scope=topic） | 主题学习目标、知识地图版本、主题内掌握度 | 主题相关的一切 Agent 行为 |

---

## 4. 技术架构

### 4.1 总体分层（服务端优先）

```
┌────────────────────────────────────────────┐
│ 客户端：Web (Vite+React+rab-react)          │
│         Tauri 桌面端 (V0.5, 截图OCR)        │
│         React Native App (二期)             │
├────────────────────────────────────────────┤
│ 服务端 (Fastify + drizzle-orm)：            │
│   用户系统 / BYOK LLM 配置 / 捕捉 inbox     │
│   复习队列 / 任务队列管理后台 / 周报         │
├────────────────────────────────────────────┤
│ Agent 层 (全部收敛于 pi-agent-core)：        │
│   消化 Agent：扫描 inbox→切卡→出题→关联     │
│   进化 Agent：读复习反馈→更新 Memory        │
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

### 4.2 仓库结构（pnpm monorepo，参考 vital）

```
inwit/
├── apps/
│   ├── server/      # Fastify + drizzle + worker（参考 vital/apps/server）
│   ├── web/         # Vite + React + rab-react
│   └── desktop/     # Tauri（V0.5）
├── packages/
│   ├── dto/         # 前后端共享类型 + zod schema
│   ├── tsconfig/
│   └── eslint-config/
└── docs/
```

### 4.3 关键技术决策

| 决策点 | 结论 | 备注 |
|---|---|---|
| 数据归属 | 服务端为中心 | 桌面端离线仅缓存复习队列，联网回传反馈 |
| 服务端框架 | Fastify 5 + drizzle-orm | 复用 vital 的工程模式（worker.ts 独立进程跑队列） |
| Agent 运行时 | pi-agent-core 0.85.x | **所有 Agent 功能收敛于 pi-agent**：消化/进化 Agent 均为 pi `Agent` 实例，业务动作封装为 `AgentTool`（参考 vital `agent/harness.ts` + `agent/tools.ts`）；新能力一律以 pi-agent 插件扩展，不在 agent 体系外另写 LLM 调用 |
| 多供应商 LLM | pi-ai | 用户级 BYOK，支持 OpenAI/DeepSeek/Claude/智谱；key 加密存储（参考 vital `llm/crypto.ts` + `llm/store.ts`） |
| Embedding | 百炼 multimodal-embedding 接口，模型 `qwen3-vl-embedding`，**2560 维**，单批 ≤20 条 | 服务端直调，照抄 vital `retrieval/embedding.ts` |
| Rerank | 百炼 text-rerank 接口，模型 `qwen3.7-text-rerank` | 照抄 vital `retrieval/rerank.ts` |
| 向量检索 | Qdrant 1.19.x（自建） | collection 按环境拆分，cosine，2560 维 |
| 中文稀疏检索 | Meilisearch | 关键词召回 |
| 混合检索 | **Qdrant 语义召回 + Meili 关键词召回 → RRF 融合 → 百炼 rerank 精排**（完整复刻 vital `retrieval/pipeline.ts` 链路） | user_id 过滤在召回层强制 |
| 前端状态管理 | rab-react | 开发时参考 rab-react skill |
| 桌面端 | Tauri | 截图 + OCR |

### 4.3.1 Agent 插件体系（所有 Agent 功能收敛于 pi-agent）

统一约定：**不允许在 pi-agent 体系之外直接调 LLM**。所有智能行为都是一个 pi `Agent` 实例 + 一组 `AgentTool`。

```
┌─ 消化 Agent (digest) ─────────────────────────┐
│ tools: read_capture / write_cards /           │
│        write_questions / embed_and_index /    │
│        link_concepts / search_memories        │
├─ 进化 Agent (evolve) ─────────────────────────┤
│ tools: read_review_logs / read_mastery /      │
│        rewrite_card / split_card /            │
│        generate_quiz / write_memory           │
├─ 问答 Agent (chat, 对话框直接提问) ────────────┤
│ tools: hybrid_search / read_card /            │
│        write_capture (回答自动转卡片)          │
├─ 主题 Agent (topic) ──────────────────────────┤
│ tools: read_topic_memory /                    │
│        update_knowledge_map /                 │
│        suggest_gap / attribute_document       │
└────────────────────────────────────────────────┘
        共享底座：pi-ai BYOK 模型解析 + Memory 存取 + 检索 pipeline
```

- 每个 Agent 是后台任务队列里的一类 job（`jobs.type`），由 worker 进程调度执行
- Agent 的工具面最小化：只注入 DB / 检索 / Memory 句柄，不给 shell / fs（pi 无内置权限系统）
- 新能力（周报、专题生成、网页剪藏理解…）= 新 AgentTool 或新 Agent 定义，不改底座
- Memory 读写也走 AgentTool（`search_memories` 复用混合检索 pipeline）

### 4.4 环境配置（均通过 .env 注入，不入库）

- PostgreSQL：`222.128.65.91:25432`，超级用户 postgres
  - 两个库：`inwit_dev` / `inwit_prod`
- Qdrant：`http://222.128.65.91:16333`（api-key header）
- Meilisearch：`https://meilisearch.aimo.plus`
- DashScope（百炼）：embedding（qwen3-vl-embedding, 2560 维）+ rerank（qwen3.7-text-rerank）+ 默认系统模型

---

## 5. 数据模型草案（drizzle schema）

```sql
users               -- id, email, password_hash(argon2), created_at
llm_configs         -- id, user_id, provider, api_key(加密存储), model, is_default
topics              -- id, user_id, title, goal, status(active|archived), created_at
map_nodes           -- id, topic_id, parent_id?, title, status(uncovered|learning|covered),
                    --    note?, position, created_at   -- 知识地图大纲树节点
documents           -- id, user_id, topic_id?, map_node_id?, title, content_md,
                    --    source(editor|paste|chat|flash|pdf), status, answer?, created_at, updated_at
cards               -- id, user_id, document_id, map_node_id?, concept, example, confusion_point, tags[],
                    --    anchor_text, anchor_block, source(manual|agent|chat), created_at
card_links          -- id, user_id, from_card_id, to_card_id,
                    --    type(same_concept|confusable|prerequisite|related), origin(agent|user), created_at
card_questions      -- id, card_id, type(cloze|compare|judge), question, answer
review_states       -- id, user_id, card_id, ease, interval_days, due_at, reps, lapses, last_feedback
review_logs         -- id, user_id, card_id, feedback(forgot|fuzzy|remembered), reviewed_at
memories            -- id, user_id, scope(user|topic), scope_id?, layer(profile|mastery|association|topic_map), key, content, updated_at
jobs                -- id, user_id, type(digest|evolve|weekly_report|topic|chat), payload, status, run_at, finished_at
agent_executions    -- id, job_id, user_id, agent_type, status, started_at, finished_at,
                    --    steps(jsonb: 每步 tool 调用/入参摘要/结果摘要), error
llm_usage_logs      -- id, user_id, execution_id?, provider, model, capability(chat|embed|rerank),
                    --    prompt_tokens, completion_tokens, total_tokens, cost_estimate, created_at

# 注：V0 的 captures 表数据迁移进 documents 后废弃；cards.capture_id → cards.document_id
```

检索侧：
- Qdrant collection `inwit_cards_{env}`：vector=卡片正文 embedding(2560)，payload={card_id, user_id, tags}
- Meilisearch index `inwit_cards_{env}`：concept + example + confusion_point + tags
- 检索链路：Qdrant 语义召回 ∪ Meili 关键词召回 → RRF 融合 → 百炼 rerank 精排（复刻 vital retrieval pipeline）

---

## 6. MVP 范围（V0）

| 模块 | 做 | 不做 |
|---|---|---|
| 捕捉 | Web 对话框：文本粘贴 + 直接提问 | 语音 / OCR / 剪藏 |
| 消化 | 异步切卡 + 出题 + 打标签 + 任务后台 | 图谱可视化 |
| 学习主题 | 创建/切换主题、主题内捕捉、自动软归属（可撤销） | 知识地图活文档、盲区提示（V1） |
| 回忆 | 今日队列 + 抽认卡 + 三档反馈（SM-2） | 多端同步 |
| 反馈 | 反馈驱动排期 + 模糊换讲法重出题 | 错误模式专题、周报 |
| 平台 | 多用户 + BYOK（四供应商） | 移动端 |
| 管理后台 | 任务队列看板 + Token 用量看板 + Agent 执行明细看板 | 成本告警、预算限额自动熔断（V1） |

**V0.5**：Tauri 桌面端（截图 OCR 捕捉）
**V1**：进化 Agent 完整版（错误模式分析、周报）、关联提示、网页剪藏、语音
**V2**：React Native App、知识图谱可视化

---

## 7. 非功能需求

- **隐私/安全**：用户 LLM key 加密存储；pi-agent 无权限系统，agent 工具面最小化（只给 DB/检索句柄，不给 shell/fs）
- **离线**：复习队列每日预取到客户端本地，离线可刷，联网回传
- **成本**：消化 Agent 异步批处理；对用户提问设每日额度（具体数值待定）
- **可观测 / 管理后台**（三个看板，参考 vital `usage.service.ts` / `executions.service.ts` / `metrics.service.ts`）：
  1. **任务队列看板**：job 列表 + 状态（pending/running/done/failed）+ 重试/取消
  2. **Token 用量看板**：按用户 / 供应商 / 模型 / capability(chat·embed·rerank) 维度聚合，日/周/月趋势，成本估算——每次 LLM 调用落 `llm_usage_logs`
  3. **Agent 执行明细看板**：每次 agent 执行落 `agent_executions`，可下钻查看每一步 tool 调用（入参摘要 → 结果摘要 → 耗时）、最终产出（切了几张卡 / 写了哪些 memory）、失败原因——支撑"AI 制卡质量抽检"和 badcase 回溯

---

## 8. 成功指标（MVP）

- 次日复习队列打开率（核心留存指标）
- 每张捕捉 → 卡片的转化率、卡片采纳率（用户不删卡比例）
- 回忆成功率（三档反馈分布）
- AI 制卡质量：人工抽检通过率

---

## 9. 待拍板问题

1. 复习队列积压的合并/降级策略细节
2. 免费额度与成本控制模型
3. Tauri 端 OCR 方案（系统 API vs 云 OCR）
4. 周报推送通道（邮件 / 应用内）
