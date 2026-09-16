# G1 · packages/doc-engine 脚手架与引擎装配

你在 /Users/ximing/project/mygithub/inwit 仓库工作（pnpm monorepo，全 ESM，相对导入带 .js 后缀，tsconfig NodeNext 风格）。

**先读这两份规格文档，严格按它们执行：**
- docs/tasks/rn-doc-engine-spike.md（bridge 协议、验收标准的唯一来源）
- docs/tasks/rn-mobile.md（§1 工程结构、§3 拷贝策略）

## 任务

新建 `packages/doc-engine`（包名 `@inwit/doc-engine`），一个自包含的 WebView 文档引擎，**不 import apps/web 的任何文件**。

### 1. 脚手架
- package.json：name `@inwit/doc-engine`，type module，scripts: `dev`(vite --port 5199 --strictPort --host)、`build`(tsc --noEmit && vite build)、`typecheck`(tsc --noEmit)、`test`(vitest run)。
- 依赖：`@inwit/doc-schema: workspace:*`、`@inwit/dto: workspace:*`、tiptap 全家桶（版本与 apps/web/package.json 完全对齐：@tiptap/core、@tiptap/extension-code-block-lowlight、@tiptap/extension-image、@tiptap/extension-subscript、@tiptap/extension-superscript、@tiptap/extension-table、@tiptap/extension-task-item、@tiptap/extension-task-list、@tiptap/pm、@tiptap/starter-kit，全部 ^3.31.3 或 =3.31.3 与 web 一致）、lowlight@3.3.0。
- devDependencies：vite ^6、vite-plugin-singlefile、typescript ^5.7.3、vitest ^5。
- vite.config.ts：单 entry（index.html），build 用 vite-plugin-singlefile 出 `dist/doc-engine.html`（inline 全部 js/css）。dev 时就是普通 vite server。
- tsconfig 参照 apps/web 的风格。

### 2. vendor 拷贝（按 rn-mobile.md §1 拷贝清单）
从 apps/web 拷贝以下文件到 `src/vendor/`，保持其内部逻辑不变，仅修 import 路径：
- `apps/web/src/components/doc/extensions.ts` → `src/vendor/extensions.ts`
- `apps/web/src/pages/docs/anchor-highlight.ts` → `src/vendor/anchor-highlight.ts`
- `apps/web/src/lib/entity-marks.ts` → `src/vendor/entity-marks.ts`
- `apps/web/src/lib/anchors.ts` → `src/vendor/anchors.ts`
- `apps/web/src/lib/pm-doc.ts` → `src/vendor/pm-doc.ts`

**适配点（唯一的逻辑改动）**：`extensions.ts` 里的 `AssetUrlsService` 依赖替换为引擎内置的 `src/asset-map.ts`：
```ts
export interface AssetUrlProvider {
  urlFor(src: string): string | null;
  ensure(srcs: string[]): Promise<void>;   // 引擎实现：收集 srcs → 发 assetNeeded 事件出桥
  subscribe(listener: () => void): () => void;
}
```
引擎侧的 ensure 不做网络请求，只通过 bridge 发 `assetNeeded`；`injectAssetUrls` 命令到达时更新 map 并 notify。`createDocExtensions` 的 opts 类型从 `AssetUrlsService` 改为 `AssetUrlProvider`。

### 3. 协议与桥
- `src/protocol.ts`：严格按 spike 任务书 §2 的 bridge 协议 v1 写全类型（DocEngineCommand / DocEngineEvent 及各 payload）。TextSelectionAnchor 形状与 vendor/entity-marks.ts 的 TextSelectionAnchor 一致。这是唯一事实来源，之后 mobile 会 import 它。
- `src/bridge.ts`：webview 侧收发封装。
  - 出桥：`window.ReactNativeWebView?.postMessage(JSON.stringify({v:1, ...evt}))`；无 ReactNativeWebView 时（浏览器 dev）降级为 `window.__onDocEngineEvent?.(evt)` 回调 + console.log。
  - 入桥：暴露 `window.__docEngine = { dispatch(msg) }`，解析 JSON、校验 `v===1`、路由到引擎；所有异常捕获后发 `error` 事件出桥（静默即失败）。

### 4. 引擎装配（src/engine.ts + src/main.ts）
- **不用 React**：直接用 `@tiptap/core` 的 `new Editor({ element, extensions, content, editable: false })` 挂到 DOM。不引入 @tiptap/react。
- 装配：vendor 的 `createDocExtensions({ editable:false, assetUrls: assetMap, anchorHighlight })`；AnchorHighlight 的回调接桥事件（onAnchorClick→anchorClick 事件，onAnnotationClick→annotationClick 事件）。
- 命令处理：init（注入主题 CSS 变量，值从 docs/design/v2/inwit.css 的 :root 和 [data-theme="dark"] 抄成两份 token 表）、setContent（setContent 命令，JSON 序列化去重）、setEntities（调 vendor 的 ensureEntityMarksOnEditor 同款逻辑 + updateDecorations）、setActiveEntity、focusCard（滚动+is-flash 闪烁，对齐 DocView.tsx:151 的行为）、injectAssetUrls、setTheme。
- 划选：监听 selectionchange（debounce 150ms），用 vendor entity-marks 的 selectionAnchorFromEditor 等价逻辑（editor.state.selection + window.getSelection 兜底）产出 anchor；选区的 viewport rect 用 `window.getSelection().getRangeAt(0).getBoundingClientRect()`；选择清空发 `anchor:null`。
- 划选动作条：webview 内自绘浮层（绝对定位 div，三个按钮：批注/写卡/AI 消化，中文文案，触屏尺寸 ≥44px 高），点击发 `selectionAction` 出桥并清除选择。CSS 加 `-webkit-touch-callout: none`。
- 链接点击：拦截 a 标签点击，发 `linkClick` 出桥（内部/外部分流交给 native，引擎只上报 href）。
- 正文样式：从 docs/design/v2/inwit.css 抄排版相关样式（doc-view 相关、纸张色系 token、锚点高亮 .anchor/.anchor-note/.is-on/.is-flash 样式）内联进引擎。

### 5. 演示页（dev harness，也是 CSI 验证目标）
`index.html` + `src/main.ts`：加载引擎 + 一份**全要素演示 PM JSON**（标题1-3、段落含加粗/斜体/行内代码/链接、有序/无序列表、任务列表（含勾选/未勾选）、三列表格、代码块（js）、图片节点（src 用 `asset:users/demo/pic.png` 伪协议）、分割线、pageBreak、预置一段 cardAnchor mark（cardIds:["demo-card-1"]）和一段 annotationMark（annotationId:"demo-note-1"））。
演示页侧边栏：事件日志面板（实时打印出桥事件）+ 命令按钮（模拟 setActiveEntity/focusCard/injectAssetUrls(给演示图片注一个 picsum 的 https URL)/setTheme 切换）。浏览器里所有出桥事件打到日志面板。

### 6. 测试
- `src/asset-map.test.ts`：注入/订阅/去重逻辑。
- `src/protocol.test.ts`：消息解析、v 校验、坏消息发 error。
- vendor 文件不改逻辑，如有现成测试依赖 DOM 可不搬。

## 验收（全部必须通过才算完成）
1. `cd /Users/ximing/project/mygithub/inwit && pnpm install` 成功
2. `pnpm -F @inwit/doc-engine typecheck` 通过
3. `pnpm -F @inwit/doc-engine test` 通过
4. `pnpm -F @inwit/doc-engine build` 产出 `packages/doc-engine/dist/doc-engine.html`（单文件）
5. `pnpm -F @inwit/doc-engine dev` 能起 :5199 演示页

## 约束
- **禁止修改 apps/web、apps/server、packages/dto、packages/doc-schema、packages/markdown 的任何文件**（只读拷贝源）。
- 禁止 git commit。
- 根 package.json / pnpm-workspace.yaml 不用改（`packages/*` glob 已覆盖）。
- 完成后在 stdout 输出：PASS/FAIL 逐条对应上面 5 条验收，以及你创建/修改的文件清单。
