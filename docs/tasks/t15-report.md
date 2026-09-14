# T15 简报 —— 卡片详情页 + 复习页重构 + 全站视觉收尾

依据：`docs/design-system.md` §5 / §6.3 / §6.4 / §7 / §8，`docs/prd.md` §2.6。前置 T11–T14。

## 做了什么

### 卡片详情 `/cards/:id`

新接口 `GET /api/cards/:id`：卡片本体 + 自测题 + `documentTitle` + 复习摘要 `{ dueAt, intervalDays }`。前端 `/cards/:id`：

- 本体：概念（衬线 `--text-lg` 600）/ 例子 / 易混点 / 标签 / 全部自测题（`<details>` 折叠答案）
- 出处条：来自《文档标题》+ 锚点原文（斜体衬线）→ `/doc/:id?anchor=<cardId>`
- 相关卡片：`GET /api/cards/:id/links` 的 outgoing+incoming 按 type 分组（同概念 / 易混淆 / 前置 / 相关），小卡横排可跳转；agent 边显示 reason，可 `DELETE /api/card-links/:id`
- 复习小字：下次复习时间 · 当前间隔

阅读页支持 URL `?anchor=`：滚动到对应高亮、闪一次（`prefers-reduced-motion` 改为描边），并打开抽屉。

### 复习页 §6.4

居中 560px。抽认卡大纸面（`radius-lg` + `shadow-2` + 衬线）。翻面 `rotateY(180deg)` 300ms；`prefers-reduced-motion` 降级为淡入。顶部 2px `--accent` 进度条 +「已刷 n / total」。卡片上方「关联 N 张卡片」打开底部抽屉小列表，不打断刷卡。三档按钮语义色描边，选中淡底。完成态：「今天这些都想过一遍了」。

### 全站收尾

- 后台标题更小（UI 字、`--text-lg` 500），表格去投影、表头透明；导航名仍是「任务与用量」
- 空状态按 §8：文档列表「这张纸还是空的…」、无线程、无配置、复习完成
- hex 仍只出现在 `tokens.css`
- README 补路由表；`docs/dev-log.md` 补 T14 / T15 与 T11–T15 一句话

## 浏览器

`regression@inwit.dev`，CSI 真 Chrome，`http://127.0.0.1:5190`：

1. 文档「梯度消失」→ 点批注黄锚点 → 抽屉 →「查看详情」
2. 卡片详情：概念/例子/易混/标签/填空题「看答案」、出处《梯度消失》斜体引用、相关卡（易混淆/前置/相关 + reason）、下次复习今天 · 间隔 0 天
3. 点相关卡跳到另一张；点出处回 `/doc/:id?anchor=`，锚点 `is-on`、抽屉打开对应卡
4. 复习：顶部细进度条、关联 N 张、纸面翻面后三档（忘了/模糊/想起来了描边）、底部抽屉列出关联卡；刷完 5/5 出现完成态文案
5. 暗主题：复习纸面 `rgb(42,36,29)`、底 `rgb(32,27,22)`、侧栏 `rgb(25,21,18)`；线程 / 设置（新空文案）/ 任务与用量（20px UI 标题、透明表）过一遍

截图：`docs/screenshots/t15-card.png`（亮，卡片详情）、`t15-review.png`（亮，翻面前）、`t15-review-dark.png`（暗，翻面后 + 三档）。

说明：回归账号 T14 那篇没有 agent 边，验收时在三张「梯度消失」卡之间写入了 3 条 origin=agent 的边，并把它们的 `due_at` 拨到今日，才能走相关卡和复习队列。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 276 modules |
| `pnpm --filter @inwit/server test` | 5 files / 33 tests 全绿 |
| hex 除 `tokens.css` 外 | 0 |
| 浏览器全链路（明暗） | 过 |

## 改动文件

### dto / server
- `packages/dto/src/card.ts`（`cardDetailSchema`）
- `apps/server/src/cards/card.service.ts` / `card.routes.ts`（`GET /api/cards/:id`）
- `apps/server/src/documents/title.test.ts`（schema 样例）

### web
- `apps/web/src/api/cards.ts`
- `apps/web/src/pages/card/`
- `apps/web/src/pages/review/`
- `apps/web/src/pages/doc/`（`?anchor=`）
- `apps/web/src/lib/Markdown.tsx` / `card-copy.ts` / `format.ts`
- `apps/web/src/App.tsx` / `routes.ts` / `shell/Layout.tsx`
- `apps/web/src/pages/home/` `threads/` `settings/` `admin/`（空文案 + 后台降级）
- `apps/web/src/styles.css` / `tokens.css`

### docs
- `README.md` 路由表
- `docs/dev-log.md` T14 / T15
- `docs/screenshots/t15-*.png`
- `docs/tasks/t15-report.md`
