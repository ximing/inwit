# 主题页改版 + ReaderOverlay 设计规格

> 本文件是实现的唯一依据。视觉参照同目录 `topics-reader-overlay.html`（静态示意图，含 A–E 五个画面标注）。

## 背景

主题页 `apps/web/src/pages/topics/`（index.tsx / detail.tsx / topics.service.ts）现状：

- 主栏被 `.pane-inner`（styles.css，max-width 800px 居中）限宽，宽屏浪费严重
- 「图谱」tab 是通栏树形列表（MapTab/MapBranch/ChapterRow/ConceptRow in detail.tsx）
- 「文档」tab 的 TopicDocRow、「动态」tab 的 DocRow（`apps/web/src/components/doc-row.tsx`）、NodeDrawer 里的卡片/资料链接，全部是 `<Link>` 跳去 `/docs` 页，打断心流
- 数据库已有 `card_links` 表（type: same_concept/confusable/prerequisite/related，origin: agent/user），服务端 `GET /api/cards/:id/links` 与 web 端 `getCardLinks`（apps/web/src/api/cards.ts）都已存在，前端无人消费

## 目标

主题页内闭环所有高频浏览操作：看文档、看卡片、按关联脉络逛卡片，**不跳路由**。

## 核心组件：ReaderOverlay（唯一弹层，两种模式）

新建目录 `apps/web/src/components/reader/`（全局共享，不绑页面）：

- `ReaderOverlay.tsx` — 大半屏 modal（遮罩 + Esc 关闭），布局：顶栏（标题/meta/badge/「打开完整页面 ↗」/✕）+ 左正文 + 右栏（300px）
- `reader.service.ts` — `ReaderService extends Service`（@rabjs/react），状态与方法见下
- `mini-card.tsx` — 从 `apps/web/src/pages/docs/card-rail.tsx` 抽取的纯展示 mini 卡（ClozeText、掌握度圆点、mini-foot），props 化（card、open、active、onClick）；`card-rail.tsx` 改为消费它，行为不变

### ReaderService 状态/方法

- `doc: DocumentDetail | null`、`loading`、`error`
- `activeCardId: string | null`（null = 文档模式/右栏列表态；非 null = 卡片模式/右栏详情态）
- `focusCardId: string | null`（一次性定位锚点用，传给 AnchoredMarkdown 后清掉）
- `links: CardLinksResponse | null`（当前 activeCard 的脉络，懒加载并缓存）
- `openDoc(docId)` — getDocument 加载，activeCardId=null，正文滚到顶，显示 AI 摘要盒
- `openCard(cardId, docId)` — 加载文档后 activeCardId=cardId、focusCardId=cardId（正文滚动+闪烁锚点，右栏切详情态），并加载 getCardLinks
- `openLinkedCard(cardId)` — 脉络里点关联卡：若该卡在当前文档（按 doc.cards 找）则原地切换；否则用其 documentId 重新 openCard。维护一个简单的 back 栈，`backToList()` 回右栏列表态
- `close()` — 清空全部状态

### ReaderOverlay 两种模式

**文档模式**（openDoc）：

- 正文顶部 AI 摘要盒：`doc.source === 'chat' && doc.answer` → 渲染 answer（`<Markdown/>`）；否则 `doc.description` 非空 → 摘要盒；都没有则不显示
- 正文用现有 `AnchoredMarkdown`（`apps/web/src/lib/Markdown.tsx`）+ `docAnchors(doc.cards, [])`（`apps/web/src/lib/anchors.ts`），`className="md-body prose"`
- 右栏列表态：本文卡片 mini 卡列表（复用 mini-card.tsx）；点 mini 卡 → `openCard` 同文档切换
- v1 不渲染批注区

**卡片模式**（openCard / 右栏详情态）：

- 正文：同一 AnchoredMarkdown，进入时滚动到该卡锚点段落并闪烁（复刻 docs/index.tsx 里 bodyFocusCardId 的效果：scrollIntoView + `is-flash` class 1.1s）
- 右栏详情态：顶部「← 卡片列表」返回；完整问答（card.questions[0]，fallback concept/example）、掌握度圆点（复用 masteryLevel/formatNextReview 逻辑）、tags；下方「脉络」区按关系分组渲染 links（⚡易混淆 confusable / ↳前置 prerequisite / ∿相关 related / ＝同概念 same_concept），显示 link.reason 与 origin==='agent' 标注；关联卡点击 → openLinkedCard
- 底部「去复习」按钮 → `<Link to={ROUTES.review}>`

**两模式共通**：

- 顶栏「打开完整页面 ↗」→ `docAnchorPath(docId, activeCardId)` 或 `docPath(docId)`（`apps/web/src/routes.ts`），这是唯一跳路由出口
- PDF 文档（`doc.fileMime === 'application/pdf'`）**不进弹层**：所有入口先判断，PDF 直接 `navigate(docPath(id))`
- 锚点滚动+闪烁逻辑从 docs/index.tsx 抽成共享工具（如 `apps/web/src/lib/anchor-scroll.ts` 的 `scrollFlashCardAnchor(root, cardId)`），docs 页与弹层共用

## 主题页改造（pages/topics/）

1. **布局收紧**（index.tsx + styles.css）
   - `.ws-topics .pane-inner` max-width 放宽到 1160px（只影响主题页）
   - 头部：标题与 goal 同一行；statbar 从卡片降为一行 meta，追加「地图覆盖 x/y」chip，点击切到图谱 tab
   - 工具行：tabs（带计数）与搜索框同一行，搜索框靠右
2. **文档 tab**：文档列表改自适应栅格卡片（`grid-template-columns: repeat(auto-fill, minmax(340px, 1fr))`），保留标题/badge/摘要两行截断/meta/挂在信息；点击 → `reader.openDoc(id)`（PDF → navigate）
3. **动态 tab**：左侧时间轴样式（时间点 + 竖线 + 圆点）；点击 → 同上进弹层。`DocRow`（components/doc-row.tsx）加可选 `onOpen?: (docId: string) => void`，提供时渲染为 button 而非 Link
4. **图谱 tab 泳道化**（detail.tsx MapTab 重写）：章节改等宽泳道列（横向滚动，`min-width 250px`），每列头部显示章节名 + 卡数/资料数 + 覆盖率进度条；概念卡片化：状态点（covered 绿 / learning 黄 / uncovered 灰）+ 标题 + `n卡 · 掌握 x%`；未覆盖概念虚线弱化 + 「✦ 让 AI 补」（保留现有 fill 逻辑）；顶部工具行保留覆盖率统计与「整理地图」按钮，加图例。点概念卡仍走现有 `service.openNode` → NodeDrawer
5. **NodeDrawer 链接改弹层**：卡片链接 → `reader.openCard(card.id, card.documentId)`；资料链接 → `reader.openDoc(id)`（PDF → navigate）
6. **Service 接线**：`TopicsPage` 的 bindServices 加 `ReaderService`；TopicsService 里 `this.resolve(ReaderService)` 调用（参照现有跨 service resolve 模式）；`<ReaderOverlay />` 挂在 TopicsPageContent 根部

## 约束

- web 是 Vite + React 19 + @rabjs/react：`observer` 组件 + `useService`；跨 service 用 `this.resolve(X)`
- 文案全中文、语气克制书面；图标 lucide-react；样式全部进 `apps/web/src/styles.css`，沿用现有 CSS 变量（--bg/--ink/--accent/--line-soft/--r-md 等）与暗色主题
- 不改任何后端代码、不改 DTO
- 完成后必须 `pnpm typecheck` 与 `pnpm -F @inwit/web build` 通过
