# PDF 段落翻译流式显示方案

状态：实现与隔离本地验收完成；测试与限制见末节。2026-11-18。延续 `pdf-english-reading-translation.md` 的产品边界及计费/生命周期规则；本轮不部署、不运行真实收费调用、不清空用户本地配置。

## 1. 已确认的路线

用户确认当前没有 WebSocket，授权采用适合单向输出的方式实现。最终选择 **fetch SSE**，保留现有 `pdf_translate` 异步队列：供应商 text_delta → 带执行令牌保护的持久草稿 → PostgreSQL 标识通知 → API SSE 累计快照 → 原段落浮层逐步显示。断线后只读 GET 恢复，不新建队列，不增加 WebSocket，也不自动重调用模型。

当前工作树原先只有同步游标轮询和聊天持久草稿轮询；它们不是现成 WebSocket。此前“复用已有 WebSocket”的候选已撤销，不能把本轮 SSE 描述为复用了已有 WebSocket。

## 2. 当前代码事实

| 范围 | 本轮之前 | 本次实现 |
| --- | --- | --- |
| 创建/去重 | `translation.service.ts` 的内容锁、幂等请求别名、业务任务与 carrier | 保持创建接口和单次派发，不创建流式专用任务队列 |
| 执行 | `processor.ts` 在 durable dispatched 后调用 `completeTranslation`，最终一次提交 | 消费模型文字 delta、节流草稿写入、终态收口 |
| 前端 | `PdfTranslationService` 按 job GET 轮询，500ms 起逐步到 2000ms；后台暂停；documentEpoch/generation 防旧响应 | 草稿独立状态、版本合并、订阅生命周期和丢消息恢复 |
| 浮层 | 已保存译文/任务状态；查看原文暂隐整个浮层并可恢复 | 未完成草稿逐步显示、断流与重连状态；保留现有定位、收起和恢复 |
| 全局同步 | `SyncService` + `GET /api/sync`，数据库 `sync_changes` 游标 | 不把高频正文 delta 塞进现有全局 sync_changes |
| 聊天 | `agent/conversation.ts` `createDraftSink` 消费 Agent text_delta，约 150ms 串行写入累计草稿 | 复用节流/串行写入思路；草稿持久化采用 best-effort，不影响最终成功事务；不复用聊天任务/配置 |
| 推送传输 | 原工作树没有WebSocket/SSE | 本次新增只读fetch SSE；现GET轮询保留降级 |

依据文件：`apps/web/src/pages/docs/pdf-pane/pdf-translation.service.ts`、`pdf-translation-popover.tsx`、`apps/web/src/services/sync.service.ts`、`apps/server/src/agent/conversation.ts`、`apps/server/src/conversations/conversation.service.ts`、`apps/server/src/documents/translation/processor.ts`、`apps/server/src/llm/translation-call.ts`。项目记忆也明确旧同步方案选择轮询，但代码为本轮事实依据。

## 3. 不变的产品与费用规则

- 英文 PDF 仍是主体，只有用户点击段落或明确选择文字翻译才生成。不开启整页/全文自动翻译，不新增预算、次数或字符额度。
- 聊天与翻译模型、凭据和设置继续隔离。任务沿用创建时冻结的模型/凭据版本；流式期间不能跟随设置变动偷偷换模型或密钥。
- 一个业务任务最多一次供应商请求。多标签、多订阅者、重连、刷新、缓存命中均不能产生第二次请求。SDK/传输重试必须关闭或受现有单请求 guard 限制。
- queued/preparing 的取消与 dispatched 转换持同一业务锁。派发后的浏览器断开、收起浮层、切段不等于取消模型，不承诺停止计费。
- 只有完整、正常成功且通过既有文件版本/执行令牌校验的最终结果，才写入正式译文和 currentTranslationId。收到若干 delta 不代表成功。
- 使用量只接受供应商实际报告。中途断流缺 usage 仍是 unknown/null，不能按草稿长度编造 token，更不能把 SDK 缺省 0 当已知 0。
- dispatched 后无法确认完成/费用的中断保持 unknown，不自动重派；显式重试沿用现有确认规则和新幂等键。

## 4. 持久草稿与事件契约

### 4.1 草稿存放与写入

优先在现有 `pdf_translation_jobs` 扩展字段，避免新建任务系统：

- `streamId`：业务 job 创建时生成的公开 UUID，用于辨识草稿实例；不是 `executionToken`，执行令牌/凭据永不发送客户端。
- `draftText`：累计纯文本，和正式 `pdf_translations` 分离。
- `draftSeq`：持久单调版本，REST/SSE 用十进制字符串，不能经 JS Number 处理 bigint。
- `draftUpdatedAt`：最新草稿更新时间；当前没有独立 `firstDeltaAt` 字段，首字指标在测试端采集，终态依旧以业务 state/finishedAt 为准。

字段由本轮迁移 0047 落地。无客户端提交草稿文本接口。

安装的 pi-ai 1.1.0 中 completeSimple 本来就是 streamSimple(...).result()。本次直接消费 streamSimple 的文字事件，不换供应商协议、不做假打字动画。text_end 和 done/result 为文本修正/终态权威；partial 是共享可变对象，不能异步持有引用。保留单 HTTP observedFetch guard、raw SSE usage 合并、原 60 秒超时和 stopReason 分类。

worker 每次文字 delta 只更新内存累积缓冲；首个非空草稿立即写入，之后约 150ms 合并一次，且最多一个持久写操作在途，不能每 token 开一个事务。积压时合并到最新累计文本，不排无限 flush promise 队列。事务按现有 document → content → business → carrier 锁序校验 user/document/fileRevision、未软删除、executionToken/attempt、state=dispatched，然后递增版本并写入累计草稿。部分文本只来自公开回答的 text_delta，不保存 thinking、工具数据或供应商原始事件。

节流间隔是交付目标，不是计费/内容长度配额。输出仍受已冻结模型能力/上下文预算约束。消息较大时走 snapshot/分片或仅发送版本通知，不能为了传输方便截断成功译文。

最终事件先等待/收束草稿 writer，再进入已有成功事务：验证 finish reason、完整正文与用量，写正式 translation、更新 current 指针、终结 job、递增草稿版本并清空成功草稿。不得让迟到 flush 将终态恢复成 dispatched 或覆盖最终结果。数据库写入失败时不宣布已保存；后续按原有 token/lease 恢复语义处理，不能用模型重调用来“修复”展示。

失败/unknown 可以保留部分草稿供当前任务显示，明确“未完成，未保存为译文”；重试创建新 job/streamId，旧草稿不续接到新模型回答。当前未实现失败草稿 TTL，随业务任务保留并由文档物理删除级联清理；不新增清理队列。

### 4.2 冻结的 REST/SSE 契约

`GET /api/documents/:id/translation-jobs/:jobId/stream` 为只读订阅，credentials cookie 使用现有 browserFetch，不用自动重连的 EventSource，避免认证失效静默重试。每个 `event: snapshot` 的 data 都是完整 `PdfTranslationJob`，与现 GET job 同型，扩展：

```ts
draft?: { streamId: string; seq: string; text: string; updatedAt: string } | null
fileRevision?: string
generationRevision?: number
```

新增字段 optional 兼容旧客户端/fixtures，服务端新版本保证返回。POST 的 job 同样携带这些字段。SSE id 可使用 draft.seq；终态 snapshot 即使 seq 未增加也必须接收状态转换，不能仅凭 seq 去掉整包。只传累计 snapshot，不要求客户端拼接 delta，丢几个中间帧后收到更大 seq 可直接替换全文。相同 job 的 terminal 后到达旧 active 必须忽略；同 streamId 更小 seq 不能覆盖新草稿，但确认终态仍可收口。新 job 单独流/版本，不能混入前一轮草稿。

`event: error` data `{code:'AUTH_EXPIRED'|'RESOURCE_UNAVAILABLE'|'STREAM_UNAVAILABLE'}` 后连接关闭；初始未授权仍 HTTP 401。STREAM_UNAVAILABLE 允许客户端降级只读轮询。15 秒 comment 心跳；连接没有固定时长上限，直到终态、取消订阅或权限失败。所有错误脱敏，流中不含 key、内部 executionToken、thinking 或工具事件。SSE 的取消只是退订，不取消模型任务。

## 5. API/worker 分离与恢复

worker 同事务更新持久草稿并发 PG NOTIFY，载荷仅含任务标识。API 独立进程 LISTEN 后重新读快照、验证用户/文档权限，再发送 SSE。通知不是可靠日志；丢通知、LISTEN 重连由每 1.5 秒只读对账并尝试恢复 LISTEN 连接，不能触发第二次模型调用。提交成功后通知发送失败不能把成功任务改回失败。

注册任务唤醒监听后读取最新 snapshot，注册期间更新按版本合并，避免“先读后订阅”窗口。API 多实例各自维护连接，不依赖 worker 与 API 共享内存。慢客户端合并中间状态/背压处理，必要时关闭连接让其 GET 恢复；不能阻塞模型或堆积无限正文。

每次订阅与快照读验证会话、job.userId、文档归属/软删除、fileRevision。会话过期/注销后停止投递；删除或替换文档时撤销订阅并清客户端。订阅不创建任务，猜 jobId 不能获得他人草稿。代理须关闭 SSE 响应缓冲，保持 text/event-stream 和 no-cache；部署验收不能只用单进程开发环境。

前端初次打开仍走现有幂等 POST 获取业务任务，随后 SSE 先返回 snapshot。100ms 合并绘制，终态立即收口。流结束/解析错误/网络不可达或45秒无业务快照，转现有只读 GET 轮询；后台或关闭中止fetch和计时器，恢复先 GET 当前任务再订阅。降级期间可见界面仍渐进更新草稿，不自动 retry/regenerate。新的 GET 响应也经过相同版本/终态/文档代际校验，防迟到响应回退状态。

## 6. 前端状态和交互

`PdfTranslationService` 保留已有 documentEpoch/generation/target.key 过滤，再加入 jobId/streamId/seq。草稿存于 `cache[key].job.draft`，与该条目的正式 `translation` 分离，不能当作成功缓存。只让当前文档版本、当前段落、当前任务更新可见浮层；关闭或切段后的迟到消息直接忽略，不能切换用户正在看的段落。

- 首次翻译：未见文字显示排队/准备；首个有效 text_delta 后逐步显示，保留“翻译中，尚未保存”。以纯文本渲染，禁止将模型字符串作 HTML。
- 不强制滚动译文或 PDF，保留读者当前滚动位置。100ms 合并 React 更新，避免每 token 布局。屏幕阅读器只温和播报阶段，不逐 token 播报整篇。
- 首字增长可能改变浮层高度，沿用当前避让/最大高度/滚动策略；不抢焦点、不滚动英文 PDF。查看原文隐藏整个浮层，恢复只读取当前草稿/缓存，不另发生成。
- 收起/切段/离开文档：取消本视图订阅和计时器，递增 generation；不取消已派发模型。再次打开沿用已知 jobId 读取快照，不能把“本地丢了草稿”当作新请求理由。
- 页面隐藏：停止 UI 推送处理/退订及降级轮询；不影响其他功能的连接。恢复可见先取 snapshot 再继续订阅。documentEpoch 变化或文档失效立即清对应草稿与成功缓存。
- 重新翻译：旧成功译文始终保留为可读版本，新草稿单独标“重新翻译中”。完成成功才替换；失败/unknown 不覆盖旧成功，部分新草稿标未完成或折叠展示。客户端必须知道新 active job，即使 response 同时包含旧 translation，也不能提前停止订阅。
- 断流：区分“连接重连中（任务可能仍在执行）”与服务端确认 failed/unknown。前者只重新订阅/GET；后者沿用显式重试提示，不把断 SSE 当供应商失败。

## 7. 并发、取消和失效边界

- 保持原业务锁和执行令牌：草稿写/最终写都必须受其保护，不能新增无锁草稿快路径。
- worker preparing 阶段被取消后，旧 worker 不得派发/写草稿；dispatched 之后不因 SSE 无人订阅而自动中止或重新派发。
- worker 真正崩溃后，dispatched 的 lease 过期按原规则进入 unknown；恢复只发布最后持久草稿和状态，不能接着给供应商发第二请求。数个未flush token可能丢失，允许展示不完整草稿，但不能虚称完整缓存。
- 软删除/文件替换：阻止下一次草稿写与最终提交，撤销订阅、清客户端显示；物理删除同时清草稿、业务任务/carrier，保留当前已落实的清理链。
- 凭据轮换/删除：创建时冻结的凭据版本规则不变；dispatch 读凭据锁与撤销锁互斥。流式期间不再读新版本。终态和 unknown 清理使用现有凭据生命周期，不能因为有草稿就永久保留旧 key。
- 未完成任务的部分输出不能通过 readTranslations 冒充缓存命中；同内容请求仍附着到已有活动 job，不是另建流。

## 8. 实施任务与依赖

本节是本轮已授权实施任务分工，仍须各阶段实际验收，不将计划视作通过。

| 阶段 | 责任文件范围 | 交付物/依赖 | 验收门 |
| --- | --- | --- | --- |
| A 传输核实（已完成） | 只读同步/聊天模块 | 确认无WebSocket，用户授权SSE；API/worker分进程证据 | 不存在也必须明确，不能虚构复用 |
| B DTO/DB契约 | `packages/dto/src/translation.ts`、schema-translation及迁移 | snapshot/seq/streamId和草稿字段；依赖业务契约评审 | 新旧客户端兼容、无secret字段 |
| C 模型/worker | `llm/translation-call.ts`、processor及生命周期文件 | 单请求文字delta、串行flush、终态原子性；依赖B | 本地模拟流故障/usage/旧token/取消竞态实测 |
| D 传输适配 | 新增SSE与PG通知模块 | 鉴权订阅、提交后桥接、断连快照；依赖A/B | 真API+worker不同进程、丢通知/断连恢复 |
| E 前端 | PDFTranslationService/popover/API薄层 | 版本合并、增量草稿、旧成功保留；依赖B/D契约冻结 | 不串段、后台恢复、无重复生成、纯文本安全 |
| F 集成独审 | 独立测试/验收报告 | 作者之外reviewer及浏览器验收；依赖C/D/E | 下节全部关键项执行；发现问题修复复核 |

可并行：A核实与B/C技术验证、E纯状态合并器设计；依赖接口冻结后再接线。每个实现任务由另一位 agent 独立审阅；传输部署配置只是交付文件，未经明确授权不部署生产、不执行生产迁移。

## 9. 验收矩阵与指标

以下为验收范围；实际已执行与未覆盖项目列于第 10 节，不能把矩阵本身当作通过证据。

1. 本地可控供应商流：分3段发文字、Unicode跨网络chunk、usage缺失/partial、finish截断、收到文字后断流/超时；确认只一次HTTP调用，失败草稿不是成功缓存。
2. 真实本地PG并发：两tab同时首次同段只一个模型请求；flush与cancel/dispatch、文件替换、凭据撤销、旧executionToken、终态写入竞态。已提交成功遇广播失败仍保留成功。
3. 分进程API+worker：随机丢/重排/重复通知，LISTEN和SSE分别重连，GET与SSE交错、订阅建立竞态、API实例重启/切换。最终文本与数据库正式译文逐字相等，无重复字符；模型请求数仍1。
4. 客户端：关闭/重开、A→B→A切段、后台/前台、两标签、刷新、先有旧译文再重翻失败。每一步真实网络计数证明恢复不收费，不只断言UI字符串。
5. 权限：另一用户订阅、退出登录、会话过期、文档删除/替换；收到或补拉草稿均拒绝。传输payload和日志不含key/内部执行令牌/thinking。
6. 实际Chrome：英文主体不变，首字可见后继续增长、滚动不传播/不抢焦点、查看原文/恢复无新生成、窄窗/旋转浮层稳定；拦截使用仅限无费用手势回归，不能冒充真实provider流验证。
7. 自有安全本地测试配置允许时才做少量真实供应商测试；未执行的供应商/浏览器必须标未验证，不能用mock延时或译文替代模型质量结果。

指标定义：click→首字上屏、dispatched→首个供应商text_delta、delta→已持久、持久→客户端上屏、click→最终成功、断连→快照恢复，分别P50/P95；同步记录模型实际调用数和已知/未知usage。目标本地mock下首个delta持久后500ms内上屏、活动连接恢复2s内开始补快照；真实供应商首字/总时长采样报告而非预先保证。持续流中每秒DB写次数受150ms节流控制，慢客户端连接缓存有界。最终验收比较非流式基线的感知首字改善，不能仅以总完成时间变短作为成功条件。

## 10. 实际执行记录

截至本轮集成阶段：

| 检查 | 实际结果 |
| --- | --- |
| Server 完整测试 | 1002 passed / 1 skipped；skip 是需显式环境开关的旧浏览器 fixture |
| Web 完整测试 | 91 文件 / 605 passed；流式相关定向三文件 23 passed |
| Web 类型检查与构建 | typecheck 通过，build 通过（16.36 秒）；既有大 chunk 提示不阻断 |
| 独立后端流式故障验证 | pdf_probe 隔离本地 PG、API/worker 分进程 9/9 通过，证据见 scripts/pdf-translation-streaming-validation |
| Web 独立代码审阅 | backend 审查 SSE 读取、序号/终态、切段隔离与只读降级，无阻断问题 |
| Chrome 实际流式 UI | 独立 127.0.0.1:5192 + 真实 PDF 引擎 + 真 API/worker + 隔离假供应商通过增量/恢复/降级 3 场景 |

测试不调用用户真实模型。真实供应商首字 P50/P95、翻译质量及生产反向代理行为本轮未验证；模拟供应商单次时延不能充作真实模型性能。当前不自动滚底，保持读者滚动位置。失败草稿无定时 TTL，按任务/文档生命周期保留。

### Chrome 实际证据

真实指针点击 BERT 段落，供应商累计输出 `第一部分` → `第一部分，第二部分` → `第一部分，第二部分。`；DOM 先显示“翻译中，尚未保存”，只有终态切为“已保存”。单次样本从 POST 发出到首稿上屏 464ms，最终成功 3.636s，首稿比成功提前 3.172s。此口径不含点击仲裁的 400ms，不是 P50/P95，也不是实际商业模型时延。

- 首次点击：供应商计数 0→1，网络只有一个创建 POST 与一个 SSE GET。
- active 时收起再点击同段：计数 1→2（本次新段总共一次），恢复走同一个 job 的 GET 后 SSE，没有第二个创建 POST。
- 另一个新段仅在此隔离 tab 注入 SSE fetch 网络错误：计数 2→3，转只读 GET 多次看到草稿继续增长并成功，没有第二个 POST；结束恢复原 fetch。
- 实际截图发现深色主题浮层使用不存在的 paper token 导致白底浅字，已由独立作者改用既有 surface/ink token 并视觉复核，正文色 `#f0e8d8` / 背景 `#26221c` 可读。没有改用户偏好。

观察原始结果：`scripts/pdf-translation-acceptance/streaming-browser-results.json`；CSI 观察辅助脚本 `streaming_browser_check.py`；修后截图 `streaming-dark-fixed.png`。页面隐藏/恢复、旧成功与失败草稿、终态乱序、跨文件/stream 隔离由定向测试覆盖，本轮没有另做全部浏览器组合。用户真实供应商没有被验收脚本调用。

隔离 5192 Web 已停止，隔离 API/worker/PG schema 交由 fixture owner 清理；用户 5190/3020 与持久配置保留。保留本地阅读环境的单次流式迁移使用 `node scripts/pdf-translation-acceptance/apply-streaming-local.mjs`，仅固定 localhost/inwit_pdf_reading，有 active-job 与数据一致性保护。此 schema 原由隔离迁移初始化，不能裸跑依赖 `.env.test` 的 migrate；生产仍用正式迁移链，未执行生产迁移。

用户持久本地 schema 升级 0047 已完成，事务前后 users/settings/config/credential/formal translation 签名相同，active job 为 0；重复执行专用迁移返回 alreadyApplied。API 已重启真实 provider 模式。升级后另开 Chrome tab 只读检查：原登录 auth/me 200、原 PDF segments 200、原页缓存 GET 200（4 条已存译文），没有发起生成 POST。证据 `streaming-local-upgrade-readcheck.json`；用户原 tab、模型配置、密钥和译文未改。

独立故障报告的实际单次补充：通知丢失通过只读补偿恢复 627ms；API 优雅关闭 202ms；worker 崩溃后任务进入 unknown 且无重新派发；旧 token 草稿被拒绝、dispatched 取消被拒绝、派发前取消模型调用数 0。均为本地可控供应商验证，不代表外部供应商性能。

升级后的原成功任务只读 SSE 检查也通过：GET `/translation-jobs/:jobId/stream` 返回 200、`text/event-stream`、`snapshot` 状态 succeeded 与原已存译文，连接正常结束。只读取了本地已有成功任务 ID，未创建新任务或调用模型。

### 2026-11-18 输出预算修复

用户本地失败记录显示 425 字符原文的旧输出预算为 638，供应商报告 outputTokens 恰为 638；另一条 422 字符对应 633/633。旧 `sourceText.length × 1.5` 算法过早限制模型输出。记录没有推理 token 分项，不能断言额度全部被推理占用。

现改用模型有效输出上限，再减去完整 JSON 编码目标、system prompt 估算与安全余量夹到上下文剩余容量；必需输入超限会在调用前失败，不截断目标，可选相邻上下文不足时移除。该模型此次解析有效上限为 8192，真实 SDK 的模拟 HTTP 用例确认 425 字符请求实际发出 8192。供应商仍返回 length 时依旧失败，部分文本不作为成功译文；不增加自动重试。

独立复跑本地两文件 `translation-call.test.ts` / `translation-sdk.test.ts`：15/15 通过；UI 提示改为输出上限而非要求缩小选区，重翻失败时保留旧译文且显示失败原因，DOM 4/4 与 Web typecheck 通过，作者之外审阅完成。本轮没有重试用户收费请求，真实模型下一次调用仍需用户自行验证。
