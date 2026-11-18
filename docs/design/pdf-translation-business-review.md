# PDF 翻译业务模块独立审阅

日期：2026-11-17。审阅者：backend SubAgent；实现者：review_acceptance SubAgent。范围为 `documents/translation/{translation.service,processor,index.service,translation-logic,translation.routes}.ts` 以及导入、回收站与物理清理接线。审阅者没有修改这些业务实现或其测试。

## 结论

已发现的三项阻断问题均由实现者修复，独立复核及实际测试通过。未发现剩余 P0/P1。此结论不代替 PDF 样本和真实浏览器验收，也不宣称已调用真实付费供应商评价译文质量。

## 问题与修复证据

1. **解析失败时选区退路不可用**：原先失败响应没有持久化文件哈希和页面几何，而选区接口要求可信几何。现在段落抽取异常后独立读取同一服务端 PDF 引擎的页面几何，持久保存 `failed` 页状态、文件哈希与页面几何，允许显式选区翻译；原文件本身无法下载或打不开时仍明确失败。
2. **完整段落选区不能复用缓存**：原先逐点比较原始矩形，PDFium 与 PDF.js 字体基线、四角次序差异导致误失配。现在先要求标准化文字完全一致，再双向校验同行覆盖；唯一匹配才复用段落身份。测试包含倒序四角、2 point 基线差异，并确认缓存命中仍只有一次模型调用。
3. **物理清理遗留执行载体**：文档级联删除业务任务不会反向删除 `jobs`。现在物理删除事务先锁文档、删除关联 `pdf_translate` 载体，再删除文档及级联数据。测试确认执行载体、业务任务、内容行和译文均清理。

同时核对：短事务锁顺序、同内容活动任务互斥、幂等别名重放、未知结果显式确认、执行令牌与目标 revision 条件提交、失败重译保留旧结果、软删除后的读取/写回限制，以及服务端读取权威段落原文。模型请求在事务外，任务 payload 仅含业务任务 ID。

## 独立执行

所有 PostgreSQL 测试均显式指向本机 `127.0.0.1:55439 / inwit_pdf_local`，外部存储、检索端点覆盖为本机未使用端口，凭据为测试占位值。没有使用开发或生产数据库运行本次独立复核。

```sh
PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local \
PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false NODE_ENV=test \
QDRANT_URL=http://127.0.0.1:63339 QDRANT_API_KEY=local-only \
MEILI_HOST=http://127.0.0.1:7709 MEILI_API_KEY=local-only \
DASHSCOPE_API_KEY=local-only DASHSCOPE_BASE_URL=http://127.0.0.1:8889 \
ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9009 ATTACHMENT_S3_REGION=local \
ATTACHMENT_S3_BUCKET=local-test ATTACHMENT_S3_ACCESS_KEY_ID=local-only \
ATTACHMENT_S3_SECRET_ACCESS_KEY=local-only \
pnpm --filter @inwit/server exec vitest run \
  src/documents/translation/translation.integration.test.ts \
  src/documents/translation/translation-logic.test.ts \
  src/documents/document-write-boundary.test.ts
```

结果：**3 文件、19 测试通过，2.31 秒**。包括 12 个真实 PostgreSQL 业务测试、5 个纯逻辑测试和 2 个文档写入边界测试。模型调用与原件存储在这些测试中替换为受控适配器，不产生供应商费用。

## 明确实施差异

首次索引仍由领取者的当前页 GET 等待确定性解析完成；竞争者立即得到持久 `indexing` 状态，前端仅对可见窗口中已挂载页面轮询。索引工作采用数据库短事务领取与提交，解析在事务外；页行 UUID 是执行令牌，120 秒过期可被新请求回收，旧执行者成功或失败均不能覆盖新结果。此流程不调用模型，失败页状态独立于文档消化状态。文件不可读时不能保证选区退路可用。

持久索引补充由 pdf_probe 实现，本审阅者独立阅读实现，并在同一本地 PostgreSQL 环境实际重跑 `src/documents/translation/index.integration.test.ts`，**5/5 通过**：8 个竞争请求仅一次解析、过期令牌替换、迟到成功/失败不覆盖、孤儿租约恢复与双重解析失败结算。无剩余索引一致性阻断项。
