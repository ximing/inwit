# T26 完成报告：agent 批注工具 + 周报纳入批注 + annotation_resurface 周期 job + 今日页 banner

完成日期：2026-09-17。任务书：docs/tasks/t26.md。前置：T25（docs/tasks/t25-report.md）。

## 交付内容

### 目标 1：agent 只读批注工具

- 新文件 `agent/annotation-tools.ts`（照 analyze-tools 模板，TypeBox + toolResult + 全部查询带 userId）：
  - `readDocumentAnnotationsTool(session)`：读当前文档批注（kind/blockIndex/pageIndex/quote 截断 200/note 截断 300，按创建时间排序，上限 20），payload 带 hint「有批注的块优先切卡，note 里的疑问写进 confusion_point」；session 只需 `{ userId, documentId: string | null }`，digest（DigestSession）与 evolve（EvolveSession，卡片无文档时返回空 + hint）共用。
  - `searchAnnotationsTool(session)`：`{ query }` 走 T25 的 `searchAnnotations` 混合召回 + `loadAnnotationsByIds` 回填（search.service.ts 导出该方法复用），hint 要求引用时点明出处。
- 注册：`digestTools` / `chatTools`（tools.ts）、`evolveTools`（evolve-tools.ts）各追加。weekly 按设计不给 LLM 工具，走 read_week_stats。
- prompts.ts：DIGEST 加第 2 步（后续步骤重新编号）；CHAT 第 1 步补 search_annotations 与「你在《X》里批注过…」措辞；EVOLVE 共用步骤补「照顾批注暴露的困惑点」。

### 目标 2：周报纳入批注

- `weekly-logic.ts`：`WeekAnnotationItem` + `WeekStats.annotations/annotationCount`；`dataSummaryMarkdown` 加「新批注 N 条」；`annotationsMarkdown`（只列有 note 的批注）+ `annotationDeepLink`（`/docs?doc=<id>&annotation=<id>`）+ `ensureAnnotationLinks` 并接入 `ensureWeeklyReportBody`；`WEEKLY_ANNOTATION_LIMIT = 10`。
- `weekly-tools.ts queryWeekStats`：本周批注 count + top10（join documents 取标题，quote clip 80 / note clip 120）；memory content 透传 `annotationCount`（DTO 未改）；read_week_stats 描述同步。
- `WEEKLY_SYSTEM_PROMPT`：步骤 1 补批注列表说明，步骤 2 加可选「批注回顾」小节与链接格式要求。

### 目标 3：annotation_resurface 周期 job（确定性，零 LLM）

- DTO：`JOB_TYPES` 加 `'annotation_resurface'`；payload `{ date: YYYY-MM-DD }` + 解析函数；新文件 `packages/dto/src/annotation-resurface.ts`（key 前缀、14 天阈值、每日 ≤3 条、content/status/item/response schema、accept 输入输出）。
- `annotations/resurface-logic.ts`（纯逻辑）：`pickResurfaceAnnotations`（>14 天、有 note、未转卡、**历史上没被建议过的**——防隔天重复打扰，最旧优先）、`isConvertedLoose`（存量兜底：同文档 imageKey 相等，或 anchorBlockIndex+quote 逐字相等）、key 归一化、content 解析、终态判定。
- `annotations/resurface.ts`：`maybeEnqueue/scanAndEnqueue`（按 (userId, date) 去重，模板照 weekly-enqueue）、`processAnnotationResurface`（挑批注写 memories：scope=user/layer=profile/key=`annotation_resurface_<date>`，唯一索引防并发）、`getAnnotationResurface`（惰性剔除已转卡/已删条目，空则转终态：有 acceptedCardIds → accepted，否则 dismissed）、`dismiss`（幂等）、`accept`（server 直转：事务内建卡 + insertInitialReviewState + 回写 convertedCardId + memory 标记，事务外 tryIndexCard）。
- 接线：processors HANDLERS、job-view GENERIC（「批注回顾 · 今天」）、worker（并入 hourly 扫描 tick，`INWIT_SKIP_RESURFACE_SCAN` 可关）、annotation.routes 三端点（GET / dismiss / accept）、web+mobile jobs.service 的 JOB_TYPES/JOB_TYPE_LABELS（批注回顾）、四处 JOB_ICONS 图标（StickyNote）。
- migration `0021_sudden_ogun.sql`：jobs_type_check 重建含 annotation_resurface（已应用）。
- errors.ts 注册三个新错误码（RESURFACE_NOT_FOUND / RESURFACE_NOT_PENDING / ANNOTATION_ALREADY_CONVERTED）。

### 目标 4：今日页 banner

- api/annotations.ts 加 get/dismiss/accept 三函数；TodayService 加 `resurface` 字段（load() 与 suggestions 并行拉取）+ acceptResurface（toast「已转成卡片，进入复习队列」）/ dismissResurface。
- today/index.tsx：复用 .banner 结构与样式，📝 图标，文案「你有 N 条两周前的批注还没消化成卡片，比如《X》里的那条」，「转成卡片」（逐条接受，响应携带刷新后的 resurface）/「忽略」，与开主题 banner 堆叠共存。

## 验收记录

- `pnpm --filter @inwit/server test`：**352 passed (39 files)**——新增 resurface-logic 6 例（挑选阈值/宽松匹配/去重/≤3 条/key 归一化/终态）、weekly 批注段 3 例、cardInputFromAnnotation 5 例（T25）；typecheck 全仓 exit 0；`pnpm -r build` 除 apps/desktop 外全绿（desktop 失败为 crates 镜像网络问题，与本任务无关）。
- migration 0021 已应用，约束含 annotation_resurface。
- 真实链路（dev server :3020 + worker + 百炼，冒烟用户用后已删）：
  - **digest**：带批注文档消化，三次执行（含一次重试）均在 read_document 后调用 `read_document_annotations`，产出 3 张卡。
  - **chat**：问「我是不是批注过 sigmoid 导数的事」，agent 首调 `search_annotations`，回答逐字引用批注并点明旁注内容。
  - **周报**：POST /api/reports/weekly/generate → 复盘文档含「批注回顾」小节与 `[批注](/docs?doc=<id>&annotation=<id>)` 真实链接（`ensureAnnotationLinks` 保底路径由单测覆盖）。
  - **resurface**：批注 createdAt 改到 15 天前 → 入队 → worker 处理 → GET /api/annotation-resurface 返回建议 → accept 一键转卡成功（concept 取 note 首行）→ hasConvertedCard=true、再拉取为 null、同日再入队被去重（created=false）。

## 偏差与说明

- accept 的「全部接受完 → status=accepted」有两条路径：accept 内即时判定（acceptedCardIds 覆盖 annotationIds）+ get() 惰性终态（外部转卡导致的清空），语义一致。
- resurface 建议「每条批注一生只建议一次」（suggestedIds 跨 memory 去重），是有意的克制：被忽略后不再打扰。
- chat agent 在批注相关问题上会先调 search_annotations 而非 search_cards，属 prompt 允许范围内的自主决策，未强制顺序。
- LLM 写的周报「数据小结」用自有格式时不含「新批注 N 条」（该行在确定性兜底摘要里，由单测覆盖）；批注链接经 prompt + ensure 双保险，实测必现。
