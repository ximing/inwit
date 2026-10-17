# 概念与关系开发任务计划

版本：v3（2026-10-15，双视图方案及 SubAgent 审查修订）。

> 执行说明：已获授权并执行 M0/T0 原型与设计走查；M1（T1–T4）、M2（T5）、M3（T6）已实现；M4（T7a/T7/T8/T8a/T8b/T9 产品闭环）已实现核心闭环并通过浏览器验证（2026-10-16），交付记录见文末。M5 未启动。后续获得业务开发指令后使用 superpowers:executing-plans 逐任务执行；如用户明确选择委派，再使用 superpowers:subagent-driven-development。步骤以复选框跟踪，不预先标记完成。

**目标：** 在文章统一学习工作区完成生成、确认、双视图对照、管理和复习闭环；主题页汇总跨文章知识。

**架构：** 增加独立概念、关系、证据与候选批次领域模块。Agent 仅生成候选，确认事务保存知识；练习绑定到现有卡片和复习状态。旧图谱与旧客户端接口保留。

**技术栈：** 当前仓库 React 19、@rabjs/react、Fastify、PostgreSQL/Drizzle、Zod、pi-agent-core、Vitest；首版 SVG 图，不增加图数据库。

**规格：** [需求方案](01-requirements.md)、[技术方案](02-technical-design.md)。执行前必须同时阅读；本文件中的文件路径标注「新增」的是计划路径。

## 全局约束

- 本轮仅执行已授权的 M0；不修改业务代码、不迁移、不部署、不提交或推送 Git。M1 以后须另行授权。
- Web/桌面完成新体验；移动端首版升级复习协议2但不增加概念专用UI；旧客户端仅领取普通未受管理卡。
- 概念与关系先保存、练习显式加入；生成结果必须经预览确认才成为正式知识。
- 默认5–12个概念、最多20条关系；硬上限30概念/60关系；总文本最多60,000 Unicode字符，分片目标8,000字符。
- 候选推断关系默认不选；用户确认后保留 inferred 标记。
- 所有知识目标同用户同主题；复习继续按 cardId 排期；同目标同练习类型幂等。
- 正文变化使批次过期；不得强制提交过期结果。并发编辑使用整数版本。
- 首版不自动迁移历史卡片，不跨主题合并，不新增复习算法，不升级依赖。
- 每项任务完成自己的测试与自检；提交仅包含本任务文件。未来执行如需 commit，应遵循当时的分支和用户要求，不将下列清单视为本次提交授权。

- 文章工作区支持 outline/concepts/compare；脑图和概念图保持独立结构，概念图允许合法多节点环。
- 同一学习卡在脑图、知识详情和复习中共用 cardId；多个导航关联至多一个主要练习目标，首版固定绑定实际首题。
- 手动暂停与知识阻断独立；普通恢复不绕过资格校验。受管理卡强制reviewToken，解绑后仍保留版本保护。
- 知识表现只计当前binding/epoch/targetVersion的新反馈，不继承旧卡历史。
- 当前画布最多50节点，边按完整可见集合独立分页，不能因节点跨页漏边。
- 默认联动只高亮；显式定位才改变对方视口/展开状态，支持返回定位前状态。
- 独立保存正文、两图、详情、布局、候选及表单状态；业务同步不重置视口、不覆盖输入。
- 脑图局部关系浮层仅作方案验证和后续扩展；首版不实现完整混合图。

## 重点风险及归属

| 输入/条件 | 合理预期 | 测试归属 |
| --- | --- | --- |
| 相同术语在两篇文章中含义不同 | 能并列保存，不强行合并 | T2、T4、T7 |
| 生成后原文修改、重复引文、来源删除 | 拒绝旧提交；不跳错位置；保留摘录 | T3、T4、T8 |
| 双击确认、worker 重试、两个标签并发确认 | 不重复建知识，不覆盖编辑结果 | T4、T5 |
| 只记住概念定义、关系仍模糊 | 独立练习记录，无错误掌握聚合 | T6、T9 |
| 归档或更新后旧页面提交反馈 | 被暂停的练习不能继续记分 | T6、T10 |

新增重点风险：本文说明误写共享定义（T2、T7a）；已有卡绑定复制排期（T6）；合法环被树布局拒绝（T8）；联动递归和抢视口（T8b）；隐藏区零尺寸、跨路由刷新及草稿冲突（T8a）；本文解除引用误删共享知识（T7a、T10）。各任务必须覆盖对应测试。

## 文件责任划分

| 计划新增目录/文件 | 责任 |
| --- | --- |
| `packages/dto/src/concept.ts` | 正式实体、列表、图、CRUD 输入输出 |
| `packages/dto/src/concept-batch.ts` | 候选、决定、状态、提交契约 |
| `packages/dto/src/concept-practice.ts` | 绑定、练习建议、练习确认契约 |
| `apps/server/src/concepts/concept.service.ts` | 概念/关系 CRUD、归档及权限 |
| `apps/server/src/concepts/concept-identity.ts` | 名称规范化、匹配建议、关系身份 |
| `apps/server/src/concepts/concept-evidence.ts` | 快照、引文验证及定位解析 |
| `apps/server/src/concepts/concept-batch.service.ts` | 批次生命周期及持久化 |
| `apps/server/src/concepts/concept-commit.ts` | 候选原子确认与幂等 |
| `apps/server/src/concepts/concept-practice.service.ts` | 创建/暂停/更新练习绑定 |
| `apps/server/src/concepts/concept.routes.ts` | 概念、关系、批次、练习路由注册 |
| `apps/server/src/agent/concept-extract.ts` | 提取任务处理与结构化候选 |
| `apps/server/src/agent/concept-practice.ts` | 练习建议生成，返回候选而不建卡 |
| `apps/server/src/agent/conversation-concept-tools.ts` | 对话中请求生成候选 |
| `apps/web/src/api/concepts.ts` | 上述 HTTP 调用与 DTO 使用 |
| `apps/web/src/features/concepts/` | Service、编辑器、预览、图、详情、复习预览 |
| `apps/server/src/concepts/document-knowledge.service.ts` | 本文知识成员、说明、范围查询、位置解析 |
| `apps/server/src/concepts/card-knowledge.service.ts` | 卡片多目标导航链接、同用户校验 |
| `apps/web/src/features/study-workspace/` | 工作区布局、状态、脑图adapter、双向联动 |

现有挂接点：`db/schema.ts`、`app.ts`、`jobs/processors.ts`、`jobs/queue.ts`、`agent/conversation.ts`、共享 job/agent/sync DTO、文档顶栏和选区工具栏、主题详情、复习服务和页面。不要求拆分无关既有模块。

## 阶段与依赖

| 阶段 | 任务 | 可验收产物 |
| --- | --- | --- |
| M0 交互校准 | T0 | 对照与局部联系比较、布局基线 |
| M1 知识基础 | T1 → T2 → T3 → T4 | 手工创建、来源追溯、候选确认事务 |
| M2 文章生成 | T5，依赖 T1–T4 | 按文章生成可恢复候选，Agent 与按钮同一路径 |
| M3 学习载体 | T6，依赖 T1–T3 | 概念/关系可独立进入现有复习 |
| M4 产品闭环 | T7a → T7 → T8 → T8a → T8b → T9，依赖后端接口及T0 | 文章管理、共享卡、双视图、状态与复习 |
| M5 发布保障 | T10 → T11 | 同步、兼容、端到端与上线检查 |

以上描述依赖关系，不自动安排并行代理。顺序执行也可完成全部工作。

## T0：任务原型与布局基线

**状态：M0 原型及设计走查已交付；真实键盘/辅助技术待补，不标记为全面验收。** 未启动 M1。

**文件：** 扩展 `docs/design/prototypes/concept-relations.html`，本地样式、数据、脚本、README和截图在相邻 `concept-relations-m0/`；[评估记录](04-m0-evaluation.md)；已同步需求第8节与技术6.1。

**产出：** 同数据 A/B 交互原型、三视口设计走查、空间/排列/联动基线。本任务没有建立第二套生产图模型。

- [x] 准备8章、20处划线、15张卡、12概念和18关系的受控示例；明确非真实文献/用户数据。
- [x] 两版分别保存状态，五类任务在三个视口均执行：找区别和出处、三章定位、修改返回、候选确认、复习返回。共享卡编辑同步、默认高亮不移动、定位返回与新增不fit有浏览器断言。
- [x] 1440×900、1920×1080、390×844截图、路径、可读区域及页面横向溢出已记录。无真实用户，明确为设计走查；耗时、误选与用户缩放次数记为未测，不编造数据。
- [x] 校准布局：正文默认32%；宽屏可三栏，笔记本上下双图，窄屏聚焦；按可用宽高保留偏好；360/320×260仅为保护下限。依据及未验证边界已同步文档。
- [x] 验证刷新草稿/阅读锚点、列表/详情滚动、候选依赖取消和草稿、独立相机、删除焦点/正文变化回退。
- [ ] 真实键盘 Tab/方向键、读屏器及触屏走查。当前仅DOM键盘事件断言通过；CSI真实输入未到达页面，不宣称此项通过。

后续用户测试与正式容器适配仍须检验密集全图、不同字体、缩放和断点边界。本次停止于M0，不将这些局限当作M1开发授权。

## T1：领域契约、数据库与迁移

**状态：已完成（M1，2026-10-16）。** 迁移 `0043`（M2 重新生成后为 `0043_dazzling_lorna_dane`）；DTO 三个新文件已建并构建；表结构含练习绑定/版本/反馈归属的预留列（cards.review_revision、review_logs 归属字段、concept_practice_bindings/proposals），绑定写入口留给 T6。

**文件：** 新增三个 DTO 文件；修改 `packages/dto/src/index.ts`、`job.ts`、`agent.ts`（实际 job DTO 名称在开工时核对）、`apps/server/src/db/schema.ts`；新增 Drizzle 自动编号迁移及配套元数据。新增 `apps/server/src/concepts/concept-schema.test.ts`。

**接口：** 产出 Concept、ConceptRelation、ConceptEvidence、ConceptBatch、ConceptDraft、CommitConceptBatchInput、ConceptPracticeBinding 及对应 Zod schema；补充 DocumentKnowledgeRef、ConceptNote、CardKnowledgeLink、KnowledgeLocation 契约；字段以技术方案为准。新增正式表、notes、batches、bindings、document_knowledge_refs、card_knowledge_links、幂等记录及练习建议结果存储；增加topic图版本、card复习版本和review_logs可空绑定归属字段；绑定含questionId/epochId/endedAt/resumeRequired。

- [x] 编写 schema 测试：第31个概念/第61条边拒绝；引用联合类型不能混用；字符串限制按 Unicode 字符；练习目标必须恰一非空。（`concept-schema.test.ts`，判别联合各 arm 为 strict object）
- [x] 在隔离测试库验证复合外键：跨用户/跨主题端点拒绝、自环拒绝、关系身份唯一、来源 documentId 删除置空；文档引用/卡片导航链接目标恰一、重复唯一、同用户隔离。（`concept-db.test.ts`，真实 PG 隔离 schema）
- [x] 实现 DTO、表定义和迁移，补 job/agent 枚举数据库 CHECK；migration 编号依据最新仓库生成。（0043，jobs/agent_executions CHECK 含 concept_extract/concept_practice）
- [x] 验证从当前版本迁移以及重复 migrate 的正常行为；旧卡片、旧复习日志行数和内容保持一致。（隔离 schema 全量迁移冒烟 + 旧行形状兼容断言；重复应用由 testkit 每次新建 schema 间接覆盖）
- [x] 运行 `pnpm --filter @inwit/dto build`、`pnpm --filter @inwit/server test -- src/concepts/concept-schema.test.ts`，应通过；提交前检查仅含本任务变更。

## T2：手动创建、关系 CRUD 与去重身份

**状态：已完成（M1，2026-10-16）。** `concept.service.ts`/`concept-identity.ts`/`concept.routes.ts` 已实现并注册到 app.ts；所有路由受 `CONCEPTS_ENABLED`（默认 false）门控。

**文件：** 新增 `concept.service.ts`、`concept-identity.ts`、`concept.routes.ts` 及对应测试；修改 `apps/server/src/app.ts` 注册路由。

**消费：** T1 正式实体 DTO/表。

**产出：** `normalizeConceptName(value: string): string`、`findConceptMatches(userId, topicId, input): Promise<ConceptMatch[]>`、`saveConceptBundle(userId, topicId, input): Promise<ConceptBundleResult>`、`getConceptGraph(userId, topicId, query): Promise<ConceptGraphPage>`，以及技术方案 CRUD 路由。

- [x] 编写身份测试：空白/大小写规范化保留原展示名；同名不同 sense 可建两条；别名只推荐不直接合并；关系语境不同保持两条。
- [x] 编写真实 DB 事务测试：手动新建两端及关系任一步失败全部回滚；重复 bundle requestId 返回同一结果；不同 body 同 key 返回409。（伪造引文注入回滚断言）
- [x] 实现 CRUD、版本冲突409、归属404、软归档、节点分页、显式可见集合的边分页及名称/别名检索；复合端点约束不只依赖前端。（游标使用数据库精度时间戳，避免同毫秒跨页重复）
- [x] 编写路由测试：归档主题拒绝写入；分页最多100列表/50图节点；图/view按完整可见nodeIds返回边，外部邻居有展开提示。补第一页A/第二页B的A→B及跨页环，验证100边分页完整；节点范围或graphRevision改变时旧cursor返回409。（graphRevision 变化与可见集合变化均覆盖；邻居数量为 neighborCount 字段）
- [x] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-identity.test.ts src/concepts/concept.service.test.ts src/concepts/concept.routes.test.ts`，所有上述断言通过。

## T3：正文快照、证据核验与来源跳转

**状态：已完成（M1，2026-10-16）。** 纯逻辑在 `concept-evidence-logic.ts`（hash、引文核验、定位解析），IO 在 `concept-evidence.ts`；新增 GET `/api/concept-evidence/:id/resolve`。

**文件：** 新增 `concept-evidence.ts`、`concept-evidence.test.ts`；定点复用当前文档块/纯文本工具；补充来源解析路由。

**消费：** T1 Evidence/locator；T2 ownership 检查。

**产出：** `snapshotConceptSource(userId, documentId, scope): Promise<ConceptSourceSnapshot>`、`validateEvidence(snapshot, evidence): EvidenceValidation`、`resolveConceptEvidence(userId, evidenceId): Promise<EvidenceResolution>`。新增 GET `/api/concept-evidence/:id/resolve`，返回 resolved/stale/unavailable 及可用定位。

- [x] 测试正文一致而标题变化 hash 不变；正文变化 hash 改变；空文、未提取 PDF 和60,001字符分别产生可识别错误。（另验证恰好 60,000 字符通过）
- [x] 测试真实引文通过、虚构引文拒绝；重复引文无唯一上下文时返回 stale，不能选第一个匹配。（含块内重复 + 前后缀消歧）
- [x] 实现块/页快照、范围校验、长块切片偏移和覆盖清单；60,000字符以内每个处理范围都能映射回出处。（快照含 coverage 清单；长块切片供 M2 分片使用，M1 不做模型分片）
- [x] 测试文档软删除/硬删除后 unavailable；引用摘录仍在但跳转禁用；跨用户 evidenceId 返回404。
- [x] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-evidence.test.ts`，所有断言通过。

## T4：候选生命周期、确认与并发幂等

**状态：已完成（M1，2026-10-16；生成入口在 M2 接通）。** `concept-batch.service.ts`/`concept-commit.ts` 已实现。M1 时 `createConceptBatch` 固定返回 501；M2/T5 已替换为真实创建+入队实现。ready 批次仍可由测试夹具（`testkit/fixtures.ts` 的 `seedReadyConceptBatch`）构造。

**文件：** 新增 `concept-batch.service.ts`、`concept-commit.ts`、各自测试；扩展 `concept.routes.ts`。

**消费：** T1 Draft/Decision；T2 bundle 身份策略；T3 正文 hash 与证据校验。

**产出：** `createConceptBatch(userId, documentId, input): Promise<{batchId,jobId}>`、`updateConceptDraft(userId, batchId, input): Promise<ConceptBatch>`、`commitConceptBatch(userId, batchId, input): Promise<ConceptCommitResult>`。

- [x] 编写 ready→committed 状态测试；非 ready 拒绝；expectedDraftRevision 或正文 hash 变化返回409；inferred 未确认返回422。
- [x] 编写选择依赖测试：取消节点却保留依赖边返回422；reuse 不替换主定义，追加 notes 和证据；same-name 不默认 reuse；接受结果同事务创建本文引用，回滚时不留孤立引用。
- [x] 实现批次、幂等记录、topic/batch 行锁、临时ID映射、关系唯一性与单事务提交结果保存。（commit 幂等锚定批次的 commitRequestHash/commitResult；bundle 幂等锚定 concept_operation_requests）
- [x] 用两个真实 DB 连接同时确认同一批次，断言只生成一份实体和相同响应；不同批次同一关系补证据不重复；失败注入后无半成品。（同一 Pool 两条并发事务各持独立连接）
- [x] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-batch.service.test.ts src/concepts/concept-commit.test.ts`。数据库测试不得以 mock transaction 代替。

## T5：文章 Agent 智能生成与对话接入

**状态：已完成（M2，2026-10-16）。** processor 为 `agent/concept-extract.ts`（固定模型替身测试）；生成入口 `POST /api/documents/:id/concept-batches` 已接通（202 返回 batchId/jobId）；对话工具 `propose_article_concepts` 已注册。未运行真实模型抽样（见文末 M2 交付记录）。

**文件：** 新增 `agent/concept-extract.ts`、`agent/concept-extract.test.ts`、`agent/conversation-concept-tools.ts` 及测试；修改 `jobs/processors.ts`、`jobs/queue.ts`、`jobs/cancel.ts`、`agent/conversation.ts`，扩展对话动作 DTO（定位实际文件后修改）。

**消费：** T3 source snapshot；T4 批次生命周期；现有 runAgentJob、enqueueJob。

**产出：** `processConceptExtract(job: JobRow): Promise<void>`；工具 `propose_article_concepts({documentId,topicId,scope})` 返回 batchId/jobId；对话动作卡打开批次，不携带正式写入权限。

- [x] 建立固定夹具：术语密集、无术语、同名异义、跨篇重复、恶意文章指令、超长文、PDF 文本、无效JSON八类输入。（恶意指令用确定性替身验证「原文只作为分片数据、无额外表写通道」；真实模型对注入的抵抗力需人工样本评审）
- [x] 测试生成期不写正式 concepts/relations/cards；原文支持项必须通过引用检查；推断默认未选；自环和悬空引用拒绝。（伪造引文丢弃+降级 inferred；悬空/越权端点丢弃计数；schema 层重复 tempId/自环拒绝）
- [x] 实现8,000字符分片、汇总、匹配建议、一次格式修复和硬限错误；所有范围显示 coverage，无结果也可 ready。（分片在 `shardBlocks` 带块/页/偏移映射；格式修复经 submit 工具错误反馈 + verify 补跑一次；超硬限终态 `too_large`；零结果 ready 带 resultNote）
- [x] 接入现有模型配置、心跳、日志和队列；终态失败/取消回写 batch；取消后的迟到结果不再覆盖状态；重试不覆盖 ready 的人工编辑。（条件更新兜底；cancelJob 同步批次 cancelled；retryJob 对 concept_extract/concept_practice 返回 409，重试走新批次 retryOfBatchId；队列终态失败经 `failConceptBatchByJobId` 同步批次）
- [x] 测试有当前文章的对话可生成，没有文章或主题时返回待选择动作；无权文章拒绝；明确要求仅生成不触发正式收录。
- [x] 回归 `pipelineDocumentId`/任务失败传播：concept_extract 失败不把正常文章标为 failed。（document-status-logic.test.ts 断言 + processor 测试断言文章状态不变）
- [x] 运行 `pnpm --filter @inwit/server test -- src/agent/concept-extract.test.ts src/agent/conversation-concept-tools.test.ts src/jobs/queue-logic.test.ts`，固定模型替身测试通过；人工模型样本评审另记结果，不作为唯一自动门禁。（pipeline 断言落在 document-status-logic.test.ts）

## T6：练习绑定、智能出题与旧复习接入

**状态：已完成（M3，2026-10-16）。** 后端闭环与最小 Web/移动协议 2 接线已实现；T9 的练习管理界面未做。详见文末「M3 交付记录」。

**文件：** 新增 `concept-practice.service.ts`、`concept-practice.service.test.ts`、`agent/concept-practice.ts` 及测试；修改 `review/review.service.ts`、`review/review.routes.ts`、卡片编辑/题目修改/恢复入口、`concept.service.ts`、`jobs/processors.ts`、相关 DTO/路由；新增 `review/review-token.ts`、`review/review-token.test.ts`。

**消费：** T1 Practice DTO；T2/3 已确认知识和出处；现有 card_questions/review_states。

**产出：** `bindExistingConceptPractice(userId, input)`、卡片导航链接CRUD，以及 `getReviewEligibility(userId,cardId)`、`resumeConceptPractice(userId,bindingId,input)` 和 `createConceptPractice(userId, input): Promise<ConceptPracticeBinding>`、`refreshConceptPractice(userId, bindingId, input): Promise<ConceptPracticeBinding>`、`processConceptPractice(job): Promise<void>`、`invalidateConceptPractices(tx, target): Promise<void>`。

- [x] 测试仅收录知识时 cards/review_states 数量不变；创建练习事务中cards、questions、review_states、bindings、导航链接要么全成功要么无写入。（版本不符/唯一冲突用例断言无半成品）
- [x] 测试同目标同 exerciseKind 重复加入返回已有卡；模型题面只是建议，确认前没有练习；无AI可手写题面加入。
- [x] 实现 recall/compare/scenario 到 cloze/compare/judge 的一致映射、可读 Card 文本和可选 knowledgeTarget；新增练习入队沿用现有初始排期。
- [x] 测试概念定义练习和相邻关系练习的反馈互不改写；同一个目标的不同题型独立排期。
- [x] 新增 `card-knowledge.service.ts` 和测试，支持同卡多个导航目标；主要练习目标唯一，跨用户拒绝，同用户跨文章来源不改卡片topicId。
- [x] 显式绑定已有脑图卡，断言 cardId、题目、原有排期/暂停、历史及脑图归属完全不变；未入队卡不自动入队。同目标同题型冲突和同卡不同主目标返回409。
- [x] 同卡两个导航目标只有主目标计分；解除绑定保留卡及历史；删除主要导航链接要求先解除主绑定。新建卡显式挂脑图复用已有挂载流程，不复制卡。
- [x] 接入知识阻断needsRefresh/resumeRequired及动态归档校验，不把它们写入手动suspendedAt。队列、反馈、旧resume、refresh和绑定resume共用资格函数；所有变化按卡片行锁串行化。
- [x] 测试旧resume不能绕过失效/归档；原先手动暂停→知识更新→refresh后仍手动暂停；仅归档后恢复保留ease/reps/interval/dueAt，过期dueAt正常入队；解绑解除知识阻断但不清手动暂停。
- [x] 固定绑定首个(createdAt,id)排序题目并存questionId，题型不符拒绝。refresh仅更新此题，其他题不变；旧接口/Agent修改首题题面/答案或删除/重排首题轮换reviewRevision并标needsRefresh，受控refresh除外。
- [x] 实现refresh原子更新首题、targetVersion、reviewRevision、epochId并重置学习参数，保留review_logs、手动暂停和resumeRequired。
- [x] 实现受管理卡reviewRevision与签名reviewToken（HMAC-SHA256，review/review-token.ts）；反馈携requestId幂等验证当前题目/绑定/版本/资格。测试A旧题→B更新并refresh→A提交返回409且日志/排期不变；重复requestId只记一次。
- [x] 活动绑定使用部分唯一约束，解绑设置endedAt；日志写当前bindingId/epochId/targetVersion/questionId/reviewRevision。测试绑定前、旧版本、解绑A后改绑B的历史不计入B，原卡排期保留。
- [x] 实现reviewProtocol=2能力判定；旧队列排除reviewRevision非null卡，缓存无token反馈拒绝；解绑后仍保持版本保护；普通null版本卡继续兼容。
- [x] 运行 `pnpm --filter @inwit/server test`（103 文件 886 用例通过），普通卡旧协议与受管理卡新协议回归通过；另增 `review/review-protocol.test.ts` HTTP 级协议测试。

## T7a：本文知识范围、说明与位置解析

**状态：已完成（M4，2026-10-16）。** `document-knowledge.service.ts` + 路由已实现并有真实 PG 测试。

**依赖：** T1–T4、T6。**文件：** 新增 `document-knowledge.service.ts`、`document-knowledge.service.test.ts`，扩展 `concept.routes.ts`；对应 Web API。

**产出：** `getDocumentKnowledge(userId, documentId, topicId, query)`、`setDocumentKnowledgeRef(userId,input)`、`removeDocumentKnowledgeRef(userId,input)`、`resolveKnowledgeLocations(userId,documentId,topicId,target)`；接口与技术方案4.1一致。

- [x] 测试本文关联概念不等于本文支持其所有主题关系；引用关系只带出必要端点并标 endpoint_context；其他文章信息需显式展开。
- [x] 实现引用CRUD和notes独立版本编辑，手工bundle/批次commit自动写refs；从本文移除概念确认连带本文关系，不能删除共享知识、证据或卡片。
- [x] 测试“本文解释”只更新notes；共享定义变更才触发知识版本及相关练习失效。存在历史证据不自动恢复已移除引用。
- [x] 实现按真实 card/annotation/画布挂载查询多处位置；缺脑图节点返回evidence-only，失效证据不生成虚假节点；跨用户全部404。
- [x] 运行 `pnpm --filter @inwit/server test -- src/concepts/document-knowledge.service.test.ts src/concepts/card-knowledge.service.test.ts`，断言通过。

## T7：文章创建入口和候选图预览

**状态：已完成（M4，2026-10-16）。** 选词/选段/整篇三入口与对话批次恢复已接入；候选在概念区内预览确认。

**文件：** 新增 `apps/web/src/api/concepts.ts`；新增 `features/concepts/concept-draft.service.ts`、`concept-draft-dialog.tsx`、`concept-editor.tsx`、`concept-selection-logic.ts` 及测试；修改 `pages/docs/doc-toprow.tsx`、`selection-toolbar.tsx`、`pages/docs/index.tsx`，对话结果动作组件。

**消费：** T2 手动 bundle；T4 批次API；T5 Agent生成；T7a 本文知识范围。候选图组件可以先用列表表达，T8补齐图形共用组件。

**产出：** `ConceptDraftService.open({documentId,topicId?,selection?})`、`startGeneration()`、`loadBatch(batchId)`、`saveDraft()`、`commitSelected()`；`ConceptDraftDialog` 的内容由文章和对话共用，文章中嵌入概念区；不再仅提供脱离工作区的弹窗。

- [x] 编写选择纯逻辑测试：取消新节点自动取消依赖边；可重绑定已有节点；推断关系默认未选；用户改为同名异义后可创建。
- [x] 在文章内提供查看/编辑/管理本文概念、连接关系、区分本文说明与共享定义及从本文移除；实现选词手工创建、选段梳理、整篇生成三个入口；没有主题时内联选择/新建；脏文档先保存，失败不生成。
- [x] 实现任务阶段、后台恢复、零结果、超限章节选择、失败重试、批次过期提示；对话动作卡使用相同预览。
- [x] 实现编辑节点/谓词/方向/出处、沿用已有概念、收录数量摘要及显式提交；收录后提供可跳过的练习选择。
- [x] 测试文章A生成中切B、旧请求晚到，不污染B；反复点击只发送幂等请求；冲突409保留本地编辑并要求重新预览。
- [x] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-selection-logic.test.ts src/features/concepts/concept-draft.service.test.ts`；浏览器验证从文章入口到正式网络出现。

## T8：文章与主题共用的概念图、索引和详情

**状态：已完成（M4，2026-10-16）。** `features/concepts/` 共用组件已实现；文章本文范围与主题页共用。

**文件：** 新增 `features/concepts/concept-graph.tsx`、`concept-graph-layout.ts`、`concept-graph-layout.test.ts`、`concept-detail.tsx`、`relation-detail.tsx`、`relation-editor.tsx`、`concepts.service.ts`、`concepts.css`；修改 `pages/topics/index.tsx` 和 `routes.ts`。

**消费：** T2 图/检索/编辑接口；T3 证据解析；T7 共享候选组件。

**产出：** `layoutConceptGraph(nodes,edges,previousPositions?): ConceptGraphLayout`；主题概念入口；可定位 conceptId/relationId 的地址参数；共同图组件用于正式图和候选图。

- [x] 编写图数据测试：方向与谓词一致、只渲染完整端点关系、50节点可见集合切换/邻居展开、独立边分页、空图可创建；关系完整加载前不显示无关系。布局至少保证节点不重叠、标签不压节点；合法多节点环可显示，新数据保留已有位置，不触发fit-all。
- [x] 实现关系图/索引切换、邻居聚焦、本文过滤、名称别名搜索、推断与复习过滤；图上可选概念和关系。
- [x] 实现侧栏解释、例子、语境、来源和练习摘要；已有概念中「添加关联概念」、方向预览和归档影响说明。
- [x] 接入出处解析，成功后沿用主题托管文章路由；失效/来源删除展示快照，不能静默跳错句。
- [x] 在1440×900、1920×1080和390×844浏览器检查：页面不横向溢出，局部图可滚动，列表可访问所有内容，键盘可操作，无必须悬停的功能。
- [x] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-graph-layout.test.ts src/routes.test.ts`，并保存人工视觉检查结果。

## T8a：文章工作区、布局与完整状态恢复

**状态：核心完成（M4，2026-10-16）。** 三模式/分隔/降级/偏好持久化已实现；正文锚点与两图细粒度视口恢复为简化版（见交付记录遗留项）。

**依赖：** T0、T7、T8。**文件：** 新增 `features/study-workspace/study-workspace.tsx`、`study-workspace.service.ts`、`study-state.ts`、`study-state.test.ts`、`study-layout.ts`、`study-layout.test.ts`、`outline-adapter.ts`；修改现有 DocsPage 挂接点，不重建阅读器。

**产出：** `StudyWorkspaceStateV1`；`capture(viewKey)`、`restore(viewKey,snapshot,viewportSize)`；outline/concepts/compare 三模式，stacked/columns 两排列，preferred/effective分离。

- [x] 编写状态测试：用户/文章/主题key隔离；脑图、正式概念图、候选图互不覆盖；schemaVersion错误可安全回退；50篇LRU及存储不可用退回内存。
- [x] 实现同页对照、可调分隔和临时聚焦；用T0确认阈值降级，恢复空间后回到用户偏好；分隔线可键盘操作。
- [x] 实现正文锚点、两图视口/展开/焦点、索引详情滚动、过滤布局的capture/restore；订阅现有脑图状态，不能保存两份冲突真值。
- [x] 按技术方案实现内存、localStorage、sessionStorage与服务端draft分工；500ms debounce及路由切换flush；未提交表单切视图和刷新不丢失，版本冲突不自动覆盖。
- [x] 测试隐藏区零尺寸不重置；数据和布局完成后才恢复；正文更改/节点删除/图增量加载按有效锚点回退；两个标签不抢视口；路由返回目的地不被旧状态覆盖。
- [x] 运行 `pnpm --filter @inwit/web test -- src/features/study-workspace/study-state.test.ts src/features/study-workspace/study-layout.test.ts`；真实浏览器验证切模式、调整窗口、离开返回、刷新和不同用户隔离。

## T8b：双视图联动与共享卡片操作

**状态：核心完成（M4，2026-10-16）。** 高亮联动与显式定位已实现；浏览器覆盖有限（见交付记录）。

**依赖：** T6、T7a、T8、T8a。**文件：** 新增 `features/study-workspace/study-link.service.ts`、`study-link.service.test.ts`，扩展脑图adapter与两种知识详情。

**产出：** `select({eventId,originView,documentId,topicId,target,intent})`、`locate(locationId)`、`returnFromLocate()`；同卡跨视图操作引用同一ID。

- [x] 测试选择脑图卡只改变概念图高亮集合，不改其相机/选中/展开；反方向相同；相同eventId不反复传播，旧文章响应丢弃。
- [x] 实现隐藏/未加载/折叠目标计数、多个出现位置选择及显式定位；定位才加载/展开/平移，返回还原此前过滤、折叠和相机。
- [x] 在本文中查看已有学习卡、关联多个知识目标或设主练习目标；编辑同卡两边刷新，复习历史唯一。新卡显式挂载脑图后能双向定位。
- [x] 测试没有脑图节点时仅提供原文位置，不伪造节点；只移除画布挂载不删卡或知识链接；卡片删除后高亮映射失效。
- [x] 运行 `pnpm --filter @inwit/web test -- src/features/study-workspace/study-link.service.test.ts`；浏览器验证完整多位置定位与返回，禁止自动双相机联动。

## T9：练习预览和复习上下文

**状态：核心完成（M4，2026-10-16）。** 练习对话框（手写/智能出题/绑定已有卡/refresh/resume/解绑）已实现；复习协议接线沿用 M3。

**文件：** 新增 `features/concepts/concept-practice-dialog.tsx`、`concept-practice.service.ts` 及测试；修改 `pages/review/review.service.ts`、`pages/review/index.tsx`（子组件按实际位置接入）、关系/概念详情；修改 `apps/web/src/api/review.ts`、`apps/mobile/src/api/review.ts` 和移动复习Service/会话逻辑，完成最小协议升级。

**消费：** T6 题目建议、确认、refresh；T8a/T8b工作区与返回状态；既有每日队列和三档反馈。

**产出：** 从知识目标手工/智能生成练习、编辑确认、加入/查看练习；翻面后回到目标及出处，返回保持当前题目和翻面状态。

- [x] 测试仅点击打开练习对话框不入队，确认后入队；重复点击已有练习展示已有卡；模型失败允许手填。
- [x] 实现题面答案编辑、目标版本展示和新旧题对比；needsRefresh 练习默认暂停并给「更新练习」入口。
- [x] 实现复习知识目标来源标签；揭晓前不显示关系答案；翻面后可看来源并返回，不跳过题也不重复提交反馈。
- [x] 测试定义与关系的不同反馈独立展示；没有练习时显示未加入；当前epoch无记录显示未练习，旧卡到期时间不当作新目标掌握证据。
- [x] Web/移动请求reviewProtocol=2，保存并回传原题reviewToken与requestId；409内容变化时废弃旧答案、重新取题要求回忆，不自动重放评分。
- [x] 展示全部阻断原因，提供不重置进度的绑定resume；refresh和普通手动恢复分别执行，不能清掉其他暂停原因。
- [x] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-practice.service.test.ts src/pages/review/review.service.test.ts`；验证升级移动端新token反馈、旧客户端普通卡反馈和受管理卡排除；不得宣称旧客户端可无条件反馈受管理卡。

## T10：跨页面同步、生命周期与发布开关

**文件：** 修改 `apps/server/src/config.ts`、sync DTO/触发器注册与迁移、`apps/server/src/sync/sync.service.ts`、`apps/web/src/features/concepts/concepts.service.ts` 及 sync 订阅；必要时修订文档/主题删除服务；新增对应集成测试。

**消费：** T1–T9（含T7a、T8a、T8b）完整领域及UI。

**产出：** CONCEPTS_ENABLED 默认 false；新实体变更通知；归档、删除、来源失效与队列暂停一致性。

- [x] 测试开关关闭时不显示入口，不接受新生成和写入；既有普通练习继续可复习。
- [x] 实现概念、关系、证据、本文引用、notes、卡片导航链接及绑定变化的同步失效；只刷新业务数据，不重置视口/过滤、不覆盖未保存输入；事件不携带越权数据。
- [x] 测试删除来源文档不删知识，失效跳转可见；归档主题暂停其绑定练习并禁止新生成；删除主题按产品已有语义清理新增领域数据。
- [x] 测试多个标签页目标更新并已refresh完成后旧反馈仍被拒绝；页面收到事件刷新，不能因过期缓存错误恢复已暂停练习。
- [x] 运行 `pnpm --filter @inwit/server test -- src/sync/sync-trigger.contract.test.ts src/concepts/concept-lifecycle.test.ts` 及新增前端 sync 测试，所有生命周期断言通过。

## T11：端到端验收与发布准备

**文件：** 新增浏览器验收用例 `e2e/cases/concept-relations.md`（如仓库有既定 e2e 目录则跟随）；更新本计划验收记录、已有API生成产物及必要产品说明，不另外扩张功能。

**消费：** T1–T10。

- [x] 在隔离数据库运行全链路：导入示例文章→整篇生成→取消一节点及依赖关系→修改谓词→确认→第二篇复用→查看出处→加入关系练习→三档反馈。
- [ ] 在对照模式验证两个图同时可见，选择只高亮，定位/返回可恢复；脑图卡复用后ID和历史唯一，合法带环图正确展示。（2026-10-17 补了脑图卡：对照上下双图同时可见；点「Task 的正文锚点」后 Task 为 `is-highlight` 且不是 `is-selected`，viewBox 仍是 `0 0 528 358.45922272091974`；合法环仍在。定位/返回按钮仍然没有，`StudyLinkService` 的方法没有界面调用。「定位原文」在引文还在时派发 `inwit:concept-locate-block`（blockIndex 1），没有组件监听，正文没有闪动。同一 cardId 复用仍只由服务端测试覆盖。本项不勾。）
- [ ] 验证从主题及直接进入同一文章、刷新、两标签、窗口尺寸变化、追加节点、正文变更和焦点删除；状态恢复且返回路径正确。（2026-10-17：主题 URL 与直接 `/docs` 都能看到同一正文和 Task/Trial/Step 环；刷新后追加的 Extra 还在；主题标签和新的文档标签内容一致；390×844 概念图在画面里且 `scrollWidth` 为 390。改正文后卡片显示「原文已删除」，出处出现「原文已变化，无法定位，仅保留摘录」，摘录还在；把引文写回去后解析恢复为 resolved。归档焦点概念 Extra 并刷新后，图上不再有 Extra，环还在。显式定位的返回路径仍然没有界面。本项不勾。）
- [ ] 验证本文补充与共享定义分离、移除本文引用不损坏其他文章、候选及手工未保存编辑在当前标签刷新后恢复。（2026-10-17：Task 的共享定义仍是「实验的基本单位。」，本文说明只在 knowledge 的 notes 里，概念详情不展示这句。从验收文章移除 Probe 的引用后，对照文章仍只有 Probe，定义未改。编辑里改了共享定义但没保存，sessionStorage 为空，刷新后草稿消失、定义仍是原句。未保存恢复仍未接线。本项不勾。）
- [x] 执行五项审查回归：旧resume不绕阻断、多题仅绑定首题、refresh后旧token拒绝、改绑B不继承A反馈、跨节点页关系和环完整。
- [x] 模拟无协议参数旧端及缓存反馈，验证普通卡兼容与受管理卡拒绝；升级移动端协议2可正常复习。
- [x] 执行无AI手动创建和手写练习；确保基础能力不依赖模型。
- [x] 执行原文变化、两个标签重复确认、任务取消、worker终态失败、同名异义和推断确认用例。
- [ ] 核对需求 A1–A25 全部有验收证据；人工审阅样本的关系方向与事实支持，记录模型、样本长度、修改原因，不记录密钥。（映射见 M5 交付记录。真实模型抽样未执行，本项不勾。）
- [x] 运行 `pnpm --filter @inwit/dto build`、`pnpm --filter @inwit/server typecheck`、`pnpm --filter @inwit/web typecheck`、server/web 的 `test` 与 `build`；DTO 波及移动端时运行移动端现有 typecheck 命令（先核对 package.json）。所有失败需解释并解决，不能把计划中的命令写成已通过。
- [x] 验证迁移与关闭开关的回退流程；确认所有 worker 已支持新 job 类型后才安排开放入口。
- [x] 完成任务评审与最终变更检查，再单独进入部署流程；本计划不包含执行部署授权。

## M1 交付记录（2026-10-16）

范围：T1 → T4（知识基础）。不含 Agent 生成、练习业务与前端界面。未提交 Git、未部署、未对开发库/生产库执行迁移。

**新增文件**

| 文件 | 说明 |
| --- | --- |
| `packages/dto/src/concept.ts` | 概念/关系/证据/说明/本文引用/卡片导航契约，图查询与 graph/view、bundle、匹配、出处解析 schema |
| `packages/dto/src/concept-batch.ts` | 批次、草稿（schemaVersion=1）、决定、提交契约；30/60 硬上限与 60,000 字符上限常量 |
| `packages/dto/src/concept-practice.ts` | 练习绑定/出题建议契约与题型映射（M3/T6 使用，M1 仅结构） |
| `apps/server/src/concepts/concept-identity.ts` | 规范化、关系 identityHash、证据去重哈希、请求哈希、匹配建议 |
| `apps/server/src/concepts/concept-evidence-logic.ts` | 正文 hash、引文核验、唯一定位解析（纯函数） |
| `apps/server/src/concepts/concept-evidence.ts` | 正文快照、证据写入（含核验与去重）、出处解析 |
| `apps/server/src/concepts/concept.service.ts` | 概念/关系 CRUD、归档/恢复、图节点分页与 graph/view 边分页、bundle 原子保存 |
| `apps/server/src/concepts/concept-batch.service.ts` | 批次读取/草稿编辑/丢弃；生成入口占位（501） |
| `apps/server/src/concepts/concept-commit.ts` | 候选确认事务（锁批次+主题、版本/hash 校验、临时 ID 解析、引用写入、幂等） |
| `apps/server/src/concepts/concept.routes.ts` | 全部 REST 路由，`CONCEPTS_ENABLED` 门控 |
| `apps/server/src/testkit/` | 真实 PG 隔离测试设施（`inwit_test` 上按运行建 `m1_<随机>` schema，应用全部迁移，结束 drop）与种子夹具 |
| `apps/server/src/concepts/*.test.ts` | 8 个测试文件（DTO、identity、DB 约束、service、evidence、batch、commit、routes） |

**修改文件**：`packages/dto/src/index.ts`（导出）、`job.ts`/`agent.ts`（concept_extract/concept_practice 枚举与 payload schema）、`apps/server/src/db/schema.ts`（新表 + topics.concept_graph_revision + cards.review_revision + review_logs 归属列）、`errors.ts`（新错误码）、`config.ts`（CONCEPTS_ENABLED 默认 false）、`app.ts`（注册路由）、`jobs/job-view.ts`/`jobs/processors.ts`（新任务类型的展示与防呆处理器）、web/mobile 任务图标与中文标签、`apps/server/vitest.config.ts`（globalSetup 与超时）、`tsconfig.build.json`（排除 testkit）。

**迁移**：`apps/server/drizzle/0043_dazzling_lorna_dane.sql`（由 drizzle-kit 按当前顺序生成；M2 因 resultNote 列重新生成过一次）。新增 10 张表；jobs/agent_executions 枚举 CHECK 重建；cards/review_logs/topics 增列均为可空或带默认值，不回填旧数据。只应用到隔离测试 schema；inwit_dev/inwit_prod 未动。

**接口**（全部需登录、默认被开关拒绝）：概念 CRUD 与归档/恢复、关系 CRUD 与归档/恢复、同名匹配建议、概念列表分页、概念图节点分页、graph/view 边分页、概念 bundle、批次 GET/PATCH/commit/discard、证据 resolve、文档生成入口（501）。

**验证命令与结果**（2026-10-16，远程 PG 隔离 schema）：

- `pnpm typecheck` — dto/server/web/mobile/doc-engine 全部通过。
- `pnpm --filter @inwit/dto build`、`pnpm --filter @inwit/server build`、`pnpm --filter @inwit/web build` — 通过；server dist 不含 testkit。
- `pnpm --filter @inwit/server test` — 96 文件 831 用例全通过（含概念 8 个新文件 57 用例；事务/外键/唯一约束/并发均为真实 PostgreSQL）。
- `pnpm --filter @inwit/web test`、`pnpm --filter @inwit/mobile test` — 通过（DTO 新枚举的兼容改动）。

**与 M2/T5 的衔接点**（已全部接通，见「M2 交付记录」）

- ~~`createConceptBatch` 抛 501~~ → M2 已实现为「快照 → 建批次 → enqueueJob concept_extract」（同事务 + requestId 幂等）。
- ~~processors.ts 防呆占位~~ → concept_extract 已接 `processConceptExtract`；concept_practice 仍是占位（T6）。
- 批次 contentSnapshot（含块文本）/coverage/jobId/retryOfBatchId 已在 M2 投入使用；批次新增 resultNote 列（迁移 0043 重新生成）。
- 对话工具 `propose_article_concepts` 已实现（`agent/conversation-concept-tools.ts`）。

**与 T6（M3）的衔接点**：concept_practice_bindings/proposals 表、cards.review_revision、review_logs 归属列已建好；概念/关系语义变更与归档已在服务层调用 markPracticesStale/markPracticesResumeRequired（M1 无绑定行，恒为 0 影响）；绑定写入、refresh/resume、reviewToken 均留给 T6。

**与 T7a 的衔接点**：本文引用的写入已由 bundle/commit 使用 `upsertDocumentKnowledgeRef`（concept.service.ts 导出）；knowledge-refs REST、本文知识范围查询与位置解析留给 T7a。

**遗留与未验证项**

- 生成任务行为在 M2 已由固定模型替身覆盖；真实模型抽样未运行（见 M2 记录）。
- graph/view 的「一致数据库快照」使用 REPEATABLE READ 事务；跨页并发变更依赖 revision 冲突暴露，已测游标/版本 409。
- GET `/api/concepts/:id` 的相邻关系分页返回首 100 条与游标占位（relationsNextCursor 为关系 id），翻页参数留给 T8 前端接入时定型。
- 概念详情未含练习摘要（T6）；notes 尚无独立 PATCH 路由（T7a）。
- 隔离测试设施依赖 inwit_test 库的 CREATE SCHEMA 权限；PG 不可用时 DB 测试整体 skip（globalSetup 打印原因）。
- 移动端只补了任务枚举的图标/标签，没有概念 UI（按计划）。

## M2 交付记录（2026-10-16）

范围：T5（文章 Agent 智能生成与对话接入）。不含练习出题（T6）、候选预览 UI 与双视图（M4）。未提交 Git、未部署、未启用生产开关、未调用真实模型。

**新增文件**

| 文件 | 说明 |
| --- | --- |
| `apps/server/src/agent/concept-extract-logic.ts` | 纯逻辑：分片（≤8000 字符、超长块按 code point 拆分并记录偏移）、分片提交 zod 校验、跨分片合并（tempId 加 `s<N>:` 前缀、同名规范化合并、端点重映射）、定稿（端点闭合、引文核验、explicit 降级 inferred、30/60 硬上限） |
| `apps/server/src/agent/concept-extract.ts` | `processConceptExtract`：read_next_shard / submit_shard_candidates 两个工具驱动逐分片提取；verify 覆盖检查（缺分片补跑一次，仍缺终态 `incomplete_coverage`）；ready 条件写入；终态错误回写批次 errorCode |
| `apps/server/src/agent/conversation-concept-tools.ts` | 对话工具 `propose_article_concepts`：可信上下文取本轮 @ 文章，显式指定重新鉴权；缺文章/主题返回待选择结果（附已有主题列表），不创建主题；同回合 runKey 幂等；动作卡 `concept_batch` 仅携带 batchId/jobId |
| `apps/server/src/testkit/fake-model.ts` | 确定性模型替身：按 pi-ai 事件协议推流的 fake streamSimple + resolveModelFor 替身 |
| 测试 | `concept-extract-logic.test.ts`（8）、`concept-extract.test.ts`（15）、`conversation-concept-tools.test.ts`（8） |

**修改文件**：`concept-batch.service.ts`（createConceptBatch 真实实现 + 批次状态迁移辅助 markRunning/Ready/Failed 与按 jobId 的取消/失败同步）；`jobs/processors.ts`（concept_extract 接线，concept_practice 仍为防呆占位）；`jobs/jobs.service.ts`（cancelJob 同步批次 cancelled；retryJob 对概念任务返回 409，重试走新批次 retryOfBatchId）；`jobs/queue.ts`（终态失败/耗尽经 `failConceptBatchByJobId` 同步批次）；`agent/conversation.ts`（session 增加 mentionDocumentIds/runKey，系统提示加生成规则）；`agent/conversation-tools.ts`（注册工具）；`agent/conversation-logic.ts`、`apps/web/src/shell/assistant-rail.tsx`、`apps/mobile/src/pages/chat/chat-logic.ts`（新动作类型渲染分支）；`packages/dto`（conceptContentSnapshot、batch.resultNote、retryOfBatchId、concept_batch 动作）；`apps/server/src/db/schema.ts`（concept_batches.resultNote 列，contentSnapshot 类型）；`errors.ts`（CONCEPT_BATCH_RETRY_INVALID；移除已无用的 CONCEPT_GENERATION_UNAVAILABLE）；`documents/document-status-logic.test.ts`（concept_extract 失败不传播到文章的回归断言）。

**迁移**：0043 在 M1 基础上重新生成（`0043_dazzling_lorna_dane.sql`，未应用于开发/生产库）。

**任务生命周期**

- 创建：`POST /api/documents/:id/concept-batches`（202 `{batchId, jobId}`；同 requestId 重放返回原结果，不同请求 409；expectedDocumentHash 不符 409 CONCEPT_BATCH_STALE；开关关闭 404）。
- 执行：worker 现有循环领取 concept_extract → `processConceptExtract`；心跳、取消探测、执行审计（agent_executions steps/turns）、模型用量全部沿用 runAgentJob。
- 取消：`POST /api/jobs/:id/cancel` → 批次同步 cancelled；迟到/重复执行看到终态批次直接跳过，不写 draft。
- 终态失败：processor 对 AgentTerminalError 回写批次 failed（errorCode：empty_source / incomplete_coverage / too_large / extract_failed 等）；队列耗尽兜底为 `job_failed`。可重试错误（模型超时/不可用）不提前终结批次，由队列按退避重试同一 job。
- 重试：用户层面对 failed/cancelled 批次用创建接口 + `retryOfBatchId` 生成新批次；job 级重试被 409 拒绝。
- 批次结果：ready 后可 GET/PATCH/discard/commit（M1 契约）；人工编辑（draftRevision 递增）后重跑不会覆盖；正文变化派生 stale=true 并拒绝 commit。

**验证命令与结果**（2026-10-16，隔离 PG schema + 确定性模型替身）

- `pnpm typecheck` 全仓通过；`pnpm --filter @inwit/server test` 全量通过（含 M2 新增 31 用例）；`pnpm --filter @inwit/dto build`、`server build`、`web build` 通过；web/mobile 测试通过（对话动作新分支）。
- 关键断言：生成期 concepts/relations/cards/review_states 零写入；多分片全覆盖；引文核验与 inferred 降级；同名异义保留 + 匹配建议；悬空/越权端点丢弃；修复一次有效/仍无效终态失败；取消与迟到结果幂等；ready 人工编辑不被覆盖；生成后改正文 stale + commit 409；隔离库走通 生成→读取→编辑→确认；feature flag 关闭不入队。

**隔离环境手工操作**

```bash
pnpm dev                                  # server :3020 + worker 另开 pnpm --filter @inwit/server worker
CONCEPTS_ENABLED=true                     # server/worker 环境（默认 false）
# 生成：POST /api/documents/:id/concept-batches {topicId, scope, requestId}
# 查询：GET /api/concept-batches/:id；取消：POST /api/jobs/:jobId/cancel；
# 重试：POST /api/documents/:id/concept-batches {…, retryOfBatchId, requestId}
# 确认：POST /api/concept-batches/:id/commit（M1 契约）
```

**与 M3/M4 的衔接点**

- T6：concept_practice processor 占位在 `jobs/processors.ts`；proposals 表与练习 DTO 已在 M1 就绪。
- T7（候选预览 UI）：批次 GET 返回 draft/coverage/resultNote/stale；对话动作 `concept_batch` 已在 web/mobile 渲染为文字分支，动作卡打开预览属于 T7。
- 模型真实表现（注入抵抗、关系质量）需人工样本评审，本轮只有确定性替身。

**遗留与未验证项**

- 未运行真实模型抽样（按约定不调用收费模型）；提示词效果、关系召回质量未验证。
- 恶意正文的「指令不提升权限」由架构保证（生成 Agent 只有 read/submit 两个无写库权限的工具，候选必须经 commit 接口）；真实模型的服从性未验证。
- 模型上下文一次性携带全文而非逐分片读取的实现差异未做 A/B（当前为工具驱动逐分片）。
- 并发「同文档同时创建两个批次」未限制（幂等只覆盖同 requestId）；如需单文档单活跃批次可在后续收紧。

## M3 交付记录（2026-10-16）

范围：T6（学习载体：练习绑定、智能出题建议、现有复习接入）。含最小 Web/移动协议 2 接线；未做 T9 练习管理界面。未提交 Git、未部署。

**新增文件**

| 文件 | 说明 |
| --- | --- |
| `apps/server/src/concepts/concept-practice.service.ts` | 统一资格 `getReviewEligibility`（手动暂停与知识阻断分离）、create/bindExisting/refresh/resume/unbind（事务 + requestId 幂等）、`guardManagedCardEdit`（版本保护）、`getConceptPracticeSummary`（当前 binding/epoch/version 归属） |
| `apps/server/src/concepts/card-knowledge.service.ts` | 卡片导航关联 CRUD；主绑定链接删除保护（409 CONCEPT_LINK_BOUND） |
| `apps/server/src/concepts/concept-proposal.service.ts` | 出题建议创建（幂等 + 入队）与读取（含 currentTargetVersion 漂移提示）；按 jobId 的取消/失败同步 |
| `apps/server/src/agent/concept-practice.ts` | concept_practice processor：submit_exercise 工具 + 一次补跑，终态 `no_submission`/`target_unavailable`；只写 proposal |
| `apps/server/src/review/review-token.ts` | HMAC-SHA256 签名复习令牌（userId/cardId/questionId/reviewRevision/bindingId/epochId/targetVersion，不含答案） |
| 测试 | `concept-practice.service.test.ts`（12）、`agent/concept-practice.test.ts`（6）、`review/review-token.test.ts`（2）、`review/review-protocol.test.ts`（2）、concept.routes.test.ts 扩展（+2） |

**修改文件**：`review/review.service.ts`（协议 2 队列分流、令牌签发、反馈版本/资格/幂等校验、日志归属、旧 resume 阻断守卫）、`review/review.routes.ts`（reviewProtocol 查询参数、reviewToken/requestId 入参）、`cards/card.service.ts`（updateCard 题目/呈现内容版本保护）、`agent/evolve-tools.ts`（加题版本保护）、`concepts/concept.service.ts`（语义变更/归档/恢复轮换受影响卡片 reviewRevision 并标 needsRefresh/resumeRequired；详情附练习摘要）、`jobs/jobs.service.ts`（concept_practice 取消同步）、`jobs/queue.ts`（建议失败兜底）、`jobs/processors.ts`（concept_practice 接线）、`packages/dto`（concept-practice 输入/结果契约、review 协议字段）、web/mobile `api/review.ts` 与复习服务（协议 2 + requestId 幂等 + 内容变化重取队列）。无新迁移（结构在 M1 的 0043 已备好）。

**接口**（概念域接口仍由 CONCEPTS_ENABLED 门控；复习反馈保护不受开关影响）：

- `POST /api/concept-practices`（手写新建，201/200 幂等）、`POST /api/concept-practices/bind-existing`、`POST /api/concept-practices/:id/refresh`、`POST /api/concept-practices/:id/resume`、`DELETE /api/concept-practices/:id`
- `POST /api/concept-practice-proposals`（202）、`GET /api/concept-practice-proposals/:id`
- `GET/POST /api/cards/:id/knowledge-links`、`DELETE /api/cards/:id/knowledge-links/:linkId`
- `GET /api/review/today?reviewProtocol=2`、`POST /api/review/:cardId/feedback`（reviewToken + requestId）

**协议与资格语义**

- review_states.suspendedAt 仅手动暂停；知识阻断 = needsRefresh / resumeRequired / 目标或端点或主题归档（动态）/ 首题失配，由 `getReviewEligibility` 统一计算并返回可解释 reasons。
- 旧 resumeCard 遇知识阻断返回 409 REVIEW_NOT_ELIGIBLE；绑定 resume 只清 resumeRequired；refresh 原子更新首题+epoch+targetVersion+reviewRevision 并重置学习参数（保留手动暂停/resumeRequired/历史）；解绑保留卡片与历史且不退回旧协议。
- 队列：旧客户端（无协议参数）不领取受管理卡；协议 2 下受管理卡过资格校验后下发首题 + 令牌；反馈事务内锁卡片行、验签、核对版本/绑定/题目/资格，requestId 幂等（同 key 不同请求 409）。

**验证**（2026-10-16，隔离 PG schema；模型为确定性替身）

- `pnpm typecheck` 全仓通过；`pnpm --filter @inwit/server test`：103 文件 886 用例通过；server/web 构建通过；web 62/426、mobile 16/95 通过。
- 覆盖任务书 18 项：原子创建与失败无半成品、同目标同题型/并发/requestId 幂等、只绑首题、绑定保留排期暂停历史、多导航仅主目标计分、旧恢复不绕阻断、手动暂停贯穿 refresh、归档恢复保留参数并可入队、旧接口与 Agent 改首题触发版本保护、refresh 后旧令牌 409 且日志/排期不变、重复反馈只计一次、解绑改绑不继承反馈、旧协议兼容 + 受管理卡排除 + 缓存反馈拒绝、建议只产 proposal、目标版本漂移阻断旧确认、取消/迟到幂等、无 AI 手写走通复习。

**隔离环境验证步骤**

```bash
CONCEPTS_ENABLED=true pnpm dev   # server + worker
# 手写：POST /api/concept-practices {targetKind,targetId,expectedVersion,exerciseKind,question,answer,requestId}
# 建议：POST /api/concept-practice-proposals {targetKind,targetId,exerciseKind,requestId} → GET /api/concept-practice-proposals/:id
# 队列：GET /api/review/today?reviewProtocol=2 → 受管理卡带 reviewToken
# 反馈：POST /api/review/:cardId/feedback {feedback, reviewToken, requestId}
# 更新：PATCH /api/concepts/:id（语义变化）→ 卡 needsRefresh；POST /api/concept-practices/:id/refresh 后可复习；旧令牌反馈 409 REVIEW_CONTENT_CHANGED
```

**与 M4/T9/T10 的衔接**

- T9：练习对话框/复习页知识标签/更新练习入口。服务端已就绪：详情接口带 `practice` 摘要（binding/反馈计数/到期），令牌错误码 REVIEW_CONTENT_CHANGED 客户端已按「重取队列」处理。
- T7a：知识位置解析可用 card_knowledge_links + 主绑定；T10：新表（bindings/proposals/links）的 sync 失效与生命周期一致性待接入。
- 概念/主题归档时的「暂停全部绑定练习」已通过 resumeRequired + 动态阻断实现；主题归档恢复后绑定 resume 的批量入口留 T9/T10。

**未验证项**

- 出题与提取一样只跑确定性替身；真实模型题目质量未评审。
- 队列分流按卡逐个资格校验（每日上限 100 内可接受）；未做批量性能测试。
- Web/移动端的协议接线由类型检查与既有测试覆盖，未做真实浏览器/真机回归（留 T9/T11 验收）。
- 知识恢复时轮换卡片版本（设计 3.5 的「恢复递增」）已实现；恢复本身不清 resumeRequired。

## M4 交付记录（2026-10-16）

范围：T7a → T7 → T8 → T8a → T8b → T9 的产品闭环（文章内创建/管理/双视图/关系阅读/复习入口）。未提交 Git、未部署、生产开关仍默认关闭。

**后端（T7a）**

- `concepts/document-knowledge.service.ts`：本文知识范围（direct / endpoint_context 区分、notes、证据）、引用/移除（连带关系需确认、可复活、幂等）、本文说明独立版本编辑、位置解析（真实卡片/画布挂载 + 可验证出处 + 引文批注，evidence-only 不伪造节点）。
- 路由：`GET /api/documents/:id/knowledge`、`POST/DELETE /api/documents/:id/knowledge-refs[/:refId]`、`GET /api/documents/:id/knowledge-locations`、`POST/PATCH /api/concept-notes[/:id]`。
- 图节点协议修订：本文范围节点包含关系带出的端点上下文（`conceptGraphNodeSchema.membership`），边缘仍只含本文明确收录的关系——两个概念同时在本文不引入其他文章的边。
- `cards.reviewRevision` 现在卡片 DTO 暴露（绑定已有卡的版本确认需要）。

**前端**

| 路径 | 内容 |
| --- | --- |
| `apps/web/src/api/concepts.ts` | 概念域全部 HTTP 封装 |
| `features/concepts/` | ConceptsService（图协议：节点发现分页 + 可见集合边分页 + revision 冲突重载保相机）、SVG 关系图（有向环、谓词标签、节点拖动/平移/缩放、邻居展开、endpoint_context 弱化）、索引、概念/关系详情（编辑/归档影响/出处定位/练习摘要）、新建/连接编辑器（匹配建议不合并）、候选批次面板（推断默认不选、取消节点级联、重绑定、确认收录与摘要）、练习对话框（手写/智能出题/绑定首题/refresh/resume/解绑） |
| `features/study-workspace/` | 三模式（结构/概念/对照）+ 排列切换 + 分隔线（拖动与方向键）+ 临时放大/恢复 + preferred/effective 分离 + 布局偏好按用户+文章+主题持久化（localStorage，LRU）；StudyLinkService（卡片→概念高亮、概念→卡片/划线位置、显式定位与返回） |
| 集成 | PaneRead 挂 `StudyDock`（Dock 内嵌现有 CardRail 与 ConceptsPanel）；选区工具栏「收为概念」「梳理概念与关系」；主题页「概念」标签；`?conceptBatch=` 恢复对话批次 |

**布局与 M0 基线的偏差（如实记录）**：M0 阈值按原型全宽设定（≥1280 上下双图、≥1650 三栏）；正式实现的学习区是固定宽 dock 且文档列表占约 300px。校准为：工作区（pane-doc）宽 ≥1400 且高 ≥560 时允许横向排列；≥980 且高 ≥560 时上下对照；其余按最近焦点降级单图，恢复空间后回到偏好。因此 1440×900 带文档列表时（工作区约 864px）对照降级为单图——与 M0 样例的 1440 上下双图不同，属于真实布局下的有意校准，已用浏览器验证降级与恢复。

**验证**

- 单测：`concept-selection-logic.test.ts`、`concept-graph-layout.test.ts`（含布局阈值）、`document-knowledge.service.test.ts`（真实 PG，5 用例）。
- 全量：`pnpm typecheck` 通过；server 104 文件 891 用例、web 64 文件 436 用例、mobile 16 文件 95 用例全过；web build 通过。
- 浏览器（临时 profile 的 Chrome + CDP 脚本，专用账号 m4-verify@test.local，数据为隔离演示数据，未动真实用户内容）：登录 → 概念图（节点/边/端点上下文）→ 详情 → 1440 降级单图与 1920 对照恢复（分隔线键盘可调）→ 主题页概念标签 → 390×844 无横向溢出；候选批次：推断关系默认不勾选 → 显式确认 → 收录摘要（新增 2 概念 1 关系）→ 图出现新节点。截图在 `docs/plans/concept-relations/m4-evidence/`。
- 生成任务（concept_extract）未在浏览器走真实模型（沿用 M2 确定性替身测试）；浏览器中的批次为 DB 侧构造的 ready 批次，用于验证预览/编辑/确认链路。

**遗留与未验证项**

- T8a 细粒度状态恢复为简化版：布局偏好持久化已实现；概念图视口/位置在会话内保留于 Service（切文章按 scope 重置），未做 localStorage 视口恢复、正文锚点恢复与 50 篇 LRU 视口；未提交表单/候选勾选的 sessionStorage 恢复未接线（结构已在 study-state.ts）。
- T8b 联动：卡片→概念高亮已实现（脑图卡选中时）；概念→脑图的「多位置列表选择 + 定位/返回」UI 为最小实现（locations API 可用，面板内未做位置列表浮层）；浏览器未专门覆盖。
- T9：复习页内「翻面后看关系与出处」未做（复习页保持 M3 形态）；练习对话框的浏览器回归未做。
- 概念图渲染未做大数据性能测试；50 节点发现分页的「加载更多」已实现但浏览器未覆盖跨页环场景（服务端有跨页边测试）。
- 文章顶栏未单独加「生成概念与关系」（入口在学习区页签行）；选段梳理按选区所在块作为 selection 范围。
- 键盘 Tab 顺序与读屏未验证；对比度未审。
- inwit_dev 已应用迁移 0043（追加式，开发库常规流程）。

**与 M5 的衔接**：见下方 M5 交付记录。真实模型抽样仍未执行。

## M5 交付记录（2026-10-16）

范围：T10（发布开关、同步失效、生命周期）与 T11（隔离库验收、浏览器抽查、构建）。未提交 Git、未部署、未改生产库、未调用真实模型。开发库 `inwit_dev` 在本阶段开始前已经有 0043 与 0044，本阶段没有再跑迁移，也没有做破坏性 SQL。

**T10 中断点审计**

中断时工作区已有、本阶段复核后保留的部分：迁移 `0044_concept_sync.sql`（`sync_changes` 增加 `concept` scope 与概念域触发器；绑定同时发 `review` 事件；事件只有用户、scope、资源 id、操作和时间，没有定义或摘录正文）；DTO `SYNC_SCOPES` 与 web/mobile `sync-plan.ts` 的 `concept` 分支（不产生视口重置意图）；`archiveTopic` 给活动绑定设 `resumeRequired` 并轮换卡片 `reviewRevision`，不写 `suspendedAt`；`/health` 已有单一 `conceptsEnabled`。

中断时未完成、本阶段补上的部分：读写开关分离、写关闭时 worker 对 `concept_extract` / `concept_practice` 的处置、`concept-lifecycle.test.ts`、前端按 `/health` 隐藏入口并在只读时拦住写操作。

**开关**

`CONCEPTS_ENABLED` 仍是默认 false 的主开关。新增可选 `CONCEPTS_READ_ENABLED`、`CONCEPTS_WRITE_ENABLED`，未设置时跟随主开关。`conceptsWritable()` 在读关闭时必为 false。`GET /health` 返回 `{ ok, conceptsEnabled: 可读, conceptsWritable: 可写 }`，没有 `/api/health`。概念路由先检查读，变更再检查写；匹配查询和 `concept-graph/view` 只要求读。关闭一律 404 `CONCEPTS_DISABLED`。生成入口与对话工具看写开关。开关判断不放进 `concept.service` / `concept-practice.service` 的创建函数，避免单测在默认关闭时误伤。

Worker 在任务已被认领、模型尚未调用时，若写开关关闭，把该条 `concept_extract` 或 `concept_practice` 标为 failed（`lastError=concepts_disabled`），并用 `failConceptBatchByJobId` / `failConceptProposalByJobId` 写同一错误码。不走 `settleConceptBatchFailure`（那会写成 `job_failed`），也不把文章标失败，不自动重试。其他任务类型不动。

**生命周期（测试锁定，本阶段没有改产品删除语义）**

软删或硬删来源文档后，概念和摘录还在；出处解析为不可用，不会跳到另一句或另一篇。`concept_evidence.document_id` 在文档硬删时置空。本文引用和挂在该文上的说明随文档删除；共享概念还在。归档主题后，受管理卡离开协议 2 队列，普通未受管理卡仍可复习；归档前的复习令牌返回 409 `REVIEW_CONTENT_CHANGED`。归档主题不能再 `createConcept` / `createConceptBatch`（409 `TOPIC_ARCHIVED`）。删除主题会清掉该主题的概念域行；练习卡、复习日志、文档保留，文档的 `topicId` 按原有删除语义置空。

有一个已存在的边界，测试刻意避开了：练习卡如果在创建时概念已经有仍存活文档上的证据，`cards.documentId` 会指向那篇文档，硬删该文档会连带删卡。

**前端**

`ConceptsService.boot` 先请求 `/health`（不走会把 401 当成登出的 API client）。没有 `conceptsWritable` 且 `conceptsEnabled===true` 时，把写视为打开（兼容旧服务端）。health 失败则退回读接口探测。只读时写操作设「概念功能当前只读」且不发请求。`handleSync` 只在概念 scope 或断线补偿时重载图，不替换视口、过滤、查询、候选勾选、详情、选中、位置和高亮。复习枢纽的 sync 用服务端 today 整表替换，不把已离开队列的卡并回来。

本阶段补的两处产品缺口：

- 在文章工作区新建概念会写入本文引用；保存关系时把当前 `documentId` 传给 bundle。否则按本文范围重载会把刚建的节点刷掉。主题页（没有 documentId）仍不写本文引用。后发的 `loadGraph` 会作废先发的响应。
- `style-entry.css` 里概念样式的 `@import` 少了引号，浏览器把整条规则丢掉，节点矩形保持 SVG 默认黑色，文字也是黑色。已改为 `@import './features/concepts/concepts.css';`。生产构建的 CSS 含 `.concept-node`。

**验证命令与结果**（仓库根，2026-10-16）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @inwit/server exec vitest run` 指定的 T10/T11 文件（lifecycle、sync、flag、routes、job-flag、acceptance、practice、concept.service、review-protocol、conversation tools、batch） | 12 文件、71 测试通过 |
| `pnpm --filter @inwit/server test` | 109 文件、910 测试通过 |
| `pnpm --filter @inwit/web test` | 65 文件、448 测试通过（含概念 sync 与复习枢纽替换） |
| `pnpm typecheck` | 通过（含 mobile） |
| `pnpm --filter @inwit/dto build` | 通过 |
| `pnpm --filter @inwit/server build` | 通过 |
| `pnpm --filter @inwit/web build` | 通过两次：样式引号修复前一次，修复后再构建一次，产物 CSS 含 `concept-node` |
| `pnpm --filter @inwit/mobile typecheck` | 通过 |

`pnpm --filter @inwit/server test -- <文件>` 在 Vitest 5 下不会按文件过滤，所以上表的指定文件用的是 `exec vitest run`。

**浏览器**（CSI，session `m5-concept`，账号 `m5-verify@test.local`，主题「M5 验收」，文档 id `1243197f-7dcd-4039-8991-499d0ce29847`。只动这个验收账号的数据。）

截图在 `docs/plans/concept-relations/m5-evidence/`。

- `01-cycle-graph.jpg`：概念模式，Task / Trial / Step，边为「包含」「包含」「回到」。修复样式后节点为纸色、文字可读。
- `02-compare-1920.jpg`：对照模式。脑图（0 张卡）与概念图上下同时可见。学习区 dock 宽约 320px，低于横向排列阈值，所以不是左右双栏。
- `03-highlight-only.jpg`：选中 Task 后概念图 viewBox 不变。没有脑图卡，所以没有卡片高亮。详情里没有「定位」「返回」按钮。
- `04-after-reload.jpg`：刷新后再进概念模式，三个节点和三条边还在。
- `05-narrow-390.jpg`：390×844 时 `documentElement.scrollWidth === 390`，没有横向溢出。这张图的可见区域是助手栏，概念图在 DOM 里但不在这张截图的画面中。
- `06-practice.jpg`：关系「Task → 包含 → Trial」的练习对话框，有「智能出题」和手写题面/答案。截图取自提交前。随后选手写、类型改为关系辨析并提交，详情变为「查看练习」。没有点「智能出题」，没有调用模型。

第二标签打开同一文档，概念图同样是 Task / Trial / Step 与三条边。

用例说明：`e2e/cases/concept-relations.md`。没有生成 `e2e/suites`，因为这条路径依赖已登录的验收账号和本文引用，还没有稳定到可重复回放。

**A1–A25**

| 编号 | 证据 | 未覆盖 |
| --- | --- | --- |
| A1 | 验收测试「无 AI」；浏览器手写关系练习 | 选区「收为概念」这次没在浏览器点 |
| A2 | `concept-extract` 与 `concept-acceptance` 生成后、确认前正式知识为空 | 浏览器没有走真实模型生成 |
| A3 | 验收测试删掉 Step 及依赖边再确认；`concept-commit` 悬空边 422 | |
| A4 | 验收测试第二篇 reuse 不覆盖定义 | |
| A5 | `concept-extract` 同名不合并；`concept-commit` 推断未确认 422、同名并列 | |
| A6 | 浏览器关系详情有方向和谓词；lifecycle 出处不可用；2026-10-17 改掉引文后详情出现「原文已变化，无法定位，仅保留摘录」，摘录仍在 | 定位事件没有监听者，正文不会跳到对应块 |
| A7 | 验收测试关系练习三档反馈，间隔或难度有变化；概念练习仍无反馈 | |
| A8 | `concept-practice` 概念与关系反馈互不干扰；验收测试概念侧 feedbackCount 0 | |
| A9 | `concept-commit` 重复 requestId；`concept-extract` 取消与失败不改文章状态 | 浏览器没有测「生成中关页再恢复」 |
| A10 | lifecycle 的 sync 行其他用户不可见；commit 跨用户 404 | |
| A11 | `concept-extract` 无术语、超限、PDF、无效 JSON | |
| A12 | lifecycle 归档与旧令牌；`review-protocol` 旧端不领受管理卡 | |
| A13 | 浏览器对照上下双图；390 无横向溢出，`13-narrow-graph.jpg` 拍到概念环 | 窄屏里部分边被视口裁切；布局偏好的跨会话恢复沿用 M4 简化 |
| A14 | 选中概念不改 viewBox；点脑图卡后 Task 高亮且 viewBox 不变 | 没有定位/返回按钮；「定位原文」只派发事件 |
| A15 | `concept-practice` 绑定已有卡只绑首题并保留 cardId | 浏览器没绑已有卡 |
| A16 | 刷新、主题进入、直接进入和第二处打开后节点仍在 | 视口 localStorage、离开复习再返回未验 |
| A17 | 追加 Extra 刷新后还在；归档 Extra 刷新后消失且环还在；改正文后出处失效 | 显式定位的返回路径没有界面 |
| A18 | knowledge 接口里本文说明与共享定义分开；移除本文引用后另一篇文章的 Probe 还在 | 概念详情不展示本文说明 |
| A19 | 浏览器三节点环；`concept.service` 跨页边与「本文不引入他文边」 | |
| A20–A23 | `concept-practice.service.test.ts` 对应四条 | |
| A24 | `concept.service` 跨页边与环 | 浏览器只有 3 个节点，没翻页 |
| A25 | `review-protocol.test.ts` 与 practice 的旧端用例 | 没有拿旧版移动包实机点 |

**回退**

关闭入口：把 `CONCEPTS_ENABLED` 设为 false（或只关读/写），重启 API 与 worker。已有数据保留。普通未受管理卡继续复习。不要对已有 `concept` scope 行做 0044 的向下迁移，也不要把 worker 退回到不认识 `concept_extract` / `concept_practice` 的二进制。隔离测试库会在用例结束时 drop 自己的 schema。`.env` 里的 `CONCEPTS_ENABLED=true` 没有改。

**补验（2026-10-17）**

只在 `m5-verify@test.local` 上造数，没有点「智能出题」，队列里没有新的 digest。先建卡片再写正文，所以保存正文没有入队消化。验收文章改名为「M5 验收文章」，第一段是「每个 Task 是实验的基本单位。」。脑图卡「Task 的正文锚点」链到 Task。另有一篇「M5 对照文章」，只收录 Probe。Task 的本文说明与共享定义分开存放。随后把引文写回，`GET /api/concept-evidence/4fae6503-365d-4c2e-b18e-ea04a19c765a/resolve` 为 resolved、blockIndex 1。

新截图：

- `07-card-highlight.jpg`：对照模式。脑图有「Task 的正文锚点」，概念图是 Task / Trial / Step / Probe 的环。点卡片后正文引文高亮，概念相机没动。
- `08-evidence-detail.jpg`：Task 详情是共享定义「实验的基本单位。」，出处一条，按钮是「定位原文」。没有本文说明，也没有「定位」「返回」。
- `09-stale-quote.jpg`：正文改掉引文后，红字「原文已变化，无法定位，仅保留摘录」，摘录还在，卡片显示「原文已删除」。
- `10-topic-entry.jpg`：从 `/topics?topic=…&doc=…` 进入，地址留在主题页，引文和环都在，有「返回主题」。
- `11-ref-removed.jpg`：从本文去掉 Probe 后，验收文章只剩 Task / Trial / Step 环。
- `12-other-article.jpg`：对照文章仍是 Probe 和它的引文。
- `13-narrow-graph.jpg`：390 宽时概念图在画面里，环可读。部分边被视口裁切，没有横向溢出。

**未验证**

- 真实模型抽样没有执行，也没有授权。关系方向和事实支持没有人工样本记录。
- 定位/返回和多位置列表仍没有界面。`locateCard` / `returnFromLocate` 没有调用方。「定位原文」派发的 `inwit:concept-locate-block` 没有监听者。
- 复习页翻面后的关系、未保存草稿的 sessionStorage、概念图视口 localStorage，仍是 M4 遗留。这次刷新确认手工编辑不会自己留下来。
- 概念详情不展示本文说明。移除引用没有产品按钮，这次是接口删除后再看两篇文章。
- 键盘顺序、读屏、对比度、大图性能没有测。
- 同一张已有卡片绑成练习、历史不复制，这次没有在浏览器做。

**部署前还要人做的事**

1. 确认将要上线的 server 和全部 worker 都包含 `concept_extract` / `concept_practice` 与复习协议 2，再打开开关。
2. 先做追加迁移（含 0043、0044），不要用向下迁移当回退。
3. 用 `CONCEPTS_ENABLED` 或读写拆分变量控制范围。只开读、关写时，入口仍在，但不能新建、生成或收录。
4. 改完环境变量后重启 API 与 worker。Web 开发服务器如果早于 `/health` 代理和概念样式登记启动，需要重启 Vite，否则 `/health` 或概念样式可能仍是旧的。
5. 真实模型抽样、定位/返回和未保存草稿恢复，要另开任务，不在这次发布里假装已经完成。
6. 不要提交或部署，除非另外授权。

## 验收映射

| 需求 | 主要任务 | 覆盖用例 |
| --- | --- | --- |
| R1 选词收录 | T2、T3、T7 | A1、A4 |
| R2 选段梳理 | T4、T5、T7 | A2、A3 |
| R3 当前文章智能生成 | T3–T5、T7 | A2、A4、A5、A9–A11 |
| R4 手工维护 | T2、T6、T8、T10 | A1、A5、A12 |
| R5 关系阅读 | T2、T3、T8 | A6、A8、A24 |
| R6 定期复习 | T6、T9、T10 | A7、A8、A12、A20–A23、A25 |
| R7 双视图工作区 | T0、T8、T8a | A13、A19 |
| R8 本文语境 | T2、T4、T7a、T7 | A18、A19 |
| R9 共享卡与联动 | T6、T7a、T8b | A14、A15 |
| R10 连续状态 | T8a、T8b、T9、T10 | A16、A17 |
| 权限与兼容 | T1–T6、T9–T11 | A9、A10、A12、A25 |

## 完成定义

代码、迁移、类型和必要回归通过；人工浏览器验证覆盖完整闭环；旧卡片/图谱/复习兼容；生成与确认、收录与练习的边界可观察；无静默截断、越权和重复写入；每个失败路径都有可恢复的界面；双视图不抢焦点、联动不循环、卡片不复制、本文说明不覆盖共享知识，状态连续性验收通过。M1–M5 的完成情况见各交付记录。2026-10-17 用验收账号补了正文、出处、脑图卡和另一篇文章之后，主题进入、追加节点、正文失效、焦点归档、移除引用和窄屏概念图已经在浏览器看过。T11 里定位/返回、未保存草稿恢复和真实模型抽样仍未勾选。


## SubAgent 审查修订映射

| 问题 | 技术契约 | 实现及验收 |
| --- | --- | --- |
| P1 旧恢复绕过知识暂停 | 技术3.4：手动暂停与知识阻断独立、统一资格校验 | T6/T9/T10，A20 |
| P2 多题绑定目标不明 | 技术3.3：仅绑定实际首题，稳定questionId | T6/T9，A21 |
| P2 refresh后迟到反馈 | 技术3.5：reviewRevision/token及旧端能力门槛 | T6/T9/T10，A22/A25 |
| P2 改绑继承错误表现 | 技术3.5：binding/epoch/version归属 | T6/T9，A23 |
| P2 跨页关系遗漏 | 技术4.2：显式可见节点集合＋独立边分页 | T2/T8，A24 |

本轮为文档修订，以上测试仍是未来开发任务，尚未执行。
