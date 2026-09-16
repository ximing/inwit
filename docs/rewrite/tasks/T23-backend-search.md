# T23 · 后端：全局搜索 API（文档+卡片，双路召回 RRF 融合 rerank）

先读 `docs/rewrite/CONTEXT.md`。

## 背景现状（已核实）

- 检索层 `apps/server/src/retrieval/` 完整：embedding（百炼 2560 维）→ Qdrant 向量 ∪ Meili 中文稀疏 → `rrfMerge` → DashScope rerank
- `pipeline.ts` 已有 `searchCards(userId, query, limit)`（返回排序后 card id 列表）、`indexCard`/`deleteCard`；卡片在 digest/evolve/selection 时已索引，store 名 `cardsStoreName()`（按 NODE_ENV 分 dev/prod）
- **文档没有进索引**，也没有对外的搜索 HTTP 接口
- 文档 description/title 已由 T21 提供（消化后 agent 写）

## 任务

### 1. 文档进检索（`retrieval/pipeline.ts`）

- 新增 `docsStoreName()`（`inwit_docs_<env>`）；`indexDocument(doc)`：向量文本 = `title + description + contentMd 前 500 字`；Meili payload 带 `user_id/doc_id/title/description/content_md`
- 钩子（与 indexCard 同样的调用方式，失败不阻塞主流程——参考现有 indexCard 调用点的容错）：
  - digest/chat/selection 完成（title/description 落定后）
  - `updateDocument` 内容/标题变化
  - `deleteDocument` → `deleteDocumentFromIndex`
  - import 创建（内容已落定）
- store 初始化：参考 cards store 的建表/建集合逻辑（registry.ts），docs store 首次用时确保存在

### 2. 搜索 API

- `GET /api/search?q=<text>&limit=`（auth）→ `{ documents: DocumentListItem[], cards: Card[] }`
  - 文档：`searchDocuments(userId, q, limit)` 走同款 双路→RRF→rerank（rerank 文本 = title+description+content 头部），拿回 id 后从 PG 取行转 DTO
  - 卡片：复用 `searchCards`，拿回 id 后取行转 Card DTO（带 documentId 供前端跳转）
  - q 为空 → 400；默认 limit 8
- **降级**：检索客户端不可用时（embedding/qdrant/meili 任一抛错）回落 PG `ILIKE`（title/description/contentMd 模糊匹配，按 updatedAt 排），单个搜索不因外部服务挂掉而 500。降级逻辑抽纯函数可测

### 3. 回填脚本

- `scripts/backfill-search.ts`：把现有全部文档+（缺索引的）卡片补进检索 store；`pnpm -F @inwit/server tsx` 可跑，跑一遍 dev 库

### 4. 冒烟

- `scripts/smoke-t25.sh`：注册新用户 → 建两篇内容迥异的文档 → 手动触发 index（或直接调 indexDocument 的钩子路径）→ GET /api/search 命中正确文档、另一篇排后或不出现；空 q → 400；再验证降级路径可关可开

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build`（dto 若变）全过
- curl 实测 GET /api/search 返回结构正确（百炼/Qdrant/Meili 都在线；`pnpm -F @inwit/server test:retrieval` 可参考）
- 回填脚本跑过 dev 库
- 不启动/停止 dev server / worker / s3rver
