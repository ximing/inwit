# T23 简报 —— 周报复盘 + 前端展示收尾

依据：`docs/prd.md` §2.4（周报复盘），`docs/design-system.md` §6.5（提示条）§8（文案）。前置 T21/T22。pi-agent 规范照旧：所有智能行为都是 `Agent` + `AgentTool`，真实 LLM，不 mock。

## 做了什么

### 周报 job（`jobs type=weekly_report`）

| 触发 | 规则 |
|---|---|
| 自动 | worker 启动时 + 每小时扫 `users`。本周（周一起）没有 pending/running/done 的周报 job，且本周有复习 / 新卡 / 新边，则入队（`run_at` 立即）。空闲账号不写空复盘。 |
| 手动 | `POST /api/reports/weekly/generate`。已有 pending/running 则返回现有 job（200），否则立即入队（201）。 |

payload：`{ weekStart: 'YYYY-MM-DD' }`，用来按周去重。

处理器（pi Agent，`src/agent/weekly.ts`）工具：

| 工具 | 作用 |
|---|---|
| `read_week_stats` | SQL 聚合，不耗 token：三档分布与成功率、复习总次数、新卡片、新建关联边、各主题地图覆盖率、lapses 最多的 3 个概念 |
| `write_document` | 一篇 `documents(source=agent, status=digested)`，标题强制「M/D–M/D 学习复盘」。缺三档数字或卡片链接时服务端补上 |
| `write_memory` | `scope=user, layer=mastery, key=weekly_report:<weekStart>`，摘要给首页提示条用 |

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/reports/weekly/generate` | 手动入队本周周报 |
| GET | `/api/reports/latest` | 本周已生成的复盘；没有则 `{ report: null }` |

### 前端

- 首页 `--anchor` 淡底提示条：「📖 本周复盘已生成：成功率 78%，有 3 个概念在偷偷遗忘。」[去看看] → 复盘文档。无建议重学时改成「这周学得很稳。」
- 文档列表 / 阅读页：`source=agent` 且标题含「学习复盘」标「AI 复盘」（对比专题仍标「对比专题」）
- 复盘正文里的 `[概念](/cards/:id)` 走 SPA 跳转
- 复习完成态加小字「本周复盘 →」（当日刷完且本周已有复盘）
- 卡片详情「由原卡拆小」reason 原本就可见，无新 UI

`INWIT_SKIP_WEEKLY_SCAN=1` 可关掉 worker 的整表扫描（手动 generate 仍可用），避免冒烟时给所有活跃用户排队。

## 真实 LLM 验收

`scripts/smoke-t23.sh` 自启 :3032 + worker（先跳过扫描），账号 `t23-smoke-1789378998@inwit.local`。**22/22 PASS**。

消化「偏差与方差」「过拟合与欠拟合」→ 4 卡。forgot×3 + fuzzy + remembered。

| 步骤 | 结果 |
|---|---|
| POST `/api/reports/weekly/generate` | job `weekly_report`，`weekStart=2026-09-14` |
| 再 POST | 返回同一 in-flight job |
| job `done` | 文档《9/14–9/20 学习复盘》`source=agent`；正文含想起来了/模糊/忘了 + 3 条 `/cards/:id` 链接 |
| GET `/api/reports/latest` | `successRate=20`，`relearnCount=3`，指向该文档 |
| memories | `key=weekly_report:2026-09-14`，带 `documentId` + summary |
| 删掉本周 job 后重启 worker | 自动补建 `weekly_report` |

`agent_executions` 工具链：`read_week_stats > write_document > write_memory`。`result_summary`：`type=weekly_report document=1 memory=1 relearn=3 reviews=5`。

### 浏览器（明暗）

CSI 真 Chrome，`http://127.0.0.1:5190`。首页黄底提示条 + 文档列表「AI 复盘」；点「去看看」进阅读页，标题旁「AI 复盘」徽标，正文有数据小结和点评。暗色切换后提示条仍在。截图：`docs/screenshots/t23-report.png`。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 284 modules |
| `pnpm --filter @inwit/server test` | 12 files / 96 tests 全绿 |
| `scripts/smoke-t23.sh` | 22/22 PASS |
| 首页提示条明暗 + 跳转复盘文档 | 过 |

## 改动文件

### dto
- `packages/dto/src/{job,document,report,index}.ts`（周报 payload、latest schema、提示条文案、agent 文档徽标）

### server
- `apps/server/src/agent/{weekly,weekly-tools,weekly-logic,weekly-enqueue,weekly.routes,prompts}.ts`
- `apps/server/src/jobs/processors.ts`、`apps/server/src/worker.ts`、`apps/server/src/app.ts`
- `apps/server/src/agent/weekly-logic.test.ts`、`apps/server/src/documents/title.test.ts`

### web / 脚本 / 文档
- `apps/web/src/{api/reports,components/doc-row,pages/home/*,pages/review/*,pages/doc,lib/Markdown,styles}.css`
- `scripts/smoke-t23.sh`
- `docs/tasks/t23-report.md`、`docs/dev-log.md`、`README.md`、`docs/screenshots/t23-report.png`
