# T24 简报 —— PDF 原生预览 + 批注 + 扫描版 OCR

依据：`docs/tasks/t24.md`。前置：导入提取（T1 / rewrite T10–T11）、批注划词（rewrite T16–T17）、S3 presign、锚点机制。核心原则不变：**一份文档、两种视图，不搞两套系统**——`contentMd` 仍是 digest / 检索 / 卡片锚点 / 批注 quote 的唯一真相；PDF 原件是同一条 `documents` 上的展示附件。

本任务已全部实施并在真实 Chrome（csi）上回归。本文只记落地、决策、回归里有教育价值的三个 bug，以及已知限制。

## 六个目标的落地

### 目标 1：数据模型

一次 migration，列全可空、向后兼容。

| 表 | 新增 |
|---|---|
| `documents` | `file_key` / `file_mime` / `file_size`（bigint，见偏差）/ `page_count` |
| `annotations` | `kind`（`text` \| `pdf`，`media` 预留）/ `page_index` / `geometry` jsonb / `image_key` / `position_ms` |
| `cards` | `image_key` |
| `ocr_configs` | 新表：`user_id` unique、`api_key_encrypted`、`model` 默认 `qwen-vl-ocr`、`base_url` |

DTO：

- `documentSchema` 加 `fileMime` / `pageCount`，**不下发 `fileKey`**。
- `cardSchema` 加 `hasImage`（由 `imageKey` 派生），图片走 `GET /api/cards/:id/image`。
- `annotationSchema` / `createAnnotationInputSchema` 按 kind 校验：`pdf` 必须 `pageIndex + geometry`，`text` 不许带这些字段。
- 扫描版：`source='import'` 允许空 `contentMd`，digest 在空正文时不自动入队。`contentMd` 的 100k 上限只在编辑器/粘贴 DTO，import / OCR 走 service 直写。

migration：`0012_pdf_file_annotations_ocr` + `0013_fixed_stellaris`（`jobs.type` 加上 `extract` / `ocr`，`file_size` 改为 bigint）。已对远程 PG 执行。

### 目标 2：S3 分片直传导入

旧 `POST /api/documents/import` multipart 中转（全量进内存、20MB 上限）去掉。全局改 S3 multipart，5MB/片，技术天花板 2GB（`IMPORT_MAX_FILE_BYTES`）。小文件（txt/md/docx/epub，&lt;5MB）走同一条链路，单片即完，不留旧路径。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/documents/import/init` | 建 `documents`（`status=pending`，`fileKey=docs/{userId}/{docId}/source.{ext}`）→ CreateMultipartUpload → `{ documentId, uploadId, key }` |
| POST | `/api/documents/import/:id/parts` | 批量签发 UploadPart URL（TTL 15min） |
| POST | `/api/documents/import/:id/complete` | CompleteMultipartUpload → 入队 `extract`，立即返回 |
| POST | `/api/documents/import/:id/abort` | 中止 multipart |
| GET | `/api/documents/:id/file` | 属主校验 → `presignGet(fileKey)` → `{ url, mime }`（TTL 1h） |
| POST | `/api/documents/:id/retry` | 按当前阶段重入队 extract / ocr / digest |

前端：`docs.service` 的 `importFile` 走分片上传器（并发 ≤3、分片失败重试、总体进度、localStorage 断点续传）。删文档时 best-effort 清 S3（原件 + `excerpts/` 前缀），失败记日志不阻塞。worker / 服务端处理大文件落临时文件，不全量进内存。

### 目标 3：OCR 独立配置 + 异步管线

import complete 只入队 job，用户立刻能预览原件。

- **`extract`**：S3 GetObject → 临时文件 → `extractImportedMarkdown`（unpdf，页间 `\n\n---\n\n`）→ 写回 `contentMd` / `pageCount`。文本非空链式 `digest`；PDF 且文本为空链式 `ocr`。
- **`ocr`**：拆页栅格化 PNG → 逐页 Chat API 调 `qwen-vl-ocr` → 按同样分页符拼回 `contentMd` → 链式 `digest`。payload 记 `totalPages` / `donePages` / `failedPages` / `pageTexts`，重试只补失败页。每批默认 10 页（`OCR_PAGE_BATCH_SIZE`），批内并发 2，默认 180 DPI。
- **拆页**：`pdfjs-dist` 6.3.289 legacy + `@napi-rs/canvas`。qwen-vl-ocr **不支持 PDF 直传**，必须 Chat API + 图片。
- **BYOK**：`ocr_configs` 独立于 `llm_configs`。解析顺序：用户 OCR 配置 → 系统 `DASHSCOPE_API_KEY`。`GET/PUT /api/ocr-config`、`POST /api/ocr-config/test`（小图探测，错误信息 key 脱敏）。
- **进度**：文档行 / 详情复用 job 轮询：`上传中 x%` → `提取中…` → `识别中 12/48 页` → `消化中…`。失败态标 `failed` + 行内「重试」。
- 设置页独立区块「文档解析（OCR）」：key、模型（默认 `qwen-vl-ocr`）、可选 Base URL、保存 / 测试。文案说明计费走用户自己的百炼账户。

### 目标 4：EmbedPDF PDF 视图

`doc.fileMime === 'application/pdf'` → 懒加载 `<PdfPane>`（WASM），否则原 `<PaneRead>`。`PdfPaneService` + `observer` / `useService`。

- 加载：`GET /api/documents/:id/file` 的 presigned URL 喂 EmbedPDF loader。
- **pin `@embedpdf/*@2.15.0`**，不上 v3-next。headless 插件（annotation / selection / capture / zoom / search），UI 自绘。
- 适配层集中在 `pdf-pane/annotation-adapter.ts`：自有 `{ quads, color }` ⇄ EmbedPDF `AnnotationTransferItem`。DB **不存** viewer 原生格式，给 v3 升级留隔离。
- 划词：selection plugin → 现有同款工具条（记一笔 / 转为卡片）。无文本层（OCR 未完成）禁用划词，提示用框选。
- PDF 强制预览，隐藏「编辑 / 预览」切换（见决策）。

### 目标 5：批注 ⇄ 卡片闭环

- 点击批注 / 卡片：`pageIndex` 优先，否则 `anchorBlock` 或 quote 经 `\n\n---\n\n` 换页码 → 跳页 → 页内文本层搜索 quote 高亮。`docAnchorPath` URL 参数平移到 PDF。
- **文字划词切卡**仍走 `POST /api/documents/:id/selection-cards`（selection job + `resolveAnchor`）。
- **框选转卡不走 selection job**（见决策），走同步 `POST /api/cards`。
- 复习页 / 主题页卡片「原文」走 `docAnchorPath`，文本 / PDF 通吃。

### 目标 6：框选摘录 + 卡片图片渲染

1. capture 框选 → 截图 Blob → `POST /api/documents/:id/excerpts`（png/jpeg/webp ≤5MB）→ presign PUT → 直传 S3，key `docs/{userId}/{docId}/excerpts/{uuid}.ext`。
2. `createAnnotation({ kind:'pdf', pageIndex, geometry, imageKey })`；批注列表缩略图走 `GET /api/annotations/:id/image`。
3. 「转为卡片」：`createCardInput.imageKey` + `anchorText='[图片摘录]'` + `anchorBlock` 为 1-based 页码。`GET /api/cards/:id/image` 签发 URL。CardRail / 复习页 / 卡片正面渲染截图。digest 不消费 `image_key`，图片卡只来自手动框选。

明确不做的仍未做：影音批注 UI、EmbedPDF v3、批注写回 PDF 文件、epub/docx 原生预览。

## 关键决策与偏差

1. **EmbedPDF pin v2.15.0**。v3 官方不建议生产且 capture 未移植。自有批注格式隔离在 `annotation-adapter.ts`，升级时只改这一层。
2. **框选转卡走扩展的同步 `POST /api/cards`（`imageKey`）**，不走 selection job。selection job 是「选段 → LLM 出 1–3 张文本卡」；框选是用户已经裁好的图，没有可消化的选段文本，再绕异步 agent 只会多一次失败面。`imageKey` 必须落在 `docs/{userId}/{docId}/excerpts/` 白名单内。
3. **PDF 文档强制预览，隐藏「编辑 / 预览」切换。** 编辑 `contentMd` 会打乱 `\n\n---\n\n` 页锚点，预览是唯一有意义的视图。`?edit=1` 对 PDF 直接剥掉。
4. **服务端拆页用 `pdfjs-dist` + `@napi-rs/canvas`，qwen-vl-ocr 逐页 Chat API。** 不用 qwen3.5-ocr（贵，且 PDF 直传是它的专属能力）。默认文字识别内置任务，单页 `max_tokens=4096`，避免密排页截断。
5. **`file_size` 用 bigint 而不是 integer。** 2GB 天花板超出 32-bit int；`0013_fixed_stellaris` 改列类型。
6. **annotation DTO 仍带 `imageKey`。** 任务书写「fileKey/imageKey 一律不下发」针对文档原件和卡片渲染；框选转卡需要客户端把 excerpts 返回的 key 交给 `POST /api/cards`，所以批注对象保留 key（白名单校验），卡片对外只暴露 `hasImage`。客户端从不持有 storage token，图片一律走签发 URL。

## 回归发现的三个 bug（及 zoom 闸）

### 1. Vite `?url` 根相对路径在 EmbedPDF blob worker 里 fetch 失败

**现象**：开发态 PDF 卡在「正在打开…」，引擎 promise 永不 settle。网络面板看不到 wasm 请求。

**根因**：`import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'` 在 Vite dev 下给出 `/node_modules/@embedpdf/pdfium/dist/pdfium.wasm`。EmbedPDF 把 wasm fetch 放到 `blob:` worker 里执行。Worker 的 base 是 `blob:`，对根相对路径 `fetch('/node_modules/...')` 抛 `Failed to parse URL`。库本身不把这个错误冒泡到 `usePdfiumEngine`。

**修复**：`wasm-url-logic.ts` 的 `toAbsoluteUrl`，用 `window.location.origin` 拼成绝对 href 再交给引擎。单测覆盖绝对 / 根相对 / 相对 / blob / data URL。

**教训**：给 Web Worker 的资源 URL 必须是 worker 能独立解析的绝对地址；Vite `?url` 在 dev 与 build 形态不同，适配层要显式归一。

### 2. worker 进程共享导致 unpdf 污染 `globalThis.pdfjsWorker`

**现象**：同一 worker 进程里，文字版 PDF 的 `extract`（unpdf）跑过之后，扫描版 `ocr` 栅格化失败或渲染错乱。

**根因**：Node 里 pdfjs 关掉 Worker 线程，走主线程 fake worker，**优先读 `globalThis.pdfjsWorker`，忽略 `workerSrc`**。`unpdf@1.8` 捆绑 pdfjs **6.1.200**，加载时把这份 worker 写进 `globalThis.pdfjsWorker`。OCR 用的是 `pdfjs-dist@6.3.289`。两个大版本的 worker / API 不能混用，后到的 `getDocument` 拿到的是别人的 worker。

**修复**：`rasterize.ts` 在每次 `getDocument` 前 `pinPdfjsWorker()`：强制 `GlobalWorkerOptions.workerSrc` 指向本副本的 `legacy/build/pdf.worker.mjs`，并把 `globalThis.pdfjsWorker` 钉回 6.3.289 的模块。

**教训**：同一 Node 进程里两份 pdfjs 会抢全局单例。extract（文本）和 OCR（位图）必须钉版本、钉全局，不能假设 `workerSrc` 够用。

### 3. CDP `pointercancel` 不触发 EmbedPDF `endSelection`

**现象**：csi / Chrome DevTools Protocol 合成拖拽能看到蓝色选区，松手后面板工具条不出现，`POST /api/annotations` 也不会发。真鼠标正常。

**根因**：`plugin-selection` 的文本手势只在 `pointerup` 上 `endSelection`。CDP `Input.dispatchMouseEvent` 的 `mouseReleased` 经常合成 `pointercancel` 而不是 `pointerup`。选区状态停在 `selecting`，菜单 placement 保持 hidden。框选 marquee 有同样的松手问题。

**修复**：`pdf-viewer.tsx` 在 capture 阶段听 `pointercancel`：若仍在划词，把当前 `selection` `setSelection` 后走与 `onEndSelection` 相同的 `applyFormatted`；若 marquee 预览矩形够大，直接 `captureArea`。`selection-logic.ts` 的 `rectsFromFormattedSelection` / `isMarqueeLargeEnough` 把这段逻辑收成可测纯函数。这不只是测试补丁——触摸取消、系统抢指针时，真用户也会丢 `pointerup`。

**附：zoom 插件 0 尺寸闸死 viewport。** `plugin-zoom` 在文档加载时给 viewport 上一把 `zoom` gate，只在一次成功的 `requestZoom` 后解开。`FitWidth` 经常在 metrics 仍是 0 时跑，gate 永不抬，页面空白（回归里 `shot7` 就是这个状态：工具条 `1/1 · 100% · 框选摘录`，中间全黑）。修复：mount 时若 `hasGate('zoom')` 则 `releaseGate`，再 `requestZoom(FitWidth)`。

## 回归验证清单

真实 Chrome + csi，账号 **`regression@inwit.dev`**（Grok 自己浏览器验证时用的是「席铭」账号，两套数据不要混）。应用 `http://127.0.0.1:5190`。

| 项 | 结果 |
|---|---|
| 分片上传（文字版 `text.pdf`、扫描版 `scanned.pdf`、小 txt） | 过。complete 立即返回，PDF 可预览 |
| 文字版 PDF 原生渲染 | 过。无「编辑 / 预览」切换 |
| 划词 → 记一笔 | `POST /api/annotations` **201**；侧栏「批注 · 1」 |
| 刷新重绘 | 高亮与侧栏条目仍在（geometry 自有格式 → `importAnnotations`） |
| 框选摘录 | 截图批注 + 侧栏缩略图 `[图片摘录]` |
| 扫描版 OCR 全流程 | 预览原件 → 行内「识别中 x/y 页」→「消化中…」→ 出卡 → 搜索「遗忘曲线」命中 OCR 文本 |
| 失败重试 | 文档行「失败」+「重试」→ `POST /api/documents/:id/retry` 201 |
| 图片卡 | 框选转卡走 `POST /api/cards`；CardRail 与复习页正面渲染截图 |
| 复习页「原文」 | 跳回 PDF，页内框选区域可见 |
| 设置页 OCR 区块 | 「文档解析（OCR）」，默认模型 `qwen-vl-ocr`，保存 / 测试 |

单页扫描夹具 OCR 很快结束，「识别中 x/y 页」在轮询里看到，截图取的是完成后的扫描版视图（`t24-ocr-scanned.png`）。

截图（`docs/screenshots/`）：

- `t24-pdf-render.png` — 文字版 PDF 原生预览
- `t24-select-toolbar.png` — 划词工具条 + 记一笔
- `t24-annotation-redraw.png` — 高亮批注 + 侧栏
- `t24-annotation-persist.png` — 刷新后重绘
- `t24-ocr-scanned.png` — 扫描版 OCR 完成后出卡
- `t24-search-ocr.png` — 搜索命中 OCR 文本
- `t24-excerpt-thumb.png` — 框选摘录缩略图
- `t24-review-image-card.png` — 复习页图片卡
- `t24-source-jump.png` — 「原文」跳回 PDF
- `t24-ocr-settings.png` — 设置页 OCR 区块

## 已知限制

- **复习队列每日新卡上限会把当日新图片卡截到明天**（by design，SM-2 / rewrite T1 的 `newCardsPerDay`）。回归里刷完今日队列后「明天到期 10 张」，其中含刚转的图片卡，不是丢卡。
- **CDP 合成拖拽的选区扩展滞后**，真鼠标无此问题。`pointercancel` 兜底让松手能提交，但选区长度仍可能比手势意图短一截。
- **大文件（数百页）未实测。** 批处理 / 断点续跑逻辑有单测，100+ 页的时长与 token 成本没有用真实夹具跑过。
- 账号：Grok 自验用「席铭」，回归用 `regression@inwit.dev`。

## 纯逻辑与测试

抽到 `*-logic.ts` 并配 vitest（无数据库）的模块：

- server：`import-logic` / `multipart-logic` / `extract-logic` / `excerpt-logic` / `ocr-logic` / `presign-logic` / annotation DTO 组合校验 / `createCardInput.imageKey`
- web：`annotation-adapter` / `page-logic` / `selection-logic` / `wasm-url-logic` / `multipart-logic` / `presign-cache-logic`

编排 / IO 仍在 `extract-job.ts`、`ocr-job.ts`、`rasterize.ts`、`import.service.ts`、`pdf-viewer.tsx`。

typecheck / server test / web build 由实施与回归子任务跑绿。本报告任务不改代码、不重跑测试。

## 改动文件（T24 范围）

### dto / schema

- `packages/dto/src/{annotation,ocr,card,document,job,index}.ts`
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0012_pdf_file_annotations_ocr.sql`
- `apps/server/drizzle/0013_fixed_stellaris.sql`（`jobs.type` + `file_size` bigint）

### server

- `apps/server/src/documents/{import.service,import-logic,multipart-logic,extract,extract-job,extract-logic,excerpt-logic,document.routes,document.service}.ts`
- `apps/server/src/ocr/{ocr.routes,ocr.service,ocr-api,ocr-job,ocr-logic,rasterize}.ts`
- `apps/server/src/annotations/{annotation.routes,annotation.service}.ts`
- `apps/server/src/cards/{card.routes,card.service,card.mapper}.ts`
- `apps/server/src/storage/{client,presign-logic}.ts`
- `apps/server/src/{app,config,jobs/processors,jobs/queue}.ts`
- 对应 `*.test.ts`

### web

- `apps/web/src/pages/docs/{pdf-pane.tsx,pdf-pane.service.ts,pdf-pane/*,selection-toolbar.tsx,docs.service.ts,index.tsx}`
- `apps/web/src/lib/{multipart-upload,multipart-logic,doc-pipeline,presign-cache-logic}.ts`
- `apps/web/src/api/{documents,annotations,ocr,cards}.ts`
- `apps/web/src/pages/{settings,review}/*`（OCR 区块、图片卡、「原文」）
- `apps/web/package.json`（`@embedpdf/*@2.15.0`）、`vite.config.ts`（`assetsInclude` wasm）

### 文档 / 截图

- `docs/tasks/t24.md`、`docs/tasks/t24-report.md`、`docs/dev-log.md`
- `docs/screenshots/t24-*.png`
