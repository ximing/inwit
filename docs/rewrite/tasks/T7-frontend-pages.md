# T7 · 前端：任务页 + 主题页 + 设置页

先读 `docs/rewrite/CONTEXT.md`，再完整读 `docs/design/v2/jobs.html`、`docs/design/v2/topics.html`、`docs/design/v2/settings.html`（视觉唯一真相）。T2 已提供 `/api/jobs/queue` 与 `/api/jobs/usage`，T3 已搭骨架。

## 任务 A：任务与用量（`apps/web/src/pages/jobs/`，按 jobs.html）

1. **队列概况**（4 格，/api/jobs/queue 的 counts）：正在进行（金色脉冲）、排队中、今日完成、失败待处理（>0 时红色）
2. **正在进行**：running 任务卡片（图标按 type：消化 BrainCircuit / 对话 MessageCircle / 周报 BookOpen / 进化·主题 Sparkles；summary + description + 已运行秒数 startedElapsedSec 每秒自增 + 第 N 次尝试）；卡片底部 sweep 扫光动画；无 running 时此区不渲染
3. **排队中**：pending 列表（执行时间：runAt ≤ now 显示"立即 · 等前面完成"，未来显示"X月X日 HH:mm · 定时"；summary/description；取消按钮调现有 cancel API）
4. **Token 用量**（/api/jobs/usage）：近 7 天柱状图（CSS 实现，当天高亮 accent 色，其余 dim）+ 右侧按类型分布列表 + 合计
5. **执行历史**（/api/jobs 分页）：表格（类型带图标、内容=summary 去掉类型前缀、状态 tag、时间、耗时、失败行红底 + lastError 详情 + 重试按钮调现有 retry API）；状态/类型筛选 select 保留（现有 admin 有）；分页
6. 本页 5 秒轮询 queue 接口（有 running/pending 时），无活动时停轮询
7. 完成后删除旧 `pages/admin`

## 任务 B：主题页（`apps/web/src/pages/topics/` 换皮，按 topics.html）

- 主题卡片网格：名称、学习目标（无则显示引导文案）、N 张卡 · N 篇文档、掌握度进度条（该主题下卡片的平均掌握：intervalDays≥21 占比，接口没有的话用现有数据能算的近似值，并在任务报告说明）、··· 菜单（归档/取消归档，沿用现有 API）
- ＋ 新建主题虚线卡（复用现有新建对话框逻辑）
- 已归档区折叠在底部（现有逻辑）
- 主题详情页（现有 /topics/:id，知识地图）不在本任务范围，保持可用即可，视觉小问题不阻塞

## 任务 C：设置页（`apps/web/src/pages/settings/` 换皮，按 settings.html）

- 左侧页内导航（外观 / 模型配置），右侧分节
- 外观：三张可视化色卡（浅色/深色/跟随系统，选中态 accent 描边），替换现有按钮组，逻辑不变
- 模型配置：BYOK 表单 + 已保存列表，全部功能不变只换皮（稿子里 .field/.panel 样式）
- 任务与用量相关区块从设置里移除（已独立成 /jobs）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 三页与各自 mockup 视觉一致；任务页数据为真实接口数据，取消/重试/筛选/分页可用
- 旧 pages/admin 已删除，`/admin` 重定向 /jobs 生效
