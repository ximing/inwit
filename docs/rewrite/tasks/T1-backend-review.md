# T1 · 后端：复习设置持久化 + SM-2 参数化 + 统计扩展

先读 `docs/rewrite/CONTEXT.md`。

## 背景

当前 SM-2 参数全部硬编码在 `apps/server/src/review/sm2.ts`（步长 1→6 天、起始 ease 2.5、MIN_EASE 1.3、quality 映射 forgot=1/fuzzy=3/remembered=5）。`getReviewStats` 只有 last7Days 分布 + overdueCount。复习中心页面（`docs/design/v2/review.html`，先读它）需要：连续复习天数、最长纪录、总卡片、已掌握数、想起率、每日表现分布、未来 7 天到期预报、以及可调的 SM-2 设置。

## 任务

### 1. 复习设置（per-user）

- users 表加 `review_settings` jsonb 列（drizzle migration，允许 NULL = 用默认值）
- `packages/dto` 新增 `ReviewSettings` zod schema，字段与默认值：
  - `dailyReviewLimit` = 20（每日复习上限，5–100）
  - `dailyNewLimit` = 5（每日新卡上限，0–30；新卡 = reps 为 0 的卡）
  - `startingEase` = 2.5（1.3–3.0）
  - `fuzzyScale` = 1.2（1.0–1.5，"模糊"时新间隔 = 旧间隔 × fuzzyScale 而不是按正常 ease 倍增；1.0 表示接近重来）
  - `learningSteps` = [1, 3, 6]（天，1–4 个步长，每个 1–30，升序）
- 路由：`GET /api/review/settings`（无记录返回默认值）、`PUT /api/review/settings`（zod 校验，整体替换）
- 注意：`review-settings` 与已有路由 `/api/review/:cardId/feedback` 不冲突，但注意 Fastify 路径优先级，必要时把 settings 路由注册在 `:cardId` 之前

### 2. SM-2 参数化

- `scheduleReview(state, feedback, now?, settings?)`：settings 缺省用默认值，行为与现状完全一致
- 规则改为：quality < 3（忘了）→ reps=0、lapses+1、interval=learningSteps[0]；quality == 3（模糊）→ reps 不变（不推进阶梯也不重置）、interval = max(1, round(旧 interval × fuzzyScale))；quality == 5（想起来）→ 按 learningSteps 阶梯推进（reps 0→steps[0]、1→steps[1]…），阶梯走完后 interval = round(旧 × ease)
- 新卡初始 ease = settings.startingEase（`state-init.ts` 也要参数化）
- ease 调整公式保持 SM-2 原式，MIN_EASE 保持 1.3
- 更新 `sm2.test.ts`：默认值行为与旧版等价（1→6 阶梯改为默认 [1,3,6] 时 reps0→1、reps1→3、reps2→6、reps3→round(6×ease)）；新增 fuzzy/自定义 steps/自定义 startingEase 用例

### 3. 每日上限生效

- `getReviewToday`：到期卡按 dueAt 排序取前 `dailyReviewLimit`；其中从未复习过（reps=0）的新卡最多混入 `dailyNewLimit` 张（新卡优先插在队列前部，超出部分顺延）
- DTO `ReviewToday` 补充 `truncated: number`（因上限被顺延的卡数），前端用来提示

### 4. 统计扩展 `getReviewStats`

在现有返回基础上扩展（数据源 `reviewLogs` + `reviewStates` + `cards`，注意 join user 维度）：

- `streak: { current: number; longest: number }` — 连续复习天数：今天或昨天有复习记录起算，逐日回溯 reviewLogs 的本地日去重；longest 为历史最长连续
- `totalCards: number` — 用户卡片总数
- `masteredCount: number` — intervalDays >= 21 的卡数
- `retention7d: number` — 近 7 天 remembered / total（0-100 整数，total=0 时返回 null）
- `reviews7d: number` — 近 7 天复习次数
- `daily: Array<{ date: string; forgot: number; fuzzy: number; remembered: number }>` — 近 7 天每天分布（无记录的天补 0，date 格式 YYYY-MM-DD 本地日）
- `forecast: Array<{ date: string; count: number }>` — 未来 7 天（含今天）每天 dueAt 到期的卡数
- 保留现有 `last7Days`、`overdueCount` 字段不破坏旧调用

### 5. DTO 同步

`packages/dto/src/review.ts` 更新 schema，保持 zod 推导类型导出。

## 验收

- `pnpm typecheck` 通过
- `pnpm -F @inwit/server test` 全部通过（含你新增/更新的测试：settings 默认值合并、PUT/GET settings 路由、streak 计算、forecast、daily 分布、上限截断逻辑）
- migration 已生成并执行成功（远程 dev 库）
