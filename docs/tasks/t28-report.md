# T28 实现报告：「扔进去」AI 等待态——流光描边 + shimmer 阶段轮播

## 实现摘要

按任务书目标 1–5 全部实现，视觉/文案/CSS 严格以 `docs/design/v2/ingest-ai.html` 为准，配色直接引用 `--accent` / `--gold` / `--green`（经 `:root` 新增的 `--ai-a/--ai-b/--ai-c`），暗色主题随品牌色自动切换，无额外暗色覆盖。

### 改动文件

**新增**
- `apps/web/src/ai-flow.css` — 共享原语：`@property --ai-angle`、`ai-flow` / `spark-breathe` / `shimmer-slide` / `stage-in` / `ai-edge-flow` 五个 keyframes，`.ai-shell` / `.ai-shell-inner` / `.spark` / `.shimmer-text` / `.stage(.out/.in)` / `.ai-status` / `.ai-edge` / `.card-count`，以及集中的 `prefers-reduced-motion: reduce` 降级块（在画板 5 规则基础上补了 `.stage` transition 与 `.card-count` 的静止覆写，满足「减弱动态时全部静止」的验收口径）。
- `apps/web/src/components/ai-flow.tsx` — `AiSpark({ delay, className })` 与 `AiStageText({ stages, intervalMs = 1300, className })`。轮播逻辑同设计稿 wireStage：`.out` 280ms 后换下一段加 `.in`；`stages.length <= 1` 静止；卸载清理 interval + swap timeout；`stages` 经 ref 读取，数组字面量 prop 不会重置轮播。

**修改**
- `apps/web/src/styles.css` — 仅新增 `:root` 三个变量 `--ai-a/--ai-b/--ai-c`。
- `apps/web/src/style-entry.css` — `./ai-flow.css` 登记在 `./styles.css` 之后。
- `apps/web/src/pages/docs/workbench-list.tsx` — 目标 2/3/5 主体（详见下）。
- `apps/web/src/pages/docs/styles.css` — capture 壳内层覆写、`ws-drop-flow` keyframes 与 `.is-drop` 流转、`.ws-upload*` 上传条、`.ws-doc-row.is-digesting` 竖向流光边（伪元素）、busy tag 内 spark 尺寸，及以上功能的 reduced-motion 覆写（就近放置）。
- `apps/web/src/components/doc-row.tsx` / `doc-row.css` — 目标 4/5。
- `apps/web/src/pages/today/index.tsx` — 目标 4。`pages/today/styles.css` 无需改动（`.doc-digesting`/`.spark` 样式由共享的 `doc-row.css` 与 `ai-flow.css` 覆盖）。

无 server / dto / DB / mobile 改动。

## 各目标完成情况

### 目标 1：共享原语 — 完成
如上，原语从设计稿「核心：AI 流光」段原样迁移；类名冲突已 grep 排查：`.spark`、`.ai-shell`、`.ai-status`、`.ai-edge`、`.shimmer-text` 在现有 CSS 中零命中；`.stage` 只有 review 页的 `.stage-top/.stage-exit/.stage-count/.stage-menu/.stage-foot` 等复合类名，与裸 `.stage` 不冲突，`.in`/`.out` 仅以 `.stage.in`/`.stage.out` 复合选择器使用 —— **无需加 `ai-` 前缀**。

### 目标 2：docs capture 条 — 完成
- `service.$model.send.loading` 时 `.capture` 外包 `.ai-shell`（外层 div 常驻、仅切换 className，CaptureEditor 不卸载重挂）；壳内 capture 去自身描边/投影、圆角 `calc(var(--r-md) - 1.5px)`。
- capture 下方 `.ai-status`：`AiSpark(delay 0.3)` + `AiStageText`；组件内 `sendMode` state 记录本次提交模式，auto →「正在收下这句话…/落成一篇文档…/排队等 AI 消化…」，chat →「正在理解你的问题…/翻你的卡片找答案…/落成一篇回答…」。
- sending 期间 `CaptureEditor disabled`（既有 `.is-disabled` 置灰样式）；按钮既有 disabled 行为未动；提交完成路由跳走表演自然结束，未做完成回落。

### 目标 3：导入与拖拽 — 完成
- 拖拽悬停：DOM 结构未动；`.ws-scroll.is-drop` 保持 1.5px dashed，新增 `ws-drop-flow` keyframes（3.6s，`--ai-a → --ai-b → --ai-c`），底色维持 `var(--accent-soft)`；reduced-motion 退回静态 `var(--accent-line)`。`.is-busy` 维持静态现状。
- 上传中：原 `.ws-importing`（importing 分支）替换为 `.ai-shell`（`.ai-shell-inner` min-height 40px）= `AiSpark` + 文件名（省略号截断）+ 右侧真实百分比（tabular-nums）+ 取消按钮（沿用 `.btn btn-ghost` 小按钮样式）；下方 `.ai-status`。
  - 阶段一（percent 为 null 或 < 100）：`AiSpark` + 静止 `<span class="shimmer-text">正在上传…</span>`，不轮播。
  - 阶段二（percent ≥ 100）：壳 `animation-duration: 5.5s`（`.ws-upload-shell.is-slow`），status 换 `AiStageText` 轮播「上传完成，交给 AI…/正在读这篇文档…/稍后会提炼成卡片…」，百分比隐藏。
- 「正在加载文档…」boot/loadDocuments 行保持 Loader2 现状未动。
- DocStreamRow：`stage.kind ∈ {upload, extract, ocr, digest}` 时行容器加 `is-digesting`，伪元素挂 2.5px 竖向流光边（`overflow: hidden` 裁剪圆角）；busy tag 的 pulse 圆点替换为 `AiSpark`（9px），label 包 `.shimmer-text`；tag 文案（`describeDocumentStage` 输出）未改，`doc-pipeline.ts` 及其测试未动。`interrupted`（中断，pulse=false）不带 spark/shimmer，保持原样。

### 目标 4：DocRow 与 today 页 — 完成
- `DocRow`：`pending` 时 `.doc-row` 加 `is-digesting`（伪元素竖边）；`.doc-digesting` 改为 `AiSpark`（10px）+ shimmer「消化中」；`doc-row.css` 里 `.doc-digesting` 的 `animation: pulse` 规则块已删除。failed / proposedCount 不动。topics/detail.tsx 经共享组件自动获得同款表现。
- today 页：最近文档 pending 行同样 `AiSpark` + shimmer「消化中」（`.pulse` 圆点移除）；最近动态中 `digest` 且非 done/failed 的 job 改为「标题加粗 · AiStageText 轮播（消化中，正在通读…/提炼要点…/写成卡片…）」（画板 4 结构，detail 为空时只渲染轮播）；其它 job 类型与 done/failed 态、toast、today capture 条均未动。

### 目标 5：完成回落 — 已实现，未裁剪
实现代价小（每组件约 10 行）：DocStreamRow 用 `useJustDigested` hook、DocRow 内联同逻辑（ref 记录上一次 status，effect 检测 `pending → 非 pending 且非 failed`），命中后给卡数 span 挂 `.card-count`（`stage-in .45s ease both`，一次性）。reduced-motion 下 `.card-count` 动画在 ai-flow.css 降级块中静止。

## 「明确不做」清单遵守情况

server/dto/DB 零改动；「消化中」无整壳流光、无假进度条；today capture 条未加皮肤；失败态与普通加载态（boot、loadMore、新建）保持现状；mobile 未动；settings/jobs 页未动。

## 验证命令输出摘要

- `pnpm typecheck` — 9 个 workspace 项目全部 Done，无错误。
- `pnpm -r build` — 全部成功（web ✓ built in 3.96s，仅有既有的 chunk size 提示）。
- `git diff --check` — 干净（DIFF_CHECK_CLEAN）。
- `pnpm --filter @inwit/server test` — 73 个测试文件、640 个用例全部通过（无 server 改动，符合预期）。
- 类名冲突 grep — `.spark`/`.stage`/`.ai-shell`/`.ai-status`/`.ai-edge`/`.shimmer-text` 无现有冲突，未加前缀。

真实浏览器链路（capture 流光、导入两阶段、消化完成回落、暗色主题、reduced-motion 模拟）由验收 agent 用 csi 另行验证。

## 验收后修复（2026-10-05，针对 t28-verify.md 问题清单）

### P2：主题详情默认「文档」tab 接入 T28 皮肤 — 已修
- `apps/web/src/pages/topics/index.tsx`（TopicDocCard）：`doc.status === 'pending'` 时卡片容器加 `is-digesting`；busy tag 的 pulse 圆点 + nbsp 替换为 `AiSpark` + `<span class="shimmer-text">{label}</span>`，接法与工作台 DocStreamRow 完全一致；failed 等其它态未动。
- `apps/web/src/pages/topics/styles.css`（功能就近）：新增 `.topic-doc-card.is-digesting`（`position: relative; overflow: hidden`）+ `::before` 2.5px 竖向流光边（`ai-edge-flow 4.8s`），`.topic-doc-card .tag .spark` 缩小至 9px，并附本模块的 reduced-motion 降级块（竖边退回静态渐变），与 doc-row.css / docs/styles.css 的组织方式一致。

### P3：reduced-motion 下 AiStageText JS 轮播不停止 — 已修
- `apps/web/src/components/ai-flow.tsx`：`AiStageText` 新增 `matchMedia('(prefers-reduced-motion: reduce)')` 状态（lazy 初始化 + `change` 监听，卸载时 removeEventListener）；reduced 时轮播 effect 不启动，`setIndex(0)` 使文案停在 `stages[0]`，偏好变化时即时响应切换。

### 验证
- `pnpm typecheck` — 全部 Done，无错误。
- `pnpm --filter @inwit/web build` — ✓ built in 4.32s（仅既有 chunk size 提示）。
- `git diff --check` — 干净。
- 浏览器回归由验收 agent 另行执行。P1（列表轮询停止）不在本次修复范围。
