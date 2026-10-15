# T30 浏览器验收报告（csi / 真实 Chrome）

日期：2026-10-15 10:45–11:40。会话 t30-verify，账号 regression@inwit.dev（**localhost:5190** 源，原因见「环境」节）。
截图存 docs/tasks/shots/t30/。验收期间 server :3020（tsx watch 子进程 10:39:36 重启，晚于全部 T30 server 文件与 dto dist 构建，确为新代码）、web :5190（vite HMR）、worker 验收前新启（日志 /tmp/t30-worker.log）。

## 环境

- **登录坑（环境性，非产品问题）**：`.env` 的 `WEB_ORIGIN=http://localhost:5190`，而验收约定入口是 127.0.0.1:5190。`authModeFromOrigin` 按 Origin===WEB_ORIGIN 判 cookie 模式，127.0.0.1 源登录走 bearer 不落 cookie，登录后接口全 401 被弹回登录页。改 localhost:5190 源后正常。建议把 WEB_ORIGIN 与验收约定入口对齐（或两个源都接受）。
- 测试文档均经 `POST /api/documents`（source=paste，立即入队 digest）在已登录页面内创建，正文为手工编的 PM JSON。
- BYOK 正常：digest 走用户自配 glm-5.3-flash，三次 digest（含一次重消化）全部跑通，无模型配置阻塞。
- 干扰项（与 T30 无关）：验收中途另一会话在 apps/web 放了 mermaid-frame-repro.html（引用 @inwit/doc-schema 未构建的 mermaid-view.js），vite 把 import-analysis 错误经 HMR 广播到本标签页弹过一次错误遮罩；Esc 关闭后不影响验收。该文件非本任务产物，未处理。

## 1. 大纲生成与卡片挂载 — 结构通过；点击跳转闪烁不通过（问题 1，P1）

- 文档 `ced87155`「T30验收：间隔重复的原理与实践」：标题 + 3 个章节标题 + 每章 1./2./3. 编号列表。digest job `353452fe` 一次通过（476s）。
- DB：13 条 kind='outline' 批注；canvas 树 3 个一级大纲根节点 + 10 个二级大纲节点 + 8 张卡全部 has_parent=true（无散根卡）。
- UI 脑图：3 个一级节点（T30验收：间隔重复的原理 / 间隔重复的实践方法 / 常见误区）带「大纲」kicker 与逐字 quote；二级节点（核心/遗忘曲线/最佳复习点/主动回想、拆卡/SM-2/按回忆质量、粒度过大/刷量/不更新）同带「大纲」kicker；8 张填空卡挂在对应二级节点下；顶栏「8 卡 · 13 批注」（01-doc1-mindmap-fit.webp）。
- **点击大纲节点（两篇文档各点多个）：节点在脑图上被选中，但正文不跳转、无划线闪烁；正文里根本没有大纲对应的划线**（黄标全是卡片的 cardAnchor，DB contentJson 证实只有 cardAnchor、无 annotationMark）。任务书验收第 3 条此点不通过 → 问题 1。

## 2. 右键菜单状态 — 通过

- digested（必要难度理论与三种学习手段）：「AI 消化」置灰（02-menu-digested-disabled.webp）。
- 消化中（T30验收：间隔重复，digest 进行中）：置灰（02-menu-pending-disabled.webp）。
- failed（发大水范德萨，DB 证实 status='failed'）：可点（02-menu-failed-enabled.webp）。
- 菜单常显，三种状态仅 disabled 不同；既有 `:disabled` 置灰样式生效。

## 3. 人工重消化 — 通过

- SQL 把 `ced87155` 置 failed → 列表行出现「失败」tag 与「重试」按钮 → 右键「AI 消化」可点 → 对话框标题「AI 消化」、文案「重新消化「T30验收：间隔重复的原理与实践」，未确认的卡片会重建。」（03-retry-dialog.webp）。
- 确定后文档回到消化中（行内「消化中…」，03-retry-pending.webp），新 digest job `df74ef84` 最终 done（484s）。
- **旧大纲替换**：digest 启动时旧 13 条 outline（created 02:55:34）被硬删；新 write_outline 于 03:19:47 重建 14 条（全部同一时间戳单批），DB 与脑图均无新旧并存/重复节点（03-redigest-mindmap.webp、03-redigest-tree-zoom.webp）。
- **卡片结构**：旧 8 张已确认卡按 retry 语义保留为脑图根卡（「未确认的卡片会重建」——它们已确认，不动）；重消化首轮模型判「全部概念已有卡」写 0 卡，verify 的 nudge 机制（`digest produced no cards`）触发复验后补写 2 张新卡并经 place_cards 挂到大纲节点下（10 卡 = 8 根 + 2 挂载）。nudge 一次复验机制按设计工作。
- 完成后右键菜单回到置灰态；回收站批注区仍 5 条 note（硬删的 13 条旧大纲未进回收站）。

## 4. 无标题短文档 — 通过（点击跳转同样受问题 1 影响）

- 文档 `da8f8db9`「T30验收：记忆宫殿随记」：两段无标题短文。digest job `9f3f9d47` 一次通过（253s）。
- DB：3 条 outline（1 一级「记忆宫殿随记」+ 2 二级「回忆方式/原理」），2 张卡均 has_parent=true。
- UI 脑图：一级大纲节点 + 2 个二级大纲节点（均带「大纲」kicker），各挂 1 张卡（04-short-doc-mindmap-fit.webp）。满足「至少一个一级大纲节点」。

## 5. 无污染抽查 — 通过

- 全局搜索：`/api/search?q=` 搜大纲 note「记忆宫殿随记」「空间记忆的天然优势」「走过空间拾取物品」，annotations 命中组 kind 仅 pdf/text/note 且全部来自其它旧文档，**无 outline**；文档/卡片命中为正常内容匹配。
- 回收站（设置页）：批注区 API `total=5`、kinds 全为 note，无大纲节点；重消化硬删的旧大纲也未出现（05-recycle-bin.webp）。
- 批注重浮：`/api/annotation-resurface` 本账号返回空（无候选），无法正向验证排除效果；`loadResurfaceCandidates` 的 `ne(kind,'outline')` 过滤为代码级确认。周报的批注计数/行两处过滤同为代码级确认，未真实触发周报。

## 问题清单

1. **P1：大纲批注在正文中不渲染划线，点击大纲节点不跳转不闪烁**。正文 entity mark 由客户端 `missingTextEntities`（apps/web/src/lib/entity-marks.ts:143）按 quote 补画，但该函数 `if (note.kind && note.kind !== 'text') continue;` 把 kind='outline' 排除 → 大纲永远没有 annotationMark；`selectCanvasNode`（docs.service.ts:1111）走 `bodyFocusAnnotationId` 路径调 `scrollFlashAnnotationAnchor`，找不到锚点元素静默 return。实证：短文档正文仅 2 个黄标（contentJson 里只有 2 个 cardAnchor），3 条 outline quote 无 mark；CDP 真实点击二级大纲节点后 `.is-flash` 为空（两篇文档均复现）。任务书验收第 3 条「点击大纲节点，正文跳转并闪烁对应划线」不通过。修法方向：`missingTextEntities` 放行 kind='outline'（`isLostTextEntity` 对非 text kind 已返回 not-lost，selectCanvasNode 路径本身无需改）。
2. **P3（环境）**：`WEB_ORIGIN=http://localhost:5190` 与验收/文档约定的 127.0.0.1:5190 不一致，127.0.0.1 源 UI 登录后不落 cookie、接口全 401（authModeFromOrigin 严格相等判定）。建议配置对齐或判定放宽。

## 备注

- 验收产物：文档 `ced87155`（10 卡 14 批注）、`da8f8db9`（2 卡 3 批注）留在 dev 库；doc1 经历过一次 failed→重消化。
- worker（日志 /tmp/t30-worker.log）验收后保持运行。

## P1 修复回归（同日，主线 agent 执行）

修复：`apps/web/src/lib/entity-marks.ts` 的 `missingTextEntities` 与 `isLostTextEntity` 把 `kind='outline'` 与 `'text'` 同等对待；`packages/doc-engine/src/vendor/entity-marks.ts` 同步。新增 2 个单测（`entity-marks.test.ts` 9/9 通过），`pnpm typecheck` 全绿。

回归（csi，localhost:5190，regression@inwit.dev）：

1. 文档 `ced87155`：正文 `.pane-scroll` 内 annotationMark **14 个**（= 14 条 outline，修复前为 0）；点击二级大纲节点「卡片粒度过大…」，正文闪烁元素的 `data-annotation-id` 与被点节点 id 完全一致（f07fe243…）→ **跳转+闪烁恢复**。点击卡片节点闪烁 `data-card-ids` 黄标，卡片链路无回归。
2. 文档 `da8f8db9`：正文 3 个 annotationMark（= 3 条 outline）；点击一级大纲节点闪烁命中对应 `data-annotation-id` → 通过。
3. 截图 `09-p1-regression-flash.webp`。

备注：csi `mouse_click` 的合成事件触发不了脑图画布的 React 点击（疑似指针捕获/拖拽抑制），DOM 级 `click` 可正常选中并触发 reveal——验收脚本注意用后者。

**P1 关闭。** 遗留：P3（WEB_ORIGIN 与 127.0.0.1 入口不一致，环境配置项，非本任务代码）。
