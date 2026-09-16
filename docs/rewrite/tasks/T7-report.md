# T7 任务报告

## 掌握度近似

主题列表进度条目标定义是「该主题下卡片 `intervalDays ≥ 21` 的占比」。前端没有按主题列出卡片/`review_states` 的接口（`GET /api/cards/:id` 只读单卡，列表页不能为每个主题拉全量卡片）。

本任务用现有 `GET /api/topics/:id/map/summary` 的 `masteryPct`：挂在该主题知识地图上的卡片里，最近一次复习反馈为 `remembered` 的比例（0–100）。未复习 / forgot / fuzzy 计 0。这与「间隔 ≥ 21 天」不是同一指标，偏「最近一次记住了没」，不是 SM-2 长期掌握。卡片数为 0 时显示 0%。

## 其它

- 任务页数据走 `/api/jobs/queue`、`/api/jobs/usage`、`/api/jobs`（分页 offset）；取消 `/api/jobs/:id/cancel`，重试 `/api/jobs/:id/retry`。
- 有 running/pending 时 5s 轮询 queue；running 卡片的 `startedElapsedSec` 每秒本地 +1，queue 刷新时用服务端值覆盖。
- 旧 `apps/web/src/pages/admin` 已删；`/admin` → `/jobs` 仍由 `App.tsx` 重定向。
