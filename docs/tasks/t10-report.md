# T10 AI 回答 Markdown 渲染简报

## 做了什么

捕捉页问答气泡原先用 `<pre>` 原样吐 `captures.answer`，`###` / `**粗体**` / `---` 直接露在页面上，长回答把时间线撑得很长。

### 渲染

- `apps/web` 增加 `marked@^18` + `dompurify@^3`。
- `apps/web/src/lib/Markdown.tsx`：`Marked` 实例开 GFM + `breaks`，同步 `parse` / `parseInline` 后走 DOMPurify（`USE_PROFILES.html`，禁 `style` / `form` / 表单控件 / 内联 `style`）。
- AI 气泡改用该组件，不再走 `<pre class="msg-body">`。用户问题仍是纯文本。

### 长回答折叠

- 超过 300 个 Unicode 字符默认折叠：`.md-clip.is-folded` 限高 11.5rem + 底部渐隐，按钮「展开全文」/「收起」。
- 展开状态记在 `CaptureService.expandedAnswers`。

### 卡片展开

- 捕捉页卡片的 concept（inline）、例子、易混点同样走 markdown 渲染（含聊天时间线里点「展开」后的正文）。

### 样式

加在现有 `apps/web/src/styles.css`：标题层级、加粗、列表、代码块、分隔线、引用、表格；字号压在气泡现有 0.95rem 一带，不另开主题。

## 启动方式

```bash
pnpm --filter @inwit/server dev     # :3020
pnpm --filter @inwit/web dev        # :5190，/api → 3020
```

浏览器打开 http://localhost:5190 ，用已有账号登录即可看历史问答气泡。不必起 worker（不新问就不消化）。

## 验收输出摘要

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | 全绿（dto / server / web） |
| `pnpm -r build` | 全绿（web vite 116 modules；css 15.71 kB） |

浏览器 http://localhost:5190（`regression@inwit.dev`）：

- 登录后主页 AI 气泡：`###` 渲成标题，`**L1 与 L2 正则化区别**` 渲成加粗，`---` 为分隔线；页面 `innerText` 不再出现 `###` / `**…**`。
- 该条回答默认折叠，可见「展开全文」；点开后出现标题 / 表格 / 列表 / 加粗，按钮变「收起」，再点收回。
- 聊天卡点「展开」后，例子 / 易混点走 markdown（当前样本是段落，无语法记号，按 `<p>` 输出）。
- 桌面 + 390px 窄屏都看过：折叠气泡高度约 239px，不再整页刷长文。
- `/review` 仍正常（该用户今日 2/2 已刷完）。

验收期间占用的 3020 / 5190 已停掉。

## 遗留

- 复习闪卡正反面仍是纯文本（本任务只覆盖捕捉页）。
- 折叠按字数阈值 + CSS 限高，不按「刚好 300 字」裁 markdown 源，避免截断半截 `**` / 代码围栏。
