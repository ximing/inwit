# T29 实现报告：sync 激活期间轻量轮询 + weekly_report 失败修复

日期：2026-10-05。未 commit；浏览器验收（/csi）由另一个 agent 执行。

## 目标 1：sync 激活期间的轻量轮询（web）

### 改动

- `apps/web/src/lib/doc-list.ts`（纯逻辑，新增）
  - `pendingPollTargets(documents, openDoc)`：轮询目标 = 列表 pending 项 + 当前打开但不在列表里的 pending 文档（从 `tickPending` 原内联逻辑平移）。
  - `mergeStatusDetail(item, detail)`：列表项轻量合并——只写 `status/failReason/updatedAt/cardCount/proposedCount`，`title/description/preview/topicId/linkHint` 等正文相关字段原样保留；detail 的 `updatedAt` 落后于本地已知戳（或非法）时返回原对象（本地保存的 PUT 还没回到这次 GET，拒绝合并）。
  - `mergeDocMeta(doc, detail)`：当前打开文档的轻量合并——只写 `status/failReason/updatedAt`，`contentJson/title/cards` 等一律按引用保留；同样带 stale 守卫。
- `apps/web/src/pages/docs/docs.service.ts`
  - `syncPolling()`：删掉 `syncActive()` 一刀切 `stopPolling()` 分支；只要存在 pending 文档（列表或 `this.doc`）或上传中就启动轮询，否则停止。sync 未激活时行为完全不变。
  - `startPolling()`：删掉 `syncActive()` 早退。
  - `tickPending()`：`syncActive()` 时走新增的 `refreshOneMeta(id)`（轻量），否则照旧 `refreshOne(id)`（全量合并，含编辑器 seed/冲突 toast 等既有保护）；`refreshJobs` 两种模式都照走，阶段 tag（提取中/消化中/OCR 进度）由 jobs 驱动不受影响。轮询频率沿用 `POLL_MS`。
  - `refreshOneMeta(id)`（新增）：只 `getDocument` 一次，`documents` 行走 `mergeStatusDetail`、`this.doc` 走 `mergeDocMeta`；404 走既有 `forgetDocument`，瞬时失败保留现状。不碰 annotations/canvas/编辑器。
  - `onSyncEvent('active')`：两个分支统一先 `syncPolling()`（sync 激活后若有 pending 仍保留轻量轮询），selection 补拉的 disarm/arm 逻辑不变。
- 完成回落联动确认：`DocStreamRow` 的 `useJustDigested(doc.status)`（workbench-list.tsx:39）按 props 变化工作；`mergeStatusDetail` 翻转时返回新对象，卡数淡入与竖边消失会在留在文档视图时触发，无需表现层改动。

### 单测

- `apps/web/src/lib/doc-list.test.ts`（新增，10 例）：
  - `pendingPollTargets`：pending 收集、打开文档补入/去重、空集。
  - `mergeStatusDetail`：**digested 翻转时元字段更新、preview/title/description/linkHint 原样保留**（重点用例）；failed 时 `failReason` 透传；stale/非法 updatedAt 返回同一引用。
  - `mergeDocMeta`：翻转后 `contentJson/cards/title` 按引用保留；stale 返回同一引用。

## 目标 2：P4 weekly_report 失败根因与修复

### 根因：逻辑 bug（不是数据问题）

抛出点：`apps/server/src/agent/weekly.ts` `assertWeeklyOutcome`（原 :77）。

写入链路：agent `write_document` → `ensureWeeklyReportBody` 保证 relearn 概念的 markdown 链接 `[概念](/cards/<cardId>)` 一定在正文里 → `markdownToContentJson` 把 markdown 链接转成 PM JSON 里 **text 节点上的 link mark**（`marks: [{type:'link', attrs:{href}}]`，见 packages/markdown/src/pmjson.ts:85-89）。

校验链路却用 `documentPlainText(doc.contentJson)`（= `pmJsonToText`，只拼 text 节点的文字，见 packages/doc-schema/src/blocks.ts:19-32）找 `/cards/<cardId>`——**href 在 mark 的 attrs 里，永远不可能出现在纯文本中**。因此只要 `stats.relearn.length > 0`（用户有任何 lapse/忘了的卡），该校验必挂：nudge 一轮仍挂 → job 失败 → 重试 3 次耗尽。与文档内容写得对不对无关，是校验读错了地方。

### 修复

- `apps/server/src/agent/weekly-logic.ts`（纯逻辑，新增）：
  - `collectLinkHrefs(contentJson)`：遍历原始 PM JSON，收集所有 link mark 的 href。
  - `docLinksToCard(contentJson, cardId)`：链接 mark 里是否含 `/cards/<cardId>`。
- `apps/server/src/agent/weekly.ts` `assertWeeklyOutcome`：relearn 卡片链接校验改为 `docLinksToCard(doc.contentJson, ...)`；三档分布等纯文本校验保持不变。
- 单测 `apps/server/src/agent/weekly-logic.test.ts`（新增 2 例）：嵌套结构里收集 link mark href；**根因回归**——真实 `markdownToContentJson` 管线产出的文档 `documentPlainText` 不含 `/cards/<id>` 而 `docLinksToCard` 为真（锁定旧校验必挂的事实）。

修复后历史失败 job 重试即可正常收尾（写入路径本就保证链接存在）。

## 验证命令结果

- `pnpm typecheck` — 全绿（9 个工程全 Done）。
- `pnpm -r build` — 全绿（含 @inwit/web vite build）。
- `pnpm --filter @inwit/server test` — 73 文件 / 642 用例全过（含新增 weekly-logic 2 例）。
- `pnpm --filter @inwit/web test` — 53 文件 / 354 用例全过（含新增 doc-list 10 例）。
- `git diff --check` — 无输出，通过。

浏览器验收（capture 留在文档视图看 live 翻转、PDF 导入各阶段 tag、weekly_report 人为触发收尾）由 csi agent 另行执行。

## 验收后修复：P3 翻转后标题/描述/主题滞留

验收发现（t29-verify.md 问题清单第 2 条）：sync 未激活时，文档消化完成（pending→digested）后，列表行的标题/描述/主题可能滞留原始 capture 文案，直到下次列表加载。根因是 digest 的状态翻转与 meta（ensureDocumentMeta 写标题/描述/主题归属）落库是两步，翻转那次 fetch 先于 meta 写入；翻转后没有 pending 文档轮询即停，meta 永远不再拉。

### 修复策略

检测到某篇文档从 pending 翻成非 pending 时，只给该篇安排两次延迟补拉（默认 4s / 10s），让 meta 落定后行数据更新；其余轮询行为不变。

- `apps/web/src/lib/doc-list.ts`（纯逻辑，新增）
  - `FLIP_FOLLOW_UP_DELAYS_MS = [4000, 10000]`：补拉延迟策略，两次间隔覆盖 meta 稍慢落库的情况。
  - `justFlippedFromPending(before, after)`：从轮询前后的状态快照里找出刚翻转的文档 id（after 里已消失的不算，翻成 failed 也算）。
  - `FlipFollowUpScheduler`：补拉定时器。同一文档不叠加；全部触发后自动释放该 id（重试再次翻转可重新安排）；提供 `cancel(id)` / `clear()` 供删除与卸载时清理。
- `apps/web/src/pages/docs/docs.service.ts`
  - `tickPending()`：轮询前后各取一次状态快照（`statusSnapshot`，覆盖列表行与当前打开文档），`justFlippedFromPending` 命中的 id 调 `scheduleFlipFollowUp`。
  - `scheduleFlipFollowUp(id)`：fire 时再查一次——文档已删（`forgetDocument` 已 cancel，此为兜底）或又变回 pending（正常轮询已接管）则不补拉；补拉按触发时的分支选择：`syncActive()` 走 `refreshOneMeta`（轻量合并），否则走 `refreshOne`（全量合并），与所在分支一致。
  - 清理：`forgetDocument(id)` 里 `flipFollowUps.cancel(id)`；`destroy()` 里 `flipFollowUps.clear()`。

### 单测

- `apps/web/src/lib/doc-list.test.ts` 新增 7 例：`justFlippedFromPending` 翻转检测（digested/failed/已删除/原本非 pending 的边界）；`FlipFollowUpScheduler` 按延迟逐次触发并释放、同文档不叠加、cancel/clear 生效、默认延迟参数（vi fake timers）。

### 验证

- `pnpm typecheck` — 全绿。
- `pnpm --filter @inwit/web test` — 53 文件 / 361 用例全过（含新增 7 例）。
- `pnpm --filter @inwit/web build` — 通过。
- `git diff --check` — 无输出，通过。

浏览器回归由另一个 agent 执行。
