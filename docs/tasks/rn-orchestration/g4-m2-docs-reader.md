# G4 · M2 文档列表 + 阅读页接 WebView 文档引擎（apps/mobile）

你在 /Users/ximing/project/mygithub/inwit 仓库工作。前置产物：`packages/doc-engine`（WebView 引擎，`src/protocol.ts` 是桥协议唯一事实来源，`dist/doc-engine.html` 是构建产物）与 `apps/mobile`（M0 骨架 + M1 复习/今日）。**先读这些现有代码再动手**。

**规格**：docs/tasks/rn-mobile.md §3/§4.4/§5-M2；docs/tasks/rn-doc-engine-spike.md §2（bridge 协议）。
**web 参考（只读不改）**：apps/web/src/pages/docs/docs.service.ts（列表分页/主题筛选/轮询）、pane-read.tsx + card-rail.tsx（锚点点击联动）、components/search/search.service.ts（debounce+AbortController 防竞态）、components/reader/mini-card.tsx（迷你卡）。

## 任务

### 1. 依赖与引擎产物接入
- `pnpm -F @inwit/mobile add react-native-webview`（expo 兼容版本，用 `npx expo install react-native-webview`）。
- `apps/mobile/scripts/sync-engine.mjs`：把 `packages/doc-engine/dist/doc-engine.html` 拷到 `apps/mobile/assets/doc-engine.html`；在 `apps/mobile/package.json` 加 `sync:engine` script，并在 `prestart`/`prebuild` 挂自动执行。dist 不存在时给出中文报错提示先跑 `pnpm -F @inwit/doc-engine build`。
- WebView 加载：`source={require('../assets/doc-engine.html')}`（双端通用）；dev 期间支持用 `src/config.ts` 里的 `docEngineDevUrl`（默认空，填 `http://<IP>:5199` 则走 vite dev server 热更新）。

### 2. 原生侧封装（src/doc-engine/）
- `DocEngineView.tsx`：封装 react-native-webview。
  - 命令：ref 暴露 `init/setContent/setEntities/setActiveEntity/focusCard/injectAssetUrls/setTheme`，经 `injectJavaScript` 调 `window.__docEngine.dispatch(...)`；**ready 前到达的命令排队**，收到 `ready` 事件后按序 flush（init 永远第一个）。
  - 事件：`onMessage` 解析 DocEngineEvent（用 packages/doc-engine/src/protocol.ts 的类型，直接 relative import 源码类型即可），回调给 props：`onAnchorClick/onAnnotationClick/onSelectionChange/onSelectionAction/onAssetNeeded/onLinkClick/onError/onReady`。
  - 主题：跟随 ThemeService，切换时发 `setTheme`。
- `useDocEngineAssets.ts`：`onAssetNeeded` → `AssetUrlsService.ensure(srcs)` → 从 cache 收集 `Record<src, url|null>` → `injectAssetUrls`。
- 错误：`onError` 打 console + 页面顶部错误条（可重试）。

### 3. 文档 Tab（app/(tabs)/docs.tsx + src/pages/docs/）
- FlatList 文档流：20/页、`onEndReached` 加载、下拉刷新；每行：标题/摘要/主题/时间/pending「消化中」呼吸动画/failed 失败样式 + 「重试」（retryDocument）。
- 顶部：捕获框（**抽取 M1 今日页的捕获框为共享组件** `src/components/capture-box.tsx`，两处复用）；主题筛选横滑 chips（全部/各主题）。
- 点击文档 → `router.push('/docs/[id]')`。
- 3s 轮询 pending 文档（对齐 web 策略，Tab 失焦暂停）。

### 4. 阅读页（app/docs/[id].tsx）
- 整页 DocEngineView（原生壳只有标题栏：返回、标题、主题切换菜单）。
- 加载流程：`getDocument(id)` → ready 后 `setContent(contentJson)` + `setEntities(cards, annotations)`（数据形状读 packages/dto/src/document.ts 与 web 的调用方式；annotations 用 `listDocumentAnnotations`）。
- `?anchor=cardId` 参数：内容加载后 `focusCard(cardId)`。
- `onAnchorClick` → 底部 Sheet：该锚点的卡片 mini 卡列表（封面/问题 cloze/掌握度点，对齐 mini-card.tsx）；点卡片 → 卡片详情 Sheet（含脉络 getCardLinks）。
- `onAnnotationClick` → 底部 Sheet：批注列表（含截图，走 AssetUrlsService）。
- `onSelectionAction`：
  - `annotate` → Sheet 表单（quote 只读 + 批注输入）→ `createAnnotation({ documentId, quote, anchorBlockIndex, note })`
  - `card` → Sheet 表单（问题/答案）→ `createCard`（带 anchor 信息，形状对齐 web 的 selection 写卡调用）
  - `digest` → `enqueueSelectionCards(documentId, anchor)` + toast「已排队，消化完成后出现」，2s 轮询最多 9s 对齐 web
  - 成功后重新 `getDocument` + `setContent`/`setEntities` 刷新锚点显示
- `onLinkClick`：站内路径 → router（映射 web 路径：/docs?doc=xx→/docs/xx 等）；http(s) → `expo-web-browser` 打开。
- 空文档/消化中/失败三态占位页（pending 3s 轮询直至 ready）。

### 5. 搜索（文档 Tab 顶部入口）
- 搜索页 `app/search.tsx`（或 Modal）：输入框 300ms debounce + AbortController + 序号防竞态（抄 search.service.ts 逻辑）；支持 topicId 作用域；结果分文档/卡片两组，点击分别进阅读页/卡片 Sheet。

## 验收（全部必须通过）
1. `pnpm -F @inwit/mobile typecheck` 通过
2. `pnpm -F @inwit/doc-engine build && pnpm -F @inwit/mobile sync:engine` 后 `assets/doc-engine.html` 存在
3. `CI=1 pnpm -F @inwit/mobile exec expo export --platform ios --output-dir /tmp/inwit-export-g4` 成功
4. DocEngineView 的命令排队逻辑（ready 前缓冲）有注释 + 简单单测（vitest，放 `src/doc-engine/__tests__/`，不跑真机只测队列纯逻辑）
5. 不修改 apps/web、apps/server、packages/* 任何文件（packages/doc-engine 也**不改**，只读）；不 git commit

完成后 stdout 输出：PASS/FAIL 逐条 + 文件清单 + 遗留问题。
