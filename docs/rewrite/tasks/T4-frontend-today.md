# T4 · 前端：Today 首页

先读 `docs/rewrite/CONTEXT.md`，再完整读 `docs/design/v2/today.html`（结构+文案的唯一真相）和 `docs/design/v2/inwit.css`。T3 已搭好 rail 骨架、路由 `/`、设计 tokens。

## 背景

首页是"行动发起页"：问候 + 捕获 + 今日该做什么（复习/周报）+ 概览统计 + 系统动态 + 最近文档。现有 `pages/home`（捕获逻辑、周报横幅、topic 建议、文档流）的 **service 逻辑尽量复用**（capture 提交、问 AI、topic 列表、文档列表、weekly report、错误/toast），但视觉与布局全部按 today.html 重写。旧 `pages/home` 在本任务完成后删除。

## 任务（`apps/web/src/pages/today/`）

按稿子自上而下：

1. **问候区**：本地日期（如 `9月14日 星期日`）+ 时段问候（上午好/下午好/晚上好 + 句号）
2. **捕获 hero**：大捕获框（稿子里的 .capture.hero-capture），复用现有 capture 逻辑：主题选择器（沿用现有 topic 下拉/默认逻辑）、扔进去、问 AI（问号结尾高亮）、⌘⏎ 快捷键、错误 banner、成功 toast。digest 中的 pending 文档在列表里显示"消化中"脉冲（现有逻辑有，保留）
3. **行动卡片**（两列）：
   - 复习卡：`GET /api/review/today` 取待复习数 + `GET /api/review/stats` 取 streak.current → 🔥 连续复习 N 天、X 张待复习、"开始复习 →"（链 `/review`）。待复习为 0 时文案变为"今天刷完了"+ 显示 streak，链接仍指 /review
   - 周报卡：有 weeklyReport 时显示（成功率/标题来自现有数据结构），"去看看 →" 链 `/docs?doc=<id>`；没有周报时此卡不渲染，复习卡独占一行
4. **统计条**（三列）：总卡片、本周新卡（cards 表近 7 天——如果后端没有现成接口，用 `/api/review/stats` 的 totalCards + 文档列表接口能拿到的数据凑；缺接口就在任务报告里说明，先显示 totalCards / 文档总数 / 主题数，别造假数据）、文档数
5. **最近动态**：调 `GET /api/jobs?limit=5`（T2 后带 summary/description；T2 未完成就用 type+时间 自行拼文案），显示图标（lucide：BrainCircuit/BookOpen/Sparkles/MessageCircle）+ summary + 相对时间。右侧"全部任务 →"链 `/jobs`
6. **最近文档**：取文档列表前 4 条紧凑行（标题 + topic tag + N卡 + 相对时间），点击 → `/docs?doc=<id>`。右侧"全部文档 →"链 `/docs`
7. 新建主题对话框：现有 home 有完整实现（dialog + 表单 + 错误处理），搬过来，触发入口是捕获框的主题选择器里的"新建主题"

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 页面与 today.html 视觉一致（自行对比稿子）
- 捕获、问 AI、新建主题真实可用（对接现有 API，不 mock）
- 旧 `pages/home` 已删除且无残留引用
