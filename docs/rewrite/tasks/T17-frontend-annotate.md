# T17 · 前端：批注/写卡交互 + 编辑器视觉打磨

先读 `docs/rewrite/CONTEXT.md`。T16 已提供后端：批注 CRUD（`GET /api/documents/:id/annotations`、`POST/PATCH/DELETE /api/annotations`）、手动写卡 `POST /api/cards{documentId,concept,example,anchorText?}`、选段 AI 写卡 `POST /api/documents/:id/selection-cards{text}`（返回已入队，卡片稍后出现在卡片栏）。

## 任务 1：选中文字浮动工具条扩展（`pages/docs/index.tsx` 的 ReadSelectionToolbar，及编辑态）

阅读态和**编辑态**（tiptap 里选中也要有）的浮动胶囊工具条，从只有「复制」扩为四个动作（深色胶囊视觉沿用 T13 的 float-toolbar）：

1. **复制** — 现状保留
2. **划线批注**（lucide `Highlighter`）— 点击弹出小卡片（深色/纸面浮层，克制）：显示选中文本（截断两行）+ textarea「我的想法…」+ 保存按钮。保存调 POST /api/annotations。正文立即出现**批注划线**（见任务 3 的视觉区分）
3. **写卡片**（lucide `SquarePlus`/`Layers`）— 弹出小编辑框：问题（concept）输入 + 答案（example）textarea（预填充选中文字）+ 保存 → POST /api/cards（anchorText=选中文字）。成功后 toast 式轻提示「已加入复习队列」，右侧卡片栏出现新卡
4. **AI 写卡**（lucide `Sparkles`）— 一键调 selection-cards，按钮变「消化中…」短暂态；完成后卡片自动出现（轮询文档卡片 5-10s，复用 digest 轮询的模式）

弹层交互：点外部/Esc 关闭；保存后关闭。文案克制中文。

## 任务 2：右侧卡片栏加「批注」区

- 卡片栏分两段：**批注**（用户手动划线，显示 quote 截断 + note，点击 → 正文对应批注高亮；hover 出现编辑 note / 删除小图标）、**本文卡片**（现有，含手动写的卡——manual 卡可加一个低调「手写」tag）
- 联动：点批注划线 ⇄ 批注条目双向高亮（复用现有 anchor 联动模式）

## 任务 3：批注划线的渲染（阅读态 + 编辑态）

- 批注划线与卡片划线**视觉区分**：卡片划线保持暖黄底；批注用 accent（朱红）细下划线 + 淡底色，hover 显示 note 摘要 tooltip
- 阅读态：扩展现有 anchors 管线（`lib/anchors.ts`/`Markdown.tsx`），把 annotations 的 quote 一并 wrap
- 编辑态：扩展 T15 的 tiptap Decoration 插件，同样高亮批注 quote

## 任务 4：编辑器视觉打磨（用户原话"编辑器页面还是难看"）

现在是默认编辑态，编辑体验就是主体验，按设计体系精修：

- 标题输入框：无边框宋体大字（与阅读态标题同字号字重），placeholder「无标题」弱色
- 正文 ProseMirror：与阅读态同一套 prose 排版（字号/行高/段落间距/字距完全一致），placeholder「开始写，或者从左边扔进来…」
- 纸张容器：与阅读态一致的纸卡片（圆角、padding、阴影），编辑时顶部一条极细的 accent 边或左侧 2px 标识暗示"编辑中"
- BubbleMenu 选中浮条保持 T13 的深色胶囊
- 焦点态：容器 outline 用 accent 15% 柔光，无生硬实边框
- 深色模式同步检查

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 全流程自测（worker 若没在跑，AI 写卡只验证入队与按钮态）：选中 → 批注（带想法）→ 批注出现在右栏、正文有朱红下划线；选中 → 写卡片 → 卡片栏出现「手写」卡；选中 → AI 写卡 → 按钮消化中态
- 阅读/编辑两态划线都可见；窄屏浮层里批注区也在
- 浅色/深色目检
- 不启动/停止 dev server / worker
