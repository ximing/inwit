# 翻译后端基础独立审阅

审阅者：pdf_probe（未实现被审阅的 DTO、schema、LLM 设置/调用和队列代码）。日期：2026-11-17。状态：基础后端与 Web 交叉静态审阅通过；真实浏览器仍由专门验收跟踪，不以静态通过替代。

## 审阅发现与处置

1. **P1，未知用量被旧汇总当作零。已修复并复核。** `getJobUsage` 原先把 null 转为 0，管理汇总也 coalesce 为 0；翻译价格未知被合入零估价。现 DTO/汇总增加 `unknownUsageCalls` 与 `unknownCostCalls`，Web/Mobile 总览明确“已知用量”“用量不完整”，管理 API 保留已知部分数值同时返回未知调用计数。翻译结果自身 usage 保留 null/partial/unknown，缓存读取 0 与历史生成分开。
2. **P1，旧 worker 可能错误终结新执行载体。已修复并复核。** preparing 租约失效并恢复后，新 worker 领取；旧 worker 恢复因业务执行令牌过期返回，`queue.processOne` 随后通用 `markDone` 仍可能把新 running carrier 标成 done。翻译 processor 已负责事务终结，队列应跳过通用 markDone；旧 attempt 异常的 fail 分支也需领取身份守卫。现队列跳过翻译的通用 markDone，failure 分支核对 carrier 为 running 且 attempts 与原领取一致。已独立阅读 `pdf-translation-queue.integration.test.ts`，测试同时制造旧 worker 正常返回和抛错，恢复后新 attempt 均保持 running；原作者报告真实本地 PG 1 测试通过，最终全集由集成验收再次执行。
3. **P2，只有 mock completeSimple 的适配测试不足。已补并实际复跑。** 新 `translation-sdk.test.ts` 使用当前安装 pi-ai 的真实 provider/模型解析，mock DNS 与 fetch SSE，不调用供应商。验证 missing、partial、known usage 和网络失败仅一个底层 HTTP 请求。
4. **P2，物理删除遗留执行载体。已修复并独立复核。** `destroyDocument` 在同一事务第一步调用 `deleteDocumentTranslationCarriers`；后者先锁归属文档行，读取该用户/文档的业务任务 jobId，再按 userId、jobId、type=pdf_translate 删除 carrier。此时业务任务尚未被文档级联删除，能取得所有关联载体；随后删除文档级联清理其内容、段落和译文。锁顺序与 dispatch 的文档行锁一致，不会让在途请求写回已删除文档。

## 已检查的设计规则

- 模型 purpose 默认 chat，翻译记录独立绑定；聊天列表、首条默认、更新、删除、默认解析均按 chat 过滤，没有系统或聊天回退。
- 复制在服务端复制加密凭据，公开设置只返回“已保存”标记，无明文；版本轮换建立新记录，任务快照固定版本；清理保留当前绑定与活动任务引用。
- 删除配置与 dispatch 在凭据版本行上通过更新/共享锁互斥；删除撤销所有版本并清空加密材料，已派发请求不能撤回，结果仍需检查文档有效性。
- pdf_translate 的通用用户/admin retry 均拒绝；通用 cancel 走专用事务；dispatched 超时恢复 unknown，不重发；唯一活动 content 与用户/文档幂等约束存在。
- 翻译 SDK 直接单次 completeSimple、无工具循环；fetch guard 阻止 SDK 收费 HTTP 自动重发；原始传输 usage 与缺失部分分别保留，截断不写成功结果。
- 迁移增加用途、nullable token、翻译用量分类和任务类型约束；业务表以文档/user 外键隔离。未发现新增日预算、次数、并发用户配额或固定字符额度。
- 用量日志按任务唯一约束补写，结果内用量为主；失败日志不包含原文或密钥。

## 实际验证

独立运行：

```sh
./apps/server/node_modules/.bin/vitest run --config scripts/pdf-translation-validation/review.config.ts
```

4 文件、**36 测试通过**（adapter、真实 SDK transport、管理聚合、任务展示）。配置明确不加载 server globalSetup，无 PostgreSQL/S3 或真实模型请求。数据库并发与配置生命周期集成由其他 SubAgent 在显式本地 PG 上执行，不能将这里的纯适配测试视为 DB 竞态验证。


## Web 交叉静态审阅补充

按 Web 目录规则与 rab-react skill 检查 Service/组件边界；未修改 Web 实现代码。

- 同文档文件版本变化后迟到响应可污染选区缓存：已交作者增加 documentEpoch 与 fileRevision 双守卫，旧 page 请求也做世代检查。新增两个回归测试已独立复跑。
- 选区浮层缺真实几何锚点：已增加独立 PdfSelectionTranslationAnchor，辅助正文点击关闭时仍可服务显式选区翻译。
- 连续滚动时 currentPage 改变过早收起：已移除无条件 effect，显式键盘/页码导航收起，普通滚动以全部段落矩形离屏判定。
- 设置往返阅读位置：确认 toolbar 以文档 ID 在 sessionStorage 保存并恢复页码；恢复不触发翻译。精度为页，不是页内像素位置。
- 补充反馈：页面虚拟化卸载后 anchors 为空时，popover 原先退回停靠而不收起；作者已增加 hadAnchor 跟踪，原锚点卸载后收起，静态复核通过；真实快滚行为仍由浏览器检查。

独立执行 `pnpm --filter @inwit/web exec vitest run src/pages/docs/pdf-pane/pdf-translation.service.test.ts src/pages/docs/pdf-pane/translation-geometry-logic.test.ts src/platform/boundaries.test.ts`：**3 文件 15 测试通过**。有现有 rabjs sourcemap 与 Node localStorage 警告，不影响通过；这不代替真实浏览器结果。


## 收尾结论

本次基础后端与 Web 交叉静态审阅发现的 P1/P2 均已有修复并复核，当前审阅范围无剩余阻断项。浏览器中曾停留 queued 的现象，经专门验收 Agent 查明是 CSI 标签处于 hidden 导致按设计暂停轮询；恢复 visible 后立即显示结果，此处引用验收者的实际结果，不宣称由本审阅者操作浏览器。

保留产品差异：设置往返恢复到原页码，未恢复页内精确像素滚动偏移。整体浏览器与数据库验收结论以 `pdf-translation-acceptance.md` 为准。

## 收尾索引租约实现记录（本段不是独立审阅）

本报告作者随后接管 `index.service.ts` 实现持久页索引租约，因此该项独立审阅由另一位 backend SubAgent 执行，不能沿用上文独审身份。

`pdf_segment_pages` 的 `indexing`、`updatedAt` 和 UUID 主键组成 120 秒租约；文档行锁内领取，PDF 提取在事务外，竞争读取返回 `indexing`，过期领取替换 UUID。完成时再次锁文档并核对 UUID + indexing 状态，页状态和段落在同一事务写入。迟到的旧成功或旧失败均不能覆盖继任者。下载与 SHA256 可以重叠，只有有效租约拥有者执行段落提取；超时恢复允许重新提取，CAS 阻止旧结果提交。

实际执行：显式 `PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false NODE_ENV=test` 前缀运行 `pnpm --filter @inwit/server exec vitest run src/documents/translation/index.integration.test.ts`，**5/5 通过**。使用独立 `translation_index_*` schema 并在 afterAll 清理；存储和 PDF 引擎为可控 mock，无外部服务请求。测试在真实 PG 上覆盖 8 个竞争读取仅一次提取、旧成功/失败不能覆盖新 UUID 租约、持久孤儿租约恢复、引擎与元数据都失败仍结束租约；这不是跨操作系统进程端到端测试，但仲裁完全依赖 DB，没有进程内 Map。`pnpm --filter @inwit/server typecheck` 通过。

租约独立复核：backend SubAgent 已只读审阅并在显式本地 PG 独立复跑上述 5 测试，全部通过。其结论确认短事务领取/提交、UUID CAS、过期恢复和迟到失败隔离有效。

Web 索引短轮询独立补审：`watchPage/unwatchPage` 按已挂载页维护订阅，hidden/dispose/文档 epoch 变化停止轮询，ready 后停止 GET，不触发模型。发现单次临时 GET 错误会停止 indexing 轮询，已交 backend 修复为最多 3 次指数退避、成功清除旧错误；独立复跑 `pdf-translation.service.test.ts` **10/10 通过**，该问题已关闭。保留既有 rabjs sourcemap / Node localStorage 测试环境警告。
