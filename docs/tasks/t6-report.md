# T6 复习队列（SM-2）+ 抽认卡 API 简报

## 做了什么

在 `apps/server` 落地 SM-2 排期、今日复习队列、三档反馈和近 7 天统计。卡片创建时自动建 `review_states`（`due_at` = 次日）。基础层不依赖 AI。

### SM-2（`src/review/sm2.ts`）

纯函数 `scheduleReview`。三档反馈映射 quality：`forgot→1`、`fuzzy→3`、`remembered→5`。

| 分支 | 行为 |
|---|---|
| quality &lt; 3 | `reps=0`，`intervalDays=1`，`lapses+1` |
| 否则 | interval 按 `1 → 6 → round(prev * ease)` 递推，`reps+1` |
| ease | 标准公式，始终调整，下限 1.3；interval 用**本轮调整前**的 ease |

`pnpm --filter @inwit/server test`（vitest）覆盖映射、1→6→round、lapse 重置、连续 forgot、ease 下限、lapse 后重新起步。9 条全绿。

### 复习 API（全部 `authenticate`）

| 路由 | 行为 |
|---|---|
| `GET /api/review/today` | `due_at <= 今天本地结束`，按 `due_at` 升序。每项 `card`（含 `questions`）+ `reviewState`；`reviewedToday` / `total`（已刷卡数 + 剩余到期） |
| `POST /api/review/:cardId/feedback` | `{feedback: forgot\|fuzzy\|remembered}` → 写 `review_logs`，按 SM-2 更新 `review_states`。`fuzzy` 始终入队 `jobs(type=evolve, payload={cardId, reason:'fuzzy'})`；连续 `forgot` 使 `lapses>=2` 时同样入队（`reason:'forgot'`，对应验收「连续 forgot 两次 → evolve job 入队」和 PRD「反复忘」） |
| `GET /api/review/stats` | 近 7 个本地日历日三档分布 + `overdueCount`（`due_at <= 今天结束` 的积压） |

新卡无 `review_states` 时，feedback 会懒创建再排期。

### 建卡钩子

T5 `write_cards` 在插入 `cards` 后立刻 `insertInitialReviewState`（`due_at = now+1d`，`ON CONFLICT DO NOTHING`）。删卡走 FK cascade。`state-init.ts` 不引用 queue，避免 `tools → review → queue → processors → digest → tools` 循环。

evolve 处理器仍是 stub，记 `evolve.stub` 日志后把 job 标 done。

### 回填

`scripts/backfill-review-states.ts`：给没有 `review_states` 的既有卡片补行，`due_at = created_at + 1d`（已过期的会进今日队列）。

```
pnpm --filter @inwit/server backfill:review-states
```

## 验收输出摘要

`pnpm --filter @inwit/server test`：9 passed。

`pnpm -r typecheck && pnpm -r build` 全绿（dto / server / web）。

`./scripts/smoke-t6.sh` 起 tsx server `:3021` + worker（`WORKER_POLL_MS=200`），注册后 POST「梯度消失」捕捉，**未 mock LLM**：

```
== T6 smoke @ http://127.0.0.1:3021 ==
PASS  unauthenticated today is 401
PASS  register returns user.id
PASS  capture id
PASS  capture status digested
PASS  cards >= 2
PASS  review_states created for cards
PASS  today queue has cards
PASS  today items include reviewState
PASS  today items include questions array
PASS  remembered intervalDays=1
PASS  remembered reps=1
PASS  remembered lapses=0
PASS  remembered lastFeedback
PASS  remembered log written
PASS  review_logs has remembered row
PASS  remembered due_at ~ +1 day
PASS  two forgots intervalDays=1
PASS  two forgots lapses=2
PASS  two forgots reps=0
PASS  two forgots enqueue evolve
PASS  fuzzy enqueues evolve
PASS  evolve jobs listed
PASS  stats remembered=1
PASS  stats forgot=2
PASS  stats fuzzy=1
PASS  stats total=4
PASS  stats overdueCount is a number

passed=27 failed=0
```

实测捕捉 `c4447592-…`（用户 `c537d40b-…`）约 22s 消化完成：2 张卡。新卡 `due_at` 默认次日，smoke 把该用户 `review_states.due_at` 改成 `now()` 后 `GET /api/review/today` 看到 2 项。

| 反馈 | SM-2 结果 |
|---|---|
| card A `remembered` | `intervalDays=1`，`reps=1`，`ease=2.6`，`due_at` ≈ +1 天，`review_logs` 有行 |
| card B `forgot` ×2 | `intervalDays=1`，`reps=0`，`lapses=2`，`ease=1.42`，入队 evolve `reason=forgot` |
| card A `fuzzy` | 第二次成功：`intervalDays=6`，`reps=2`，入队 evolve `reason=fuzzy` |

`GET /api/review/stats`：`last7Days={forgot:2, fuzzy:1, remembered:1, total:4}`，`overdueCount=0`（刷完后都排到明天）。

worker：

```
job.done digest ms=21928
evolve.stub reason=forgot
job.done evolve
evolve.stub reason=fuzzy
job.done evolve
```

回填脚本在 smoke 中跑过一次：`backfilled 2 review_state(s)`（T5 遗留、当时没有 `review_states` 的卡）；本次消化出的 2 张卡已由 `write_cards` 建好状态，时间戳与切卡相差约 10ms。

## 遗留问题

- evolve / weekly_report / thread / chat 处理器仍是 stub（T6 只要求 evolve 记日志）。
- 今日边界用 Node 进程本地时区（`setHours`），没有单独的 `REVIEW_TZ`。
- 新卡默认明天到期，当天 `GET /today` 看不到，需改 `due_at`、等次日，或跑 backfill（旧卡 `created_at+1d` 已过期则会入队）。
