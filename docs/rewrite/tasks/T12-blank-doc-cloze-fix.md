# T12 · 修复：空白文档 digest 失败 + 卡片 cloze 语法裸显

先读 `docs/rewrite/CONTEXT.md`。

## 背景（都是 T11 自测暴露的真问题）

### 问题 1：新建空白文档 → digest 必然失败

`POST /api/documents`（`createDocument`）无条件 `enqueueJob('digest')`。前端"新建文档"创建的是**空白文档**，digest 对空内容执行失败，文档永远停在 `status='failed'`（列表里显示红色"失败"），之后用户写了内容也不会再消化——`updateDocument` 不入队 digest。

要求（`apps/server/src/documents/document.service.ts`）：

1. `createDocument`：`contentMd` trim 后为空时**不入队 digest**，直接以 `status='digested'` 落库（语义：没什么可消化的，不是失败）
2. `updateDocument`：本次更新使 contentMd 从空白变为非空白，且该文档**一张卡都没有**、且没有 pending/running 的 digest job（用现有 `cancelPendingDocumentJobs` 附近的查询方式或 jobs 表查询判断）→ 事务内 `enqueueJob('digest')` 并把 status 置回 `'pending'`
3. 纯逻辑抽到可测函数（如 `shouldEnqueueDigest(existing, input, cardCount)` 放 `*-logic.ts` 或就近），补单元测试

### 问题 2：卡片的 cloze 语法 `{{c1::答案}}` 在前端裸显

`/docs` 阅读态的"本文卡片"mini-grid 把卡片问题原文渲染，cloze 标记 `{{c1::k}}` 直接露出来，很粗糙。

要求（`apps/web/src`）：

1. 加一个共享的 cloze 渲染工具（如 `lib/cloze.ts`）：`{{c1::文本}}` → 下划线强调样式的文本（阅读态显示答案文本本身，加 `.cloze` 样式类：底色/下划线，风格参考 inwit.css 的 mark 划线样式，克制）；支持一个 strip 模式用于纯文本场景
2. `/docs` 的本文卡片 mini-grid 用它渲染问题
3. 检查 `/review` 翻卡 session 的卡片正反面：如果也裸显 `{{cN::}}`，一并修（背面显示文本，正面可把 cloze 答案替换为"……"——如果现有逻辑已处理就不要动）
4. 补 `lib/cloze.test.ts`？前端无测试体系，不用；但逻辑保持纯函数

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build` 全过
- curl 实测：POST /api/documents 空 contentMd → 201 且 status='digested'、jobs 表无新 digest；再 PUT 写入内容 → status='pending' 且 digest job 入队
- 不启动/停止任何 dev server / worker
