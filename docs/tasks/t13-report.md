# T13 简报 —— tiptap 编辑器 + 文档主页 + 快捷捕捉条

依据：`docs/design-system.md` §5 / §6.1 / §8，`docs/prd.md` §2.6。前置 T11 documents API、T12 tokens。

## 做了什么

产品主界面从聊天时间线改成文档列表。旧捕捉页删除；`/captures` 客户端重定向到 `/`。

### 标题怎么取

选 **文档首行 H1**，没有独立标题输入。保存时 `titleFromContent` 取第一行非空文字，剥掉 ATX `#` 前缀，截 40 字。空纸是「未命名文档」。编辑器新文档默认一个空 H1（placeholder「标题」）+ 段落（「这张纸还是空的，写点什么吧」）。

### PUT /api/documents/:id

`{ title?, contentMd? }`，至少一项。只改标题/正文，不改 source/status，不重跑 digest。`POST /api/documents` 增加可选 `source: editor | paste`（缺省 paste）。列表 `GET /api/documents` 每条带 `cardCount`、`threadTitle`，按 `updated_at DESC`。

### 编辑器 `/editor/new`、`/editor/:id`

`@tiptap/react` + StarterKit + `tiptap-markdown` + Placeholder。纸面按 §5：`--bg-raised`、radius-lg、padding `48px 56px`、max-width 800、衬线 17px/1.8。选中文本浮动条：粗/斜/H1/H2/列表/编号/引用/代码。⌘S 立即保存；输入防抖 2s 自动保存；状态「保存中」/「已保存 HH:mm」。首次保存 POST（`source=editor`）后 `replace` 到 `/editor/:id`。

### 文档主页 `/`

快捷捕捉条（placeholder「扔一句话进来，或以问号结尾问 AI」）：非空时「扔进去」变主按钮。扔进去 → `POST /api/documents` → toast「已收下，消化中」→ 列表乐观插入；问 AI → `POST /api/chat`。下方次按钮「写文档」。线程切换器（全部 / 各线程 / +新建）在快捷条下右侧，交互沿用旧捕捉页。列表是细线分隔条目：衬线标题 + `N 张卡 · 相对时间 · 线程名`；chat 文档多一行回答摘要。pending 标题旁「消化中…」，3s 轮询直到 digested。点击进阅读页 `/doc/:id`（T14 再加锚点；现为纸面 markdown + 编辑按钮）。

## 浏览器实走（`regression@inwit.dev`，亮主题截图）

1. `/` 已是文档列表，不再是时间线。`/captures` → `/`。
2. 「写文档」→ `/editor/new` → 写入「偏差与方差」+ 正文 → 约 2s / ⌘S 显示「已保存 10:49」，URL 变成 `/editor/:id`。回列表可见该条。
3. 快捷条扔「学习率太大时…」→ toast「已收下，消化中」→ 条目乐观插入。消化完成后 **2 张卡**（worker 需是 T11 之后的代码；本机旧 worker 仍报 `missing captureId`，重启后 job 约 30s done）。
4. 暗主题编辑器：纸面 `rgb(42,36,29)`、正文 `rgb(237,230,216)`、radius 14px、padding 48/56、宽 800px。亮暗切换正常。选中文本后浮动条出现（粗/斜/H1/H2/列表/编号/引用/代码）。

截图：`docs/screenshots/t13-home.png`、`docs/screenshots/t13-editor.png`（亮主题）。

## 顺手修的数据问题

T12 说回归账号文档页 500：库是 `SQL_ASCII`，T11 回填用 SQL `left(..., 40)` 按 **字节** 截标题，把 UTF-8 多字节字截断（`invalid byte sequence for encoding "UTF8": 0xe7`）。已把 9 条坏标题按正文重算为合法 UTF-8。列表接口本身没改编码层。

## 验收

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 271 modules |
| `pnpm --filter @inwit/server test` | 4 files / 24 tests 全绿 |
| 新建文档 → markdown → 自动保存 → 回列表 | 过 |
| 快捷条扔一句话 → 消化出卡 → 显示卡数 | 过（2 张卡） |
| 明暗编辑器 | 过 |
| 截图 | t13-home.png / t13-editor.png |

## 改动文件

### dto / server
- `packages/dto/src/document.ts`（`updateDocumentInputSchema`、`documentListItemSchema`、create `source`、title 剥 ATX）
- `apps/server/src/documents/document.service.ts` / `document.routes.ts`
- `apps/server/src/documents/title.test.ts`

### web
- 依赖：`@tiptap/react` `@tiptap/starter-kit` `@tiptap/pm` `@tiptap/core` `@tiptap/extension-placeholder` `@tiptap/extension-bubble-menu` `tiptap-markdown`
- `apps/web/src/pages/home/`、`pages/editor/`、`pages/doc/`
- 删除 `apps/web/src/pages/capture/`
- `App.tsx` / `routes.ts` / `shell/Layout.tsx` / `api/documents.ts` / `lib/format.ts` / `styles.css`
- 线程页、复习页「捕捉页」文案改为「文档页」

## 遗留

- `/doc/:id` 还没有锚点高亮和侧滑卡片（T14）。
- 编辑器首次保存就会入队 digest（短草稿也可能切卡）；后续 PUT 不重消化。
- 库仍是 `SQL_ASCII`。新写入走 Node UTF-8 没问题，不要再用 SQL `left` 截中文。
