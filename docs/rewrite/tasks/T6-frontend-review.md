# T6 · 前端：复习中心（/review）

先读 `docs/rewrite/CONTEXT.md`，再完整读 `docs/design/v2/review.html`（结构+文案唯一真相）和 `docs/design/v2/inwit.css`。T1 已提供 `/api/review/settings`（GET/PUT）与扩展版 `/api/review/stats`（streak/totalCards/masteredCount/retention7d/reviews7d/daily/forecast）。

## 背景

旧复习页一进来就是翻卡，且翻面动画是坏的（卡片旋转角度错乱、答案不可见），评分按钮脱离卡片。新版 = **Hub（统计 + 设置）→ 开始复习 → Session（翻卡打分）** 同页两态切换。旧 `pages/review` 完成后删除重写。

## 任务（`apps/web/src/pages/review/`）

### Hub 态

1. **streak hero**（.streak-hero）：🔥 + 连续复习 N 天（streak.current）+ 最长纪录（streak.longest）+ 右侧今日待复习 X 张 · 约 Y 分钟（Y = X × 25 秒估算，向上取整分钟）+ "开始复习"主按钮。streak.current 为 0 时文案改"今天开始第一天"
2. **统计四格**：总卡片、已掌握（间隔≥21天，masteredCount）、近7天想起率（retention7d，null 显示 —）、近7天复习次数（reviews7d）
3. **近 7 天表现**（堆叠条，stats.daily）：每天 forgot/fuzzy/remembered 三段堆叠 + 图例；高度按当天总量归一
4. **未来 7 天到期**（forecast 条形，stats.forecast）：含今天，数字标在条上
5. **复习设置**（可展开面板，GET/PUT /api/review/settings）：
   - 每日复习上限（滑杆 5–100）、每日新卡上限（0–30）、起始 ease（1.3–3.0，步进 0.1）、"模糊"的后果 fuzzyScale（1.0–1.5，步进 0.1，显示"间隔 ×N"）
   - 学习步长：1/3/6/10 天四个可点选 chip（至少选 1 个，升序存储）
   - 保存（PUT）+ 恢复默认（PUT 默认值）；"改动只影响之后的调度"提示文案
   - 表单状态用本地 state，保存成功 toast

### Session 态

- chrome：← 返回（回 Hub）、今日复习标题、进度 x/y、进度条、卡片来源面包屑（主题 · 地图路径，现有逻辑有）
- **修复翻面**：按稿子实现干净的 3D 翻转（.flip-card/.flip-face，backface-visibility，0.55s ease；旧实现的 transform 角度 bug 不要带过来）
- 翻面后评分按钮才浮现（.grade-row 动画）：忘了（明天再见）/ 模糊（间隔 ×fuzzyScale，读设置显示）/ 想起来了（间隔 ×ease）
- 键盘：空格翻面、1/2/3 打分；打分后自动下一张并重置为未翻面
- 全部刷完：显示完成态（🎉 今天刷完了 + 明天到期数 + 返回 Hub）
- 评分提交复用现有 `POST /api/review/:cardId/feedback`；队列逻辑（忘了的卡当天插回队尾，如现有逻辑有则保留）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- Hub 各统计与接口数据一致；设置保存后刷新仍在；SM-2 新参数在打分后下一次调度生效（dueAt 变化符合预期）
- 翻面动画正确（正反面都清晰、无角度错乱）；键盘全流程可操作
- 旧 pages/review 已删除
