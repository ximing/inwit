# T8 管理后台三看板（前端 + 聚合 API）简报

## 做了什么

在 `apps/server` 加认证后的 `/api/admin/*` 聚合接口，在 `apps/web` 把 `/admin` 从占位页换成三个看板。V0 没有独立管理员角色，三个接口都按**当前登录用户**过滤（与 T4 `/api/jobs` 一致）。侧栏「后台」入口 T7 已有，本任务接到真实页面。

### 聚合 API（全部 `authenticate`）

| 路由 | 行为 |
|---|---|
| `GET /api/admin/jobs?status=&type=&page=&limit=` | 任务列表。`page` 从 1 起，内部转 offset 后复用 T4 `listJobs`。返回 `{ items, total, page, limit }` |
| `POST /api/admin/jobs/:id/retry` | 失败任务重试，直接调 T4 `retryJob`（仅 `failed` → `pending`） |
| `GET /api/admin/usage/summary?days=30` | drizzle SQL 聚合 `llm_usage_logs`：按 provider/model/capability 分组、按 UTC 日趋势（缺天补 0）、总成本估算。窗口含当天，最长 365 天 |
| `GET /api/admin/executions?agentType=&status=&page=` | agent 执行列表。join `jobs` / `captures`（`payload.captureId`）/ `users`，带步数、耗时、产出摘要、捕捉预览 |
| `GET /api/admin/executions/:id` | 执行明细，含 `steps[{tool, input_summary, output_summary, duration_ms}]` |

DTO 在 `packages/dto/src/admin.ts`。服务端实现：

- `apps/server/src/admin/admin.routes.ts` / `admin.service.ts`
- `apps/server/src/admin/aggregates.ts`：UTC 窗口、缺天填充、耗时、摘要截断（vitest 覆盖）

用量查询用 `sum` / `count` / `filter (where capability = …)` / `to_char((created_at at time zone 'utc')::date, …)`，不在应用层扫全表再聚合。

### 后台页（`/admin`，三个 tab）

`apps/web/src/pages/admin/`：`bindServices` + `AdminService`。

| Tab | 内容 |
|---|---|
| **任务队列** | 表：类型 / 状态 / 尝试次数 / 创建时间 / 耗时 / 错误。状态与类型筛选。`failed` 行可点重试 |
| **Token 用量** | 汇总卡（总 tokens、chat / embed / rerank、成本估算）+ 手写 SVG 折线（不引图表库）+ 按模型分组表。窗口 7 / 30 / 90 天 |
| **Agent 执行** | 列表：agent 类型 / 状态 / 步数 / 耗时 / 产出摘要。点开行拉取明细，展开 steps 时间线（tool、入参摘要、结果摘要、耗时） |

分页 `上一页 / 下一页`。空态与筛选失败列表有中文提示。

## 启动方式

```bash
pnpm --filter @inwit/server dev    # :3020
pnpm --filter @inwit/web dev       # :5190，/api → 3020
```

浏览器打开 http://localhost:5190/admin （需登录）。

接口自检（对已有 digest 数据的用户做 Fastify inject，不必另起端口）：

```bash
./scripts/smoke-t8.sh
```

## 验收输出摘要

`pnpm -r typecheck && pnpm -r build` 全绿（dto / server / web；web vite 113 modules）。

`pnpm --filter @inwit/server test`：16 条全绿（含 T8 aggregates：缺天填充、耗时、摘要截断）。

`./scripts/smoke-t8.sh` 用已有用户 `t7-1789321664@inwit.local`（T7 消化留下的 jobs / usage / executions）：

```
PASS  found user t7-1789321664@inwit.local
PASS  GET /api/admin/jobs without cookie is 401
PASS  jobs total=2 items=2
PASS  usage tokens=10609 models=2 days=30 cost=0
PASS  executions total=1 items=1
PASS  execution 719724d3-7e15-4d4f-acd5-48380a0ca1c7 steps=5 summary=cards=2 questions=4
```

| 看板 | 真实数据 |
|---|---|
| 任务队列 | digest `done` 34.1s + evolve stub `done` 453ms |
| Token 用量 | 总 10.6k；chat 10.3k（qwen-plus ×5）；embed 296（qwen3-vl-embedding ×3）；该用户无 rerank；成本估算 $0（历史 `cost_estimate` 即为 0） |
| Agent 执行 | digest / done / 5 步 / 18.4s / `cards=2 questions=4`。下钻 steps：`read_capture` → `search_user_memories` → `write_cards` → `write_questions` ×2 |

浏览器实走 `/admin`：侧栏「后台」高亮；三 tab 切真实数据；失败筛选得到「没有任务。」；点开执行行能看到逐步 tool 时间线；回捕捉页同一登录态仍显示已消化的梯度下降卡片。桌面 + 390px 窄屏都看过，窄屏表格横向滚动、表头不再逐字折行。

验收期间临时拉起的 server / web 已停止，避免占用 3020 / 5190。

## 遗留

- 没有 admin 角色，看板只看当前用户，不能跨用户。PRD「按用户聚合」要等有角色后再把 `userId` 过滤拿掉。
- 日趋势按 **UTC** 日历日，不是浏览器本地时区。
- 历史用量行的 `cost_estimate` 多为 0（pi-ai `usage.cost.total` 当时没填到 DashScope 价），卡片会显示 `$0`；新调用若写入非 0 会进汇总。
- 取消任务仍走 T4 `POST /api/jobs/:id/cancel`，后台页未做取消按钮（任务只要求 failed 可重试）。
