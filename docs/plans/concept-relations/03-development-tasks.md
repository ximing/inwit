# 概念与关系开发任务计划

版本：v2（2026-10-15，文章学习工作区与双视图）。

> 执行说明：本文件仅为开发计划，本次不执行。未来获得开发指令后使用 superpowers:executing-plans 逐任务执行；如用户明确选择委派，再使用 superpowers:subagent-driven-development。步骤以复选框跟踪，不预先标记完成。

**目标：** 在文章统一学习工作区完成生成、确认、双视图对照、管理和复习闭环；主题页汇总跨文章知识。

**架构：** 增加独立概念、关系、证据与候选批次领域模块。Agent 仅生成候选，确认事务保存知识；练习绑定到现有卡片和复习状态。旧图谱与旧客户端接口保留。

**技术栈：** 当前仓库 React 19、@rabjs/react、Fastify、PostgreSQL/Drizzle、Zod、pi-agent-core、Vitest；首版 SVG 图，不增加图数据库。

**规格：** [需求方案](01-requirements.md)、[技术方案](02-technical-design.md)。执行前必须同时阅读；本文件中的文件路径标注「新增」的是计划路径。

## 全局约束

- 仅在得到后续开发指令后执行；本次不修改业务代码、不迁移、不部署。
- Web/桌面完成新体验；移动端保留普通文本练习兼容，新 UI 后续安排。
- 概念与关系先保存、练习显式加入；生成结果必须经预览确认才成为正式知识。
- 默认5–12个概念、最多20条关系；硬上限30概念/60关系；总文本最多60,000 Unicode字符，分片目标8,000字符。
- 候选推断关系默认不选；用户确认后保留 inferred 标记。
- 所有知识目标同用户同主题；复习继续按 cardId 排期；同目标同练习类型幂等。
- 正文变化使批次过期；不得强制提交过期结果。并发编辑使用整数版本。
- 首版不自动迁移历史卡片，不跨主题合并，不新增复习算法，不升级依赖。
- 每项任务完成自己的测试与自检；提交仅包含本任务文件。未来执行如需 commit，应遵循当时的分支和用户要求，不将下列清单视为本次提交授权。

- 文章工作区支持 outline/concepts/compare；脑图和概念图保持独立结构，概念图允许合法多节点环。
- 同一学习卡在脑图、知识详情和复习中共用 cardId；多个导航关联至多一个主要练习目标。
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

**文件：** 未来开发时扩展 `docs/design/prototypes/concept-relations.html`，本轮只写任务不改原型；评估结果记录在需求文档第8节和技术方案6.1。

**产出：** 同数据的双视图与脑图局部联系原型对照、最终工作区最小尺寸及排列规则。此任务仅验证产品形态，不建立第二套生产图模型。

- [ ] 准备一篇包含8章、20处划线、15张卡、12概念和18关系的示例，明确均为可控评估数据。
- [ ] 两版均提供状态恢复，完成找定义出处、跨章节定位、修改返回、候选确认、复习返回五类任务。
- [ ] 在1440×900、1920×1080、390×844记录完成路径、误选、重新缩放次数和可读面积；无真实用户测试时明确仅为设计走查。
- [ ] 校准正文360px、图320px×260px的起始阈值；将最终决定同步到需求及技术文档，不能把推测写成测试结论。范围若变化先评审，不能借验证扩大为完整混合图。

## T1：领域契约、数据库与迁移

**文件：** 新增三个 DTO 文件；修改 `packages/dto/src/index.ts`、`job.ts`、`agent.ts`（实际 job DTO 名称在开工时核对）、`apps/server/src/db/schema.ts`；新增 Drizzle 自动编号迁移及配套元数据。新增 `apps/server/src/concepts/concept-schema.test.ts`。

**接口：** 产出 Concept、ConceptRelation、ConceptEvidence、ConceptBatch、ConceptDraft、CommitConceptBatchInput、ConceptPracticeBinding 及对应 Zod schema；补充 DocumentKnowledgeRef、ConceptNote、CardKnowledgeLink、KnowledgeLocation 契约；字段以技术方案为准。新增正式表、notes、batches、bindings、document_knowledge_refs、card_knowledge_links、幂等记录及练习建议结果存储。

- [ ] 编写 schema 测试：第31个概念/第61条边拒绝；引用联合类型不能混用；字符串限制按 Unicode 字符；练习目标必须恰一非空。
- [ ] 在隔离测试库验证复合外键：跨用户/跨主题端点拒绝、自环拒绝、关系身份唯一、来源 documentId 删除置空；文档引用/卡片导航链接目标恰一、重复唯一、同用户隔离。
- [ ] 实现 DTO、表定义和迁移，补 job/agent 枚举数据库 CHECK；migration 编号依据最新仓库生成。
- [ ] 验证从当前版本迁移以及重复 migrate 的正常行为；旧卡片、旧复习日志行数和内容保持一致。
- [ ] 运行 `pnpm --filter @inwit/dto build`、`pnpm --filter @inwit/server test -- src/concepts/concept-schema.test.ts`，应通过；提交前检查仅含本任务变更。

## T2：手动创建、关系 CRUD 与去重身份

**文件：** 新增 `concept.service.ts`、`concept-identity.ts`、`concept.routes.ts` 及对应测试；修改 `apps/server/src/app.ts` 注册路由。

**消费：** T1 正式实体 DTO/表。

**产出：** `normalizeConceptName(value: string): string`、`findConceptMatches(userId, topicId, input): Promise<ConceptMatch[]>`、`saveConceptBundle(userId, topicId, input): Promise<ConceptBundleResult>`、`getConceptGraph(userId, topicId, query): Promise<ConceptGraphPage>`，以及技术方案 CRUD 路由。

- [ ] 编写身份测试：空白/大小写规范化保留原展示名；同名不同 sense 可建两条；别名只推荐不直接合并；关系语境不同保持两条。
- [ ] 编写真实 DB 事务测试：手动新建两端及关系任一步失败全部回滚；重复 bundle requestId 返回同一结果；不同 body 同 key 返回409。
- [ ] 实现 CRUD、版本冲突409、归属404、软归档、图分页及名称/别名检索；复合端点约束不只依赖前端。
- [ ] 编写路由测试：归档主题拒绝写入；分页最多100列表/50图节点；返回边两端均可见，外部邻居有展开提示。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-identity.test.ts src/concepts/concept.service.test.ts src/concepts/concept.routes.test.ts`，所有上述断言通过。

## T3：正文快照、证据核验与来源跳转

**文件：** 新增 `concept-evidence.ts`、`concept-evidence.test.ts`；定点复用当前文档块/纯文本工具；补充来源解析路由。

**消费：** T1 Evidence/locator；T2 ownership 检查。

**产出：** `snapshotConceptSource(userId, documentId, scope): Promise<ConceptSourceSnapshot>`、`validateEvidence(snapshot, evidence): EvidenceValidation`、`resolveConceptEvidence(userId, evidenceId): Promise<EvidenceResolution>`。新增 GET `/api/concept-evidence/:id/resolve`，返回 resolved/stale/unavailable 及可用定位。

- [ ] 测试正文一致而标题变化 hash 不变；正文变化 hash 改变；空文、未提取 PDF 和60,001字符分别产生可识别错误。
- [ ] 测试真实引文通过、虚构引文拒绝；重复引文无唯一上下文时返回 stale，不能选第一个匹配。
- [ ] 实现块/页快照、范围校验、长块切片偏移和覆盖清单；60,000字符以内每个处理范围都能映射回出处。
- [ ] 测试文档软删除/硬删除后 unavailable；引用摘录仍在但跳转禁用；跨用户 evidenceId 返回404。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-evidence.test.ts`，所有断言通过。

## T4：候选生命周期、确认与并发幂等

**文件：** 新增 `concept-batch.service.ts`、`concept-commit.ts`、各自测试；扩展 `concept.routes.ts`。

**消费：** T1 Draft/Decision；T2 bundle 身份策略；T3 正文 hash 与证据校验。

**产出：** `createConceptBatch(userId, documentId, input): Promise<{batchId,jobId}>`、`updateConceptDraft(userId, batchId, input): Promise<ConceptBatch>`、`commitConceptBatch(userId, batchId, input): Promise<ConceptCommitResult>`。

- [ ] 编写 ready→committed 状态测试；非 ready 拒绝；expectedDraftRevision 或正文 hash 变化返回409；inferred 未确认返回422。
- [ ] 编写选择依赖测试：取消节点却保留依赖边返回422；reuse 不替换主定义，追加 notes 和证据；same-name 不默认 reuse；接受结果同事务创建本文引用，回滚时不留孤立引用。
- [ ] 实现批次、幂等记录、topic/batch 行锁、临时ID映射、关系唯一性与单事务提交结果保存。
- [ ] 用两个真实 DB 连接同时确认同一批次，断言只生成一份实体和相同响应；不同批次同一关系补证据不重复；失败注入后无半成品。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-batch.service.test.ts src/concepts/concept-commit.test.ts`。数据库测试不得以 mock transaction 代替。

## T5：文章 Agent 智能生成与对话接入

**文件：** 新增 `agent/concept-extract.ts`、`agent/concept-extract.test.ts`、`agent/conversation-concept-tools.ts` 及测试；修改 `jobs/processors.ts`、`jobs/queue.ts`、`jobs/cancel.ts`、`agent/conversation.ts`，扩展对话动作 DTO（定位实际文件后修改）。

**消费：** T3 source snapshot；T4 批次生命周期；现有 runAgentJob、enqueueJob。

**产出：** `processConceptExtract(job: JobRow): Promise<void>`；工具 `propose_article_concepts({documentId,topicId,scope})` 返回 batchId/jobId；对话动作卡打开批次，不携带正式写入权限。

- [ ] 建立固定夹具：术语密集、无术语、同名异义、跨篇重复、恶意文章指令、超长文、PDF 文本、无效JSON八类输入。
- [ ] 测试生成期不写正式 concepts/relations/cards；原文支持项必须通过引用检查；推断默认未选；自环和悬空引用拒绝。
- [ ] 实现8,000字符分片、汇总、匹配建议、一次格式修复和硬限错误；所有范围显示 coverage，无结果也可 ready。
- [ ] 接入现有模型配置、心跳、日志和队列；终态失败/取消回写 batch；取消后的迟到结果不再覆盖状态；重试不覆盖 ready 的人工编辑。
- [ ] 测试有当前文章的对话可生成，没有文章或主题时返回待选择动作；无权文章拒绝；明确要求仅生成不触发正式收录。
- [ ] 回归 `pipelineDocumentId`/任务失败传播：concept_extract 失败不把正常文章标为 failed。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/agent/concept-extract.test.ts src/agent/conversation-concept-tools.test.ts src/jobs/queue-logic.test.ts`，固定模型替身测试通过；人工模型样本评审另记结果，不作为唯一自动门禁。

## T6：练习绑定、智能出题与旧复习接入

**文件：** 新增 `concept-practice.service.ts`、`concept-practice.service.test.ts`、`agent/concept-practice.ts` 及测试；修改 `review/review.service.ts`、`concept.service.ts`、`jobs/processors.ts`、相关 DTO/路由。

**消费：** T1 Practice DTO；T2/3 已确认知识和出处；现有 card_questions/review_states。

**产出：** `bindExistingConceptPractice(userId, input)`、卡片导航链接CRUD，以及 `createConceptPractice(userId, input): Promise<ConceptPracticeBinding>`、`refreshConceptPractice(userId, bindingId, input): Promise<ConceptPracticeBinding>`、`processConceptPractice(job): Promise<void>`、`invalidateConceptPractices(tx, target): Promise<void>`。

- [ ] 测试仅收录知识时 cards/review_states 数量不变；创建练习事务中四表要么全成功要么无写入。
- [ ] 测试同目标同 exerciseKind 重复加入返回已有卡；模型题面只是建议，确认前没有练习；无AI可手写题面加入。
- [ ] 实现 recall/compare/scenario 到 cloze/compare/judge 的一致映射、可读 Card 文本和可选 knowledgeTarget；新增练习入队沿用现有初始排期。
- [ ] 测试概念定义练习和相邻关系练习的反馈互不改写；同一个目标的不同题型独立排期。
- [ ] 新增 `card-knowledge.service.ts` 和测试，支持同卡多个导航目标；主要练习目标唯一，跨用户拒绝，同用户跨文章来源不改卡片topicId。
- [ ] 显式绑定已有脑图卡，断言 cardId、题目、原有排期/暂停、历史及脑图归属完全不变；未入队卡不自动入队。同目标同题型冲突和同卡不同主目标返回409。
- [ ] 同卡两个导航目标只有主目标计分；解除绑定保留卡及历史；删除主要导航链接要求先解除主绑定。新建卡显式挂脑图复用已有挂载流程，不复制卡。
- [ ] 接入目标语义变化/归档导致的暂停；概念重命名导致相邻关系练习失效；追加证据不失效。旧界面继续提交暂停练习应拒绝。
- [ ] 实现 refresh 原子更新题面答案并重置学习状态，保留 review_logs；暂停及恢复行为与手动暂停不混淆。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/concepts/concept-practice.service.test.ts src/agent/concept-practice.test.ts src/review/review.routes.test.ts src/review/review-logic.test.ts`，旧复习回归通过。

## T7a：本文知识范围、说明与位置解析

**依赖：** T1–T4、T6。**文件：** 新增 `document-knowledge.service.ts`、`document-knowledge.service.test.ts`，扩展 `concept.routes.ts`；对应 Web API。

**产出：** `getDocumentKnowledge(userId, documentId, topicId, query)`、`setDocumentKnowledgeRef(userId,input)`、`removeDocumentKnowledgeRef(userId,input)`、`resolveKnowledgeLocations(userId,documentId,topicId,target)`；接口与技术方案4.1一致。

- [ ] 测试本文关联概念不等于本文支持其所有主题关系；引用关系只带出必要端点并标 endpoint_context；其他文章信息需显式展开。
- [ ] 实现引用CRUD和notes独立版本编辑，手工bundle/批次commit自动写refs；从本文移除概念确认连带本文关系，不能删除共享知识、证据或卡片。
- [ ] 测试“本文解释”只更新notes；共享定义变更才触发知识版本及相关练习失效。存在历史证据不自动恢复已移除引用。
- [ ] 实现按真实 card/annotation/画布挂载查询多处位置；缺脑图节点返回evidence-only，失效证据不生成虚假节点；跨用户全部404。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/concepts/document-knowledge.service.test.ts src/concepts/card-knowledge.service.test.ts`，断言通过。

## T7：文章创建入口和候选图预览

**文件：** 新增 `apps/web/src/api/concepts.ts`；新增 `features/concepts/concept-draft.service.ts`、`concept-draft-dialog.tsx`、`concept-editor.tsx`、`concept-selection-logic.ts` 及测试；修改 `pages/docs/doc-toprow.tsx`、`selection-toolbar.tsx`、`pages/docs/index.tsx`，对话结果动作组件。

**消费：** T2 手动 bundle；T4 批次API；T5 Agent生成；T7a 本文知识范围。候选图组件可以先用列表表达，T8补齐图形共用组件。

**产出：** `ConceptDraftService.open({documentId,topicId?,selection?})`、`startGeneration()`、`loadBatch(batchId)`、`saveDraft()`、`commitSelected()`；`ConceptDraftDialog` 的内容由文章和对话共用，文章中嵌入概念区；不再仅提供脱离工作区的弹窗。

- [ ] 编写选择纯逻辑测试：取消新节点自动取消依赖边；可重绑定已有节点；推断关系默认未选；用户改为同名异义后可创建。
- [ ] 在文章内提供查看/编辑/管理本文概念、连接关系、区分本文说明与共享定义及从本文移除；实现选词手工创建、选段梳理、整篇生成三个入口；没有主题时内联选择/新建；脏文档先保存，失败不生成。
- [ ] 实现任务阶段、后台恢复、零结果、超限章节选择、失败重试、批次过期提示；对话动作卡使用相同预览。
- [ ] 实现编辑节点/谓词/方向/出处、沿用已有概念、收录数量摘要及显式提交；收录后提供可跳过的练习选择。
- [ ] 测试文章A生成中切B、旧请求晚到，不污染B；反复点击只发送幂等请求；冲突409保留本地编辑并要求重新预览。
- [ ] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-selection-logic.test.ts src/features/concepts/concept-draft.service.test.ts`；浏览器验证从文章入口到正式网络出现。

## T8：文章与主题共用的概念图、索引和详情

**文件：** 新增 `features/concepts/concept-graph.tsx`、`concept-graph-layout.ts`、`concept-graph-layout.test.ts`、`concept-detail.tsx`、`relation-detail.tsx`、`relation-editor.tsx`、`concepts.service.ts`、`concepts.css`；修改 `pages/topics/index.tsx` 和 `routes.ts`。

**消费：** T2 图/检索/编辑接口；T3 证据解析；T7 共享候选组件。

**产出：** `layoutConceptGraph(nodes,edges,previousPositions?): ConceptGraphLayout`；主题概念入口；可定位 conceptId/relationId 的地址参数；共同图组件用于正式图和候选图。

- [ ] 编写图数据测试：方向与谓词一致、只渲染完整端点关系、50节点分页继续展开、空图可创建。布局至少保证节点不重叠、标签不压节点；合法多节点环可显示，新数据保留已有位置，不触发fit-all。
- [ ] 实现关系图/索引切换、邻居聚焦、本文过滤、名称别名搜索、推断与复习过滤；图上可选概念和关系。
- [ ] 实现侧栏解释、例子、语境、来源和练习摘要；已有概念中「添加关联概念」、方向预览和归档影响说明。
- [ ] 接入出处解析，成功后沿用主题托管文章路由；失效/来源删除展示快照，不能静默跳错句。
- [ ] 在1440×900、1920×1080和390×844浏览器检查：页面不横向溢出，局部图可滚动，列表可访问所有内容，键盘可操作，无必须悬停的功能。
- [ ] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-graph-layout.test.ts src/routes.test.ts`，并保存人工视觉检查结果。

## T8a：文章工作区、布局与完整状态恢复

**依赖：** T0、T7、T8。**文件：** 新增 `features/study-workspace/study-workspace.tsx`、`study-workspace.service.ts`、`study-state.ts`、`study-state.test.ts`、`study-layout.ts`、`study-layout.test.ts`、`outline-adapter.ts`；修改现有 DocsPage 挂接点，不重建阅读器。

**产出：** `StudyWorkspaceStateV1`；`capture(viewKey)`、`restore(viewKey,snapshot,viewportSize)`；outline/concepts/compare 三模式，stacked/columns 两排列，preferred/effective分离。

- [ ] 编写状态测试：用户/文章/主题key隔离；脑图、正式概念图、候选图互不覆盖；schemaVersion错误可安全回退；50篇LRU及存储不可用退回内存。
- [ ] 实现同页对照、可调分隔和临时聚焦；用T0确认阈值降级，恢复空间后回到用户偏好；分隔线可键盘操作。
- [ ] 实现正文锚点、两图视口/展开/焦点、索引详情滚动、过滤布局的capture/restore；订阅现有脑图状态，不能保存两份冲突真值。
- [ ] 按技术方案实现内存、localStorage、sessionStorage与服务端draft分工；500ms debounce及路由切换flush；未提交表单切视图和刷新不丢失，版本冲突不自动覆盖。
- [ ] 测试隐藏区零尺寸不重置；数据和布局完成后才恢复；正文更改/节点删除/图增量加载按有效锚点回退；两个标签不抢视口；路由返回目的地不被旧状态覆盖。
- [ ] 运行 `pnpm --filter @inwit/web test -- src/features/study-workspace/study-state.test.ts src/features/study-workspace/study-layout.test.ts`；真实浏览器验证切模式、调整窗口、离开返回、刷新和不同用户隔离。

## T8b：双视图联动与共享卡片操作

**依赖：** T6、T7a、T8、T8a。**文件：** 新增 `features/study-workspace/study-link.service.ts`、`study-link.service.test.ts`，扩展脑图adapter与两种知识详情。

**产出：** `select({eventId,originView,documentId,topicId,target,intent})`、`locate(locationId)`、`returnFromLocate()`；同卡跨视图操作引用同一ID。

- [ ] 测试选择脑图卡只改变概念图高亮集合，不改其相机/选中/展开；反方向相同；相同eventId不反复传播，旧文章响应丢弃。
- [ ] 实现隐藏/未加载/折叠目标计数、多个出现位置选择及显式定位；定位才加载/展开/平移，返回还原此前过滤、折叠和相机。
- [ ] 在本文中查看已有学习卡、关联多个知识目标或设主练习目标；编辑同卡两边刷新，复习历史唯一。新卡显式挂载脑图后能双向定位。
- [ ] 测试没有脑图节点时仅提供原文位置，不伪造节点；只移除画布挂载不删卡或知识链接；卡片删除后高亮映射失效。
- [ ] 运行 `pnpm --filter @inwit/web test -- src/features/study-workspace/study-link.service.test.ts`；浏览器验证完整多位置定位与返回，禁止自动双相机联动。

## T9：练习预览、每日复习和返回上下文

**文件：** 新增 `features/concepts/concept-practice-dialog.tsx`、`concept-practice.service.ts` 及测试；修改 `pages/review/review.service.ts`、`pages/review/index.tsx`（子组件按实际位置接入）、关系/概念详情。

**消费：** T6 题目建议、确认、refresh；T8a/T8b工作区与返回状态；既有每日队列和三档反馈。

**产出：** 从知识目标手工/智能生成练习、编辑确认、加入/查看练习；翻面后回到目标及出处，返回保持当前题目和翻面状态。

- [ ] 测试仅点击打开练习对话框不入队，确认后入队；重复点击已有练习展示已有卡；模型失败允许手填。
- [ ] 实现题面答案编辑、目标版本展示和新旧题对比；needsRefresh 练习默认暂停并给「更新练习」入口。
- [ ] 实现复习知识目标来源标签；揭晓前不显示关系答案；翻面后可看来源并返回，不跳过题也不重复提交反馈。
- [ ] 测试定义与关系的不同反馈独立展示；没有练习时显示未加入，不把有出处显示成已掌握。
- [ ] 运行 `pnpm --filter @inwit/web test -- src/features/concepts/concept-practice.service.test.ts src/pages/review/review.service.test.ts`；检查移动端旧文本题型可正常展示及反馈。

## T10：跨页面同步、生命周期与发布开关

**文件：** 修改 `apps/server/src/config.ts`、sync DTO/触发器注册与迁移、`apps/server/src/sync/sync.service.ts`、`apps/web/src/features/concepts/concepts.service.ts` 及 sync 订阅；必要时修订文档/主题删除服务；新增对应集成测试。

**消费：** T1–T9（含T7a、T8a、T8b）完整领域及UI。

**产出：** CONCEPTS_ENABLED 默认 false；新实体变更通知；归档、删除、来源失效与队列暂停一致性。

- [ ] 测试开关关闭时不显示入口，不接受新生成和写入；既有普通练习继续可复习。
- [ ] 实现概念、关系、证据、本文引用、notes、卡片导航链接及绑定变化的同步失效；只刷新业务数据，不重置视口/过滤、不覆盖未保存输入；事件不携带越权数据。
- [ ] 测试删除来源文档不删知识，失效跳转可见；归档主题暂停其绑定练习并禁止新生成；删除主题按产品已有语义清理新增领域数据。
- [ ] 测试多个标签页目标更新后旧反馈被拒绝；页面收到事件刷新，不能因过期缓存错误恢复已暂停练习。
- [ ] 运行 `pnpm --filter @inwit/server test -- src/sync/sync-trigger.contract.test.ts src/concepts/concept-lifecycle.test.ts` 及新增前端 sync 测试，所有生命周期断言通过。

## T11：端到端验收与发布准备

**文件：** 新增浏览器验收用例 `e2e/cases/concept-relations.md`（如仓库有既定 e2e 目录则跟随）；更新本计划验收记录、已有API生成产物及必要产品说明，不另外扩张功能。

**消费：** T1–T10。

- [ ] 在隔离数据库运行全链路：导入示例文章→整篇生成→取消一节点及依赖关系→修改谓词→确认→第二篇复用→查看出处→加入关系练习→三档反馈。
- [ ] 在对照模式验证两个图同时可见，选择只高亮，定位/返回可恢复；脑图卡复用后ID和历史唯一，合法带环图正确展示。
- [ ] 验证从主题及直接进入同一文章、刷新、两标签、窗口尺寸变化、追加节点、正文变更和焦点删除；状态恢复且返回路径正确。
- [ ] 验证本文补充与共享定义分离、移除本文引用不损坏其他文章、候选及手工未保存编辑在当前标签刷新后恢复。
- [ ] 执行无AI手动创建和手写练习；确保基础能力不依赖模型。
- [ ] 执行原文变化、两个标签重复确认、任务取消、worker终态失败、同名异义和推断确认用例。
- [ ] 核对需求 A1–A19 全部有验收证据；人工审阅样本的关系方向与事实支持，记录模型、样本长度、修改原因，不记录密钥。
- [ ] 运行 `pnpm --filter @inwit/dto build`、`pnpm --filter @inwit/server typecheck`、`pnpm --filter @inwit/web typecheck`、server/web 的 `test` 与 `build`；DTO 波及移动端时运行移动端现有 typecheck 命令（先核对 package.json）。所有失败需解释并解决，不能把计划中的命令写成已通过。
- [ ] 验证迁移与关闭开关的回退流程；确认所有 worker 已支持新 job 类型后才安排开放入口。
- [ ] 完成任务评审与最终变更检查，再单独进入部署流程；本计划不包含执行部署授权。

## 验收映射

| 需求 | 主要任务 | 覆盖用例 |
| --- | --- | --- |
| R1 选词收录 | T2、T3、T7 | A1、A4 |
| R2 选段梳理 | T4、T5、T7 | A2、A3 |
| R3 当前文章智能生成 | T3–T5、T7 | A2、A4、A5、A9–A11 |
| R4 手工维护 | T2、T6、T8、T10 | A1、A5、A12 |
| R5 关系阅读 | T2、T3、T8 | A6、A8 |
| R6 定期复习 | T6、T9、T10 | A7、A8、A12 |
| R7 双视图工作区 | T0、T8、T8a | A13、A19 |
| R8 本文语境 | T2、T4、T7a、T7 | A18、A19 |
| R9 共享卡与联动 | T6、T7a、T8b | A14、A15 |
| R10 连续状态 | T8a、T8b、T9、T10 | A16、A17 |
| 权限与兼容 | T1–T6、T10、T11 | A9、A10、A12 |

## 完成定义

代码、迁移、类型和必要回归通过；人工浏览器验证覆盖完整闭环；旧卡片/图谱/复习兼容；生成与确认、收录与练习的边界可观察；无静默截断、越权和重复写入；每个失败路径都有可恢复的界面；双视图不抢焦点、联动不循环、卡片不复制、本文说明不覆盖共享知识，状态连续性验收通过。所有任务目前均未开始。
