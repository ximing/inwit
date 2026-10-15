# T30 实现报告：文档消化产出脑图大纲（write_outline + place_cards）+ 右键「AI 消化」

日期：2026-10-15。未 commit；浏览器验收（/csi）由另一个 agent 执行。

## 目标 1：数据层新批注 kind `'outline'`

- `packages/dto/src/annotation.ts`：`ANNOTATION_KINDS` 加 `'outline'`；`createAnnotationInputSchema` superRefine 在最前拒绝 `kind: 'outline'`（`kind outline is reserved for internal use`），用户 API 建不了 outline，服务端内部 drizzle insert 不走此 schema。
- `pnpm --filter @inwit/dto build` 已跑（server 走 dist，必须重建）。
- migration：`drizzle/0042_low_gabe_jones.sql`，drizzle-kit 生成的 diff 恰好只有 `annotations_kind_check` 的 DROP/ADD 两行（IN 列表含 `'outline'`），无需手工裁剪；`pnpm --filter @inwit/server migrate` 本地执行成功。

## 目标 2：create_highlight 支持 outline kind（内部字段）

- `apps/server/src/canvas/mind-edit-logic.ts`：`MindEditInput` 与 create_highlight 的 `MindEditStep` 加 `kind?: 'outline'`；`planMindEdits` 循环入口统一拦截「create_highlight 以外的 op 带 kind → `只有新建划线能指定类型`」，create_highlight 分支校验 `kind !== 'outline'` → `划线类型不合法`，合法则透传进 step。
- `apps/server/src/canvas/canvas.service.ts` `applyDocumentMindEdits`：insert annotations 用 `kind: step.kind ?? 'text'`；`IndexedHighlight` 加 `kind` 字段，提交后的 `tryIndexAnnotation` 循环跳过 outline（不进检索索引）。retarget 路径固定记 `kind: 'text'`（retarget 只允许改 kind='text' 的行）。
- `conversation-mind-tools.ts` 未改 schema，会话 Agent 建不了 outline。
- `mind-edit-logic.test.ts` 新增 2 例：kind:'outline' 透传进 step；非法 kind 报错 + create_text / move / retarget_highlight 带 kind 报错。

## 目标 3：digest 新工具 write_outline / place_cards

- `apps/server/src/agent/outline-logic.ts`（纯逻辑，新增）：`outlineEditsFromTree(nodes)` 把两级树扁平化成 `MindEditInput[]`。上限 L1≤12、每节点 L2≤8、总≤60、二级不能再有子节点；ref 规则 s1..sN / s1-1..，二级带 parentRef，全部带 index 保序、kind:'outline'。返回 `{ok,edits,tree}`（tree = 一级 ref + 子 ref 列表，供落库后重组树）或 `{ok:false,reason}`。
- `outline-logic.test.ts`（新增 5 例）：扁平化正确性（含 ref/parentRef/index/kind 全字段断言）、空树报错、L1 超限、L2 超限、三级拒绝 + 总数超限。
- `apps/server/src/agent/outline-tools.ts`（新增）：
  - `write_outline`：TypeBox schema（note 1-80、blockIndex≥1、quote 1-500、children 仅一级、maxItems 8，nodes 1-12）。execute：`outlineEditsFromTree` → `applyDocumentMindEdits` → 用 `tree` + `created` 重组树形 `{ref,nodeId,note,children}` 响应；nodeId 全部记入 `session.outlineNodeIds`；重复调用返回 `{ok:false,reason:'大纲已建过，只能建一次'}`；校验/落库失败返回 `{ok:false,reason}` 不 throw。
  - `place_cards`：schema `{placements:[{cardId,parentId}]}` 1-40 条。cardId 不在 `session.writtenCardIds` 直接进 failed；已挂过的卡幂等跳过；逐条 `placeCanvasMember`，单条失败收集进 failed 不 throw；成功记 `session.placedCardIds`；返回 `{ok, placed, failed}`。
- `apps/server/src/agent/tools.ts`：`DigestSession` 加可选 `outlineNodeIds?` / `placedCardIds?`（conversation-tools 的 `digestSession()` 工厂不受影响）；`digestTools` 在 `readDocumentAnnotationsTool` 后插 `writeOutlineTool`、`setDocumentMetaTool` 前插 `placeCardsTool`（→ 13 个工具）。

## 目标 4：digest.ts 流程接线

- 新增 `deleteOutlineAnnotations(userId, documentId)`：硬删该文档 `kind='outline'` 批注（无 deletedAt 过滤，含软删行）；`processDigest` 中 `deleteProposedDocumentCards` 之后调用。canvas 行靠 FK cascade 删除、挂在下面的卡片 parentId set null 回落为根；outline 不进索引，无需清索引。
- session 字面量加 `outlineNodeIds: []`。
- `verifyDigest`：missing-questions 检查之后加 `outlineNodeIds` 为空 → 抛普通 `Error('digest wrote no outline nodes')`（走既有 nudge 一次复验）；cards=0 的 terminal 检查仍在最前未动。卡片挂载软验收：`placedCardIds.length !== live.length` 只 `logger.warn('digest.place_cards_incomplete', …)`。
- `nudgePrompt` 文案补上 write_outline（只能调一次）与 place_cards 两步。

## 目标 5：Prompt 重编号（1-10 → 1-11）

- `prompts.ts` `DIGEST_SYSTEM_PROMPT`：新第 4 步 write_outline（一级=标题/章节锚标题原文、二级=1、2、3 脉络锚所在句、无标题文档至少一个一级节点锚主题句、blockIndex/quote 规则同 write_cards）；place_cards 按要求「在 write_questions 步之后」写进第 7 步后半段（出题后调 place_cards 挂到所属大纲节点，parentId 用 write_outline 返回的 nodeId，对不上二级脉络时挂一级节点）；后续步骤顺延为 8-11，交叉引用「第 8 步刚软归属成功」→「第 9 步刚软归属成功」；约束段加「write_outline 只能调用一次，建错了不要重复调用，继续后面的步骤」。
  - 取舍说明：任务书要求净增一步（last 10→11）且「后续步骤顺延为 8-11」，与「write_outline、place_cards 各成一步」不能同时成立；按编号约束把 place_cards 并入第 7 步（与 write_questions 同一步的后半段），write_outline 单独成第 4 步。
- `prompts.test.ts`：`last: 10 → 11`；显式 contains 断言改号（4→write_outline、5→search_user_memories、8→link 步）；新增 contains `write_outline` / `place_cards` / `write_outline 只能调用一次`；not.toContain 补「第 8 步刚软归属成功」。

## 目标 6：批注查询点过滤（outline 防污染）

均加 `ne(annotations.kind, 'outline')`：

- `apps/server/src/agent/annotation-tools.ts` `loadDocumentAnnotationsView`（digest/evolve 的 read_document_annotations）
- `apps/server/src/search/search.service.ts` `searchAnnotationIdsIlike`
- `apps/server/src/agent/weekly-tools.ts` 周报批注计数与批注行（两处）
- `apps/server/src/annotations/resurface.ts` `loadResurfaceCandidates`
- `apps/server/src/annotations/annotation.service.ts` `listArchivedAnnotations`（回收站）

未改：`listDocumentAnnotations`、canvas `loadVisible`、canvas-history、files/card/document service、`loadAnnotationsByIds`（outline 不进检索索引，检索 id 集中本就不会出现）。

## 目标 7：web 改动

- `apps/web/src/components/document-actions.tsx`：原条件项「重试处理」替换为常显「AI 消化」，`disabled={service.busy || service.doc?.status !== 'failed'}`，点击仍 `service.showDialog('retry')` 复用现有 retry 流程；dialogTitle 的 retry 映射改「AI 消化」；retry dialog 文案改「重新消化「…」，未确认的卡片会重建。」。
- `document-actions.css` 已有 `.document-context-menu button:disabled { opacity: .5; }`（:28），无需补。
- `apps/web/src/pages/docs/canvas-nodes.tsx` `noteKicker`：加 `if (item.kind === 'outline') return '大纲';`（兜底 '批注' 之前）。
- 其它 kind if 链有兜底，未改；typecheck 确认无 `Record<AnnotationKind, …>` 穷举（mobile/doc-engine 均通过）。

## 验证命令结果

- `pnpm --filter @inwit/dto build` — 通过。
- `pnpm typecheck` — 全绿（server/web/mobile/doc-engine/dto 等全部 Done）。过程中修掉一处：`outline-tools.ts` 在 noUncheckedIndexedAccess 下 `created[ref]` 为 `string | undefined`，对收集进 session 的 nodeIds 加 filter 收窄。
- `pnpm --filter @inwit/server test` — 88 文件 / 763 用例全过（含新增 outline-logic 5 例、mind-edit-logic 2 例、prompts 改号断言）。
- `pnpm --filter @inwit/web build` — 通过（仅有既有 chunk 体积警告）。
- `pnpm --filter @inwit/server migrate:generate` — diff 仅 constraint 替换（DROP/ADD `annotations_kind_check` 两行，无需裁剪）；`migrate` 成功。
- `git diff --check` — 无输出，通过。

## 遗留风险 / 待真实链路验证（csi）

- digest 真实跑通后：脑图出现「大纲」kicker 的两级划线节点、卡片挂到对应大纲节点、点击跳回原文闪烁；failed 文档右键「AI 消化」可点且重消化后旧大纲无残留（硬删 + FK 回落）；digested/pending 置灰；无标题短文至少一个一级节点；搜索/重浮/周报/回收站不出现大纲节点。
- write_outline 依赖模型给出逐字 quote，`locateHighlightQuote` 失败会整批失败并让模型重试（不 throw）；若模型反复建不出大纲，verify 的 `digest wrote no outline nodes` 经一次 nudge 后仍会判失败——与 cards=0 之外的既有软失败路径一致。
- place_cards 挂不上（深度/父节点缺失等）只 warn，卡片留在脑图根部，不挡消化完成（任务书确认的软验收）。
