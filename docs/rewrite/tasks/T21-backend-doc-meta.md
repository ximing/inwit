# T21 · 后端：标题可空 + Agent 总结标题与摘要（description）

先读 `docs/rewrite/CONTEXT.md`。

## 背景现状（已核实）

- `documents.title` 是 `text notNull`，`createDocument` 用 dto 的 `titleFromContent`（内容第一行）兜底——一句话扔进去标题=内容，难看
- `documents` 无摘要字段；digest（`apps/server/src/agent/digest.ts`）消化完只 `markDocument('digested', {linkHint})`，不重拟标题不写摘要
- `chat` 同理（标题=问题全文）
- `DocumentListItem`/`Document` DTO 在 `packages/dto/src/document.ts`

## 任务

### 1. schema + migration

- `documents.title` 改为**可空**（migration：ALTER COLUMN DROP NOT NULL）
- 新增 `documents.description text`（可空，Agent 写的一两句摘要）

### 2. DTO（`packages/dto/src/document.ts`）

- `Document`/`DocumentListItem`：`title: z.string().nullable()`，加 `description: z.string().nullable()`
- 新增共享 helper `docDisplayTitle(doc: {title, description}): string`：title 非空用 title；否则取 description 第一行截 40 字；都没有→「未命名文档」
- `CreateDocumentInput.title` 保持 optional；`titleFromContent` 保留但**创建时不再自动兜底**（见下）

### 3. 创建链路（`document.service.ts`）

- `createDocument`/`createChat`：`input.title ?? null`，不再 titleFromContent 兜底（import 的 `titleFromFilename` 保留——文件名是真标题；POST /api/documents 传了 title 就用）
- `toPublicDocument`/列表 mapper 带上 description

### 4. digest agent 重拟标题 + 写摘要

- digest 完成时（`markDocument` 处）：让 digest 产出**标题**（≤20 字，名词短语，不是内容复读）和 **description**（≤60 字，一两句说清这篇讲了什么）
- 实现选择（取更稳的）：在 digest agent 增加一个 finalize 工具（如 `set_document_meta {title, description}`），或 digest 结束后用一次轻量 LLM 调用生成。逻辑抽纯函数（`digest-logic.ts` 或新 `doc-meta-logic.ts`）+ 单元测试（解析、截断、空值兜底）
- 尊重用户手改：`documents.title` 非空且不是「未命名文档」时**只写 description 不改标题**；chat 文档同样处理
- import 文档有文件名标题：同样只补 description
- 空文档/极短内容：description 也允许为空（agent 无话说就不写）

### 5. 冒烟

- `scripts/smoke-t24.sh` 或新 `smoke-t25.sh`：POST /api/documents 无标题 → 201 且 title=null；GET 列表项带 description 字段

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build` 全过
- migration 执行到远程 dev 库
- curl 实测：无标题创建 → title=null；列表带 description
- 不启动/停止 dev server / worker / s3rver
