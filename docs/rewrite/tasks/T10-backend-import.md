# T10 · 后端：文件导入（PDF / DOCX / EPUB / TXT / MD）

先读 `docs/rewrite/CONTEXT.md`。

## 目标

新增 `POST /api/documents/import`：用户上传文件 → 服务端提取纯文本/Markdown → 复用现有 `createDocument` 落库并自动入队 digest 任务（消化管线不变）。

## 现状事实

- `apps/server/src/documents/document.service.ts` 的 `createDocument(userId, {title?, contentMd, topicId?, source?})` 已处理落库 + `enqueueJob('digest')`，**直接复用，不要重写**
- `documents.source` 目前有 CHECK 约束 `IN ('editor','paste','chat','agent')`（`apps/server/src/db/schema.ts` ~L156）；`packages/dto/src/document.ts` 的 `documentSourceSchema` 同步定义
- 没有 multipart 依赖；Fastify 5 原生不支持文件上传

## 任务

### 1. 依赖（`pnpm -F @inwit/server add ...`）

- `@fastify/multipart`（注册到 app，限制文件大小 20MB、单文件）
- 提取库，要求 **ESM 兼容、Node 22 可用**：
  - PDF：推荐 `unpdf`（ESM 友好）；若不行用 `pdfjs-dist` legacy 构建
  - DOCX：`mammoth`
  - EPUB：`@gxl/epub-parser` 或其它可用项（解压 XHTML → 去标签按章节拼接）
  - TXT/MD：直接读 buffer（按 utf-8 解码，容忍 BOM）

### 2. 代码结构（遵守 Agent 代码固定切分约定）

- `apps/server/src/documents/import-logic.ts` — **纯逻辑 + 测试**：
  - `detectImportFormat(filename, mimetype)` → `'pdf'|'docx'|'epub'|'txt'|'md'`，不支持的抛 415
  - `titleFromFilename(filename)` → 去扩展名、去多余空白
  - `normalizeExtractedText(text, format)` → 统一换行、折叠 3+ 空行、trim；PDF 按页提取时页间加分隔
  - `import-logic.test.ts` 覆盖以上
- `apps/server/src/documents/extract.ts` — IO 编排：buffer + format → markdown 字符串（调各解析库）；EPUB  spine 顺序拼接、去 HTML 标签保留段落结构
- 提取失败（加密 PDF、损坏文件）→ `AppError.of(422, 'IMPORT_PARSE_FAILED')`；空内容 → 422 `IMPORT_EMPTY`

### 3. 路由（`document.routes.ts`）

```
POST /api/documents/import
  auth → multipart file 字段名 "file"，可选字段 "topicId"
  → detectImportFormat → extract → createDocument(userId, { contentMd, title: titleFromFilename, topicId, source: 'import' })
  → 返回 Document DTO（201）
```

- topicId 属主/归档校验走 `createDocument` 现有逻辑
- 超过 20MB → 413（multipart 内置 limit 即可）

### 4. source 增加 'import'

- `packages/dto/src/document.ts`：`documentSourceSchema` 加 `'import'`
- drizzle migration：重建 `documents_source_check` 约束加入 `'import'`（`migrate:generate` 后检查生成的 SQL，CHECK 约束变更若 generate 没捕获就手写 ALTER TABLE DROP/ADD CONSTRAINT，参考 0007 的写法）→ `migrate` 执行到远程 dev 库

### 5. DTO 同步

- `ListDocumentsQuery` / 文档列表项如已有 source 字段则自动带上，无需额外改；确认 `Document`/`DocumentListItem` 的 source 类型包含 'import'

## 验收

```bash
pnpm typecheck
pnpm -F @inwit/server test
pnpm -F @inwit/web build   # dto 变了，确认前端编译
```

- 新增纯逻辑测试全过；migration 已执行
- 用 curl 实测（dev server :3020 在跑，cookie 见 CONTEXT）：
  - 上传一个 .md/.txt → 201，文档 status=pending，title 正确
  - 上传 .exe 或不支持类型 → 415
  - 上传损坏的 .pdf → 422
- **不要启动/停止任何 dev server / worker**
