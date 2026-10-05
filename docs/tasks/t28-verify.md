# T28 浏览器验收报告（csi / 真实 Chrome，session: t28-verify）

日期：2026-10-05。环境：web :5190 + server :3020 + worker 均为本次验收启动（启动前 502 未运行）。登录态：Simon（Chrome 既有 session）。截图均为 webp，存 /tmp/t28-*。只记录问题，未改任何代码。

## 逐项结果

### 1. docs 工作台 capture — 通过

- **auto（扔进去）**：提交中 `.capture` 外包 `.ai-shell`，computed 确认 `animation: ai-flow 3.6s`、`conic-gradient` 三色（rgb(179,64,42) 朱砂 / rgb(169,124,47) 金 / rgb(62,125,84) 绿）；下方 `.ai-status` = `✦`（AiSpark）+ 轮播文案「正在收下这句话…」（`.shimmer-text.stage.in`，轮播逻辑生效）。跳转后 shell/status 消失（多次提交后复查无残留）。证据：/tmp/t28-02-capture-sending.webp（整页）、/tmp/t28-03-capture-shell-zoom.webp（壳放大，可见分段渐变描边）+ computed style 摘录。
- **chat（问 AI，问号结尾）**：分支文案正确，出现「✦正在理解你的问题…」。证据：/tmp/t28-05-capture-chat.webp + evaluate。
- 未提交时 capture 条保持原样（基线 /tmp/t28-01-docs-baseline.webp）。

### 2. 导入与拖拽 — 通过

- **拖拽悬停**：合成 dragenter（DataTransfer 含 File）后 `.ws-scroll` 加 `is-drop`，border 保持 dashed、`ws-drop-flow 3.6s`，4.2s 内采样 border-color：rgb(133,88,59) → rgb(171,68,45) → rgb(80,115,77) → rgb(177,78,43) → rgb(162,124,49)（朱砂→绿→金循环），底色 accent-soft。证据：/tmp/t28-06-drop-a/b/c.webp + 采样数据。
- **上传中（阶段一）**：真实 PDF（软件架构师的12项修炼.pdf，2MB）轮询得真实百分比 61%→70%→81%→91%，status 静止「✦正在上传…」（不轮播），壳 `ai-flow 3.6s`；另用 46MB PDF 补拍视觉：✦ + 文件名 + 23% + 取消按钮。证据：/tmp/t28-12-upload-phase1.webp、/tmp/t28-13-upload-zoom.webp（壳放大）。
- **阶段二（≥100%）**：轮询确认壳加 `is-slow`（duration 5.5s）、百分比隐藏、status 切轮播「上传完成，交给 AI…」。窗口太短未抓到截图，证据为两次连续轮询的 computed/文本输出（见会话记录）。
- **完成后文档行**：行容器 `is-digesting`，`::before` 竖向流光边（`ai-edge-flow`，linear-gradient 三色），busy tag = AiSpark + shimmer「消化中…」（tag 文案未改；提取阶段显示「提取中…」）。证据：/tmp/t28-04-docrow-digesting.webp、/tmp/t28-09-docrow-extract.webp。
- 「正在加载文档…」boot 行未动（Loader2 现状，观察确认）。

### 3. 消化完成回落 — 数据层通过，live 翻转失败（见问题 1）

- 全部 digest job `done`（attempts:1 无错误），文档服务端状态均 `digested`；刷新页面后行正常显示卡数。
- 但**在 SPA 会话内行不会自动翻转**（见问题 1），验收项「竖边/busy tag 消失、卡数出现」在主流程中观察不到。

### 4. topics 详情页 — 部分通过（见问题 2）

- 「动态」tab（FeedTab → 共享 DocRow）：pending 行 `doc-row is-digesting` + ✦ spark + shimmer「消化中」+ `ai-edge-flow` 竖边，全部命中。证据：/tmp/t28-10-topic-feed-docrow.webp + evaluate。
- **默认「文档」tab**：使用 `topic-doc-card`（topics/index.tsx 自有 rowKindTag，pulse 圆点），**无竖边、无 spark、无 shimmer**（evaluate：shimmer:false, spark:false, beforeAnim:none）。

### 5. today 页 — 通过

- 最近动态 digest job（进行中）：轮播「消化中，正在通读…→提炼要点…→写成卡片…」，采样确认轮换；done/failed 态（消化完成、消化失败、提取完成、AI 回答、周报生成）保持静态原样。证据：/tmp/t28-11-today-digesting.webp + 两次采样。
- 最近文档 pending 行：✦ spark + shimmer「消化中」（shimmer-slide 动画确认）。
- today capture 条**未加皮肤**（提交中无 `.ai-shell`/`.ai-status`），符合「明确不做」。toast 未动。

### 6. 暗色主题 — 通过

- 变量：`--ai-a/b/c` 解析为亮朱砂 #e06a52 / 亮金 #d4a44a / 亮绿 #6faf84（与设计稿 dark board 一致，无额外暗色覆盖）。
- capture 壳（conic 亮色渐变 + 微光）、消化中行（竖边/tag 可读不刺眼）、today 轮播文案（放大确认可读）逐态复查。证据：/tmp/t28-16-dark-capture.webp、/tmp/t28-17-dark-digesting.webp、/tmp/t28-18-dark-row-zoom.webp、/tmp/t28-19-dark-today.webp、/tmp/t28-20-dark-stage-zoom.webp。

### 7. reduced-motion — CSS 全部静止（通过），JS 轮播未降级（问题 3）

- 模拟 `prefers-reduced-motion: reduce`（Emulation.setEmulatedMedia）：`.ai-shell` → 静态 90deg 渐变、`.ai-edge` → 静态 180deg 渐变、`.shimmer-text` → 纯 ink-3 文字、`.spark` 停呼吸，capture 提交全程静止可读。证据：/tmp/t28-21-rm-capture.webp + computed。
- **但** today 页 `AiStageText` 文案仍每 ~1.3s 轮换（采样：写成卡片…→通读…→提炼要点…）。

### 8. 回归 — 通过

- 上传取消按钮可用：46MB PDF 上传中点「取消」，上传壳消失、未产生文档行。
- 不支持类型（.zip）：`.ws-alert` 原文案「不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown」，可关闭。证据：/tmp/t28-15-import-alert.webp。
- 复习页 / 编辑器 / 脑图 / 任务页：`document.querySelectorAll('.spark,.shimmer-text,.ai-shell,.ai-edge')` 均为 0，渲染无异常。证据：/tmp/t28-22-review.webp、/tmp/t28-23-editor.webp、/tmp/t28-24-jobs.webp。
- 失败/中断态保持原样（「中断+重试」「消化失败」均为朴素文案，无 AI 皮肤）。
- 样式组织：`ai-flow.css` 登记在 style-entry.css 第 4 行（紧跟 styles.css）；styles.css diff 仅 +3 个 `--ai-*` 变量；today/styles.css 无改动。

## 问题清单（按严重度排序）

### P1（中）：文档打开时列表轮询停止，「消化完成」在屏幕上永不发生

- 现象：capture 提交后自动打开新文档 → editor sync active → `DocsService.syncPolling()` 停掉列表轮询（docs.service.ts:2117-2127，`syncActive()` 时 stopPolling）。此后 digest job 完成，行仍显示「消化中…」（甚至翻出「中断」），竖边/busy tag 不消失、卡数不出现，直到刷新或导航到无文档打开视图（实测后者 3-6s 内翻转）。
- 实证：job done（03:11:57Z）后连续 5 次轮询 DOM（至 03:13:02Z）行仍为 `is-digesting`「✦消化中…」；早前 3 篇 capture 文档在 job done 后 1-3 分钟仍显示「中断」。
- 影响：验收第 3 条主流程不成立；目标 5（卡数 stage-in 淡入）在 capture/导入主流程中**无从触发**（代码已实现，场景到不了）。
- 备注：疑似既有「sync 期间停轮询」架构行为被 T28 放大（T28 未改轮询逻辑），但 T28 的目标 5 与验收口径恰好依赖这条链路。

### P2（中）：主题详情默认「文档」tab 未接入 T28 皮肤

- 任务书预设「topics/detail.tsx 在用 DocRow」，实际 DocRow 只用于「动态」tab（FeedTab，detail.tsx:262）；默认打开的「文档」tab 用 topics/index.tsx 的 `topic-doc-card` + 自有 `rowKindTag`（index.tsx:642，仍是 pulse 圆点方案），pending 文档无竖边/spark/shimmer。
- 验收口径「topics 详情页的 pending 文档 DocRow 有竖边 + shimmer」只在「动态」tab 成立；用户默认看到的「文档」tab 不成立。

### P3（低）：reduced-motion 下 AiStageText 的 JS 轮播不停止

- `AiStageText`（components/ai-flow.tsx:46-52）纯 setInterval 驱动，未检查 `prefers-reduced-motion`；CSS 降级块只冻结了过渡/动画，文字内容仍每 1.3s 切换（实测确认）。
- 与验收口径「全部动画静止」有出入；文字本身可读，影响较轻。

### P4（观察项，非 T28）：weekly_report job 持续失败

- worker 日志：`weekly report document missing card links for relearn concepts`（weekly.ts:79 assertWeeklyOutcome），attempts 3 次耗尽标记 failed。与 T28 无关，顺带记录。

### P5（无法验证）：目标 5 卡数淡入动画

- 受 P1 影响，主流程中观察不到 live 的 pending→digested 翻转，`.card-count` 淡入无法在目测层面验证（代码已确认存在于 DocStreamRow/DocRow，reduced-motion 降级块亦有覆盖）。

### P6（观感，非阻塞）：消化中途已显示「N 张卡」

- digest 中途 write_cards 已落库，pending 行同时显示「消化中…」tag 和「2 卡 · 刚刚」，语义略矛盾；属既有数据行为，非 T28 改动。

## 环境复原

- 主题已切回浅色；reduced-motion 模拟已清除；不支持的测试文件已删除（/tmp/t28-bad.zip 在上传后无服务端残留）；验收产生的测试文档（间隔重复/主动回忆/遗忘曲线/测试轮播/分布式/生成效应/必要难度/间隔效应/软件架构师的12项修炼等）留在 demo 库中，如需要可删。
- dev（:5190/:3020）与 worker 进程保持后台运行。

---

## 回归（2026-10-05 第二轮，P2/P3 修复后）

只验 P2/P3，未改代码。新证据截图 /tmp/t28-regression-*.webp。

### P2 回归：主题详情默认「文档」tab 接入 T28 皮肤 — 通过

- 改动确认：`TopicDocCard`（topics/index.tsx:607）pending 加 `is-digesting`，pulse 圆点换 `AiSpark` + shimmer「消化中」（index.tsx:596-597）；styles.css 新增 `.topic-doc-card.is-digesting` 伪元素竖边。
- 实测（机器学习基础主题，默认「文档」tab，新扔一篇触发 digest）：pending 行 computed = `topic-doc-card is-untitled is-digesting`，tag = ✦ spark + shimmer「消化中」（`shimmer-slide`），`::before` 宽 2.5px、`ai-edge-flow`、linear-gradient 三色（朱砂/金/绿）——与工作台 `ws-doc-row` 表现一致。
- 同屏其余正常态行：`.spark/.shimmer-text` 计数 0、`::before` 无动画，无皮肤；failed 态渲染逻辑未动（index.tsx:600 原样）。
- 证据：/tmp/t28-regression-p2-card.webp（行放大，竖边+✦消化中清晰可见）、/tmp/t28-regression-p2-tab.webp（整页）。

### P3 回归：AiStageText 监听 prefers-reduced-motion — 通过（附验证方法限制说明）

- 改动确认：ai-flow.tsx:41-55 初始读 `matchMedia('(prefers-reduced-motion: reduce)')` + `change` 监听，reduced 时 effect 不建 interval，停在 stages[0]。
- 实测（Emulation.setEmulatedMedia reduce，组件均在模拟开启后挂载）：
  - **capture 投入中**（加 2.5s 网络延迟拉长窗口）：5 次采样（~4.5s）全程「正在收下这句话…」，未切到「落成一篇文档…」；同刻 computed：shimmer/spark/ai-shell 动画全 none，文字纯色 rgb(139,129,114) 可读。证据：/tmp/t28-regression-p3-capture.webp。
  - **上传完成轮播**（阶段二 is-slow 窗口，页内 300ms 高频采样）：6 个样本（1.8s）全程「上传完成，交给 AI…」，未切「正在读这篇文档…」。
  - **today 动态行 digest job**：6 次采样（6s）全程「消化中，正在通读…」，shimmer 动画 none、纯色可读。证据：/tmp/t28-regression-p3-today.webp。
  - **轮播恢复**：清除模拟后刷新挂载，轮播正常（「消化中，正在通读…」→「写成卡片…」）。
- 验证方法限制（非产品问题）：CDP `Emulation.setEmulatedMedia` 切换不向已注册的 MediaQueryList 派发 `change` 事件（页内监听实测 events:[]），因此「挂载中组件在 reduce 开关来回拨时实时响应」这一条无法用它验证；该路径代码为标准 `addEventListener('change')` 写法，真实 OS 设置切换会派发事件。模拟期间挂载的组件在模拟清除后会保持静止直到重挂载——纯测试环境假象。

### 新问题

无。P1（文档打开时轮询暂停导致完成态不 live 翻转）与 P4（weekly_report 失败）为前轮遗留观察项，本轮未复测、不在修复范围内。
