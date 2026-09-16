# RN 文档引擎 Spike · 任务书

> 目标：用最小成本验证「WebView 文档引擎」路线在真机上成立——渲染 PM JSON、锚点高亮/点击、触屏划选三件事可行且体验可接受。这是 RN 客户端整个文档/批注/卡片体系的决策门。
>
> 前置共识（方案评审已定）：文档正文读/写/划选走 WebView（复用 `createDocExtensions` + `DocView` + `anchor-highlight` + `entity-marks`），其余界面全原生；WebView 内**零 API 请求**，数据全走桥。

## 1. Spike 范围

**做：**

- `packages/doc-engine`：独立 vite 工程，单文件 HTML 产物（`vite-plugin-singlefile`），只读 tiptap 渲染器 + bridge 客户端
- `apps/mobile` 最小壳：Expo 工程、一个阅读页（整页 WebView）、bridge host
- 一份带全要素的演示文档 PM JSON（标题/段落/列表/任务/表格/代码块/图片/视频占位/加粗斜体链接 + 预置 cardAnchor/annotationMark），双端跑通完整桥流程

**不做（ spike 之后）：** 编辑态、PDF、真实 API 接入、批注/写卡的提交链路、长文档分段渲染（视验收第 9 条结果决定是否进 v1）。

## 2. Bridge 协议 v1

信封：`{ v: 1, type: string, payload?: unknown }`。RN→WV 走 `injectJavaScript` 调 `window.__docEngine.dispatch(msg)`；WV→RN 走 `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`。协议类型放 `packages/doc-engine/src/protocol.ts`，mobile 直接 import 源码类型。

### RN → WebView（命令）

```ts
// 初始化，必须在 setContent 之前；注入主题 token（inwit.css 的 CSS 变量值）与平台
type InitCmd = { type: 'init'; payload: { theme: 'light' | 'dark'; platform: 'ios' | 'android' } };

// 设置文档正文。PmDocJson 即服务端 contentJson 形状（@inwit/dto）
type SetContentCmd = { type: 'setContent'; payload: { doc: PmDocJson } };

// 设置锚点实体。形状复用 lib/entity-marks.ts 的 CardAnchorInput / AnnotationAnchorInput
type SetEntitiesCmd = { type: 'setEntities'; payload: {
  cards: CardAnchorInput[];            // { id, anchorText?, anchorBlockIndex?, hasImage? }
  annotations: AnnotationAnchorInput[]; // { id, kind?, quote, anchorBlockIndex?, imageKey? }
} };

// 激活/取消激活某个实体（联动卡片栏选中态）
type SetActiveEntityCmd = { type: 'setActiveEntity'; payload: {
  kind: 'card' | 'annotation'; id: string | null;
} };

// 跳转锚点并闪烁（对齐 DocView 的 focusCardId 行为）
type FocusCardCmd = { type: 'focusCard'; payload: { cardId: string } };

// 注入 presigned URL。webview 侧 NodeView 只读这个 map，不自己请求
type InjectAssetUrlsCmd = { type: 'injectAssetUrls'; payload: {
  urls: Record<string, string | null>; // key = asset: 伪协议 src；null = 解析失败
} };

// 主题切换（不重建 editor，只切 CSS 变量）
type SetThemeCmd = { type: 'setTheme'; payload: { theme: 'light' | 'dark' } };

type DocEngineCommand = InitCmd | SetContentCmd | SetEntitiesCmd
  | SetActiveEntityCmd | FocusCardCmd | InjectAssetUrlsCmd | SetThemeCmd;
```

### WebView → RN（事件）

```ts
// 引擎就绪，可接收 setContent
type ReadyEvt = { type: 'ready' };

// 引擎内部错误（渲染异常、消息解析失败）——必须覆盖崩溃路径，静默即失败
type ErrorEvt = { type: 'error'; payload: { message: string; stack?: string } };

// 锚点点击。对齐 anchor-highlight.ts 的 onAnchorClick/onAnnotationClick
type AnchorClickEvt = { type: 'anchorClick'; payload: { cardIds: string[] } };
type AnnotationClickEvt = { type: 'annotationClick'; payload: { annotationIds: string[] } };

// 划选变化。anchor 形状 = lib/entity-marks.ts 的 TextSelectionAnchor；
// rect 为选区在 webview viewport 中的包围盒（供 RN 侧浮层定位，spike 中验证其可靠性）
type SelectionChangeEvt = { type: 'selectionChange'; payload: {
  anchor: { text: string; blockIndex: number; from: number; to: number } | null;
  rect: { x: number; y: number; width: number; height: number } | null;
} };

// 划选动作（spike 中由引擎自绘工具条发出，验证完整交互闭环）
type SelectionActionEvt = { type: 'selectionAction'; payload: {
  action: 'annotate' | 'card' | 'digest';
  anchor: { text: string; blockIndex: number; from: number; to: number };
} };

// 渲染中遇到未解析的 asset: src（RN 侧走 AssetUrlsService 解析后 injectAssetUrls 回填）
type AssetNeededEvt = { type: 'assetNeeded'; payload: { srcs: string[] } };

// 正文内链接点击（内部路径 vs 外部 URL 由 RN 侧分流）
type LinkClickEvt = { type: 'linkClick'; payload: { href: string } };

type DocEngineEvent = ReadyEvt | ErrorEvt | AnchorClickEvt | AnnotationClickEvt
  | SelectionChangeEvt | SelectionActionEvt | AssetNeededEvt | LinkClickEvt;
```

### 约定

- **消息幂等**：同一命令重复到达不得产生副作用差异（setContent 用 JSON 序列化去重，对齐 `DocView.tsx:140` 的做法）。
- **图片流**：引擎渲染遇 `asset:` src → 收集去重 → `assetNeeded` 出桥 → RN `AssetUrlsService.ensure()`（presign 缓存逻辑直接复用 `lib/asset-urls-logic.ts`）→ `injectAssetUrls` 回桥 → NodeView 刷新。RN 侧负责 TTL/冷却，引擎只做 map 查找。
- **锚点数据流**：`setContent`（正文）与 `setEntities`（锚点元数据）分离，引擎内执行 `ensureEntityMarksOnEditor` 同款兜底定位（mark 丢失时 quote+blockIndex 找回），保持与 web 一致的「丢失→重定位」语义。
- **划选节流**：`selectionChange` 在拖拽手柄期间 debounce 150ms 出桥；选择清空必须发 `anchor: null`。
- 预留（spike 不实现）：`getJSON` RPC（编辑态保存用）、`applyEntityMark`（写卡后即时上 mark）、`setEditable`。协议信封保留 `id` 字段用于未来 request/response。

## 3. 工程结构

```
packages/doc-engine/          # 新包，独立 vite 构建
  src/
    protocol.ts               # 上面的类型（唯一事实来源）
    bridge.ts                 # webview 侧收发封装
    engine.ts                 # tiptap 只读装配：createDocExtensions + AnchorHighlight
                              #   + entity-marks 复用 + 自绘划选工具条
    asset-map.ts              # AssetUrlProvider 的注入 map 实现
    main.tsx / index.html     # entry
  dist/doc-engine.html        # 单文件产物 → 同步到 apps/mobile/assets/

apps/mobile/                  # Expo 最小壳（spike 版）
  src/doc-engine/
    DocEngineView.tsx         # react-native-webview 封装：ref 命令方法 + onEvent 回调
    useDocEngineAssets.ts     # assetNeeded ↔ AssetUrlsService 接线
  app/reader.tsx              # 演示阅读页（整页 WebView + 底部动作条）
```

- dev：WebView `source={{ uri: 'http://<局域网IP>:5199' }}`（vite dev server），热更新调试；release：`source={require('../assets/doc-engine.html')}`。
- 引擎复用 web 代码的方式是**拷贝进 `vendor/` 后独立适配**（来源：`apps/web/src/components/doc/extensions.ts`、`pages/docs/anchor-highlight.ts`、`lib/entity-marks.ts`、`lib/anchors.ts`、`lib/pm-doc.ts`），web 端零改动、不做 alias/相对引用；`AssetUrlsService` 依赖替换为引擎内置的注入 URL map（见 rn-mobile.md §1 拷贝清单）。
- 样式：抽 `docs/design/v2/inwit.css` 的排版相关段落为引擎内联样式，主题变量由 `init`/`setTheme` 注入。

## 4. 验收标准

### P0 · 阻断项（决定方案是否成立）

| # | 项 | 标准 |
|---|---|---|
| 1 | 真机渲染 | iOS 真机 + Android 真机各一：全要素演示文档渲染正确（表格边框、任务勾选框、代码高亮、锚点底色与 web 端视觉一致）；中端机从加载到可交互 ≤ 2s |
| 2 | 触屏划选 | 双端可拖选手柄选中文本；`selectionChange` 稳定返回 `{text, from, to, blockIndex}`，**与同文档同选区在 web 端 `selectionAnchorFromEditor` 的结果一致**（自动化对比：固定 10 组选区断言 from/to）；跨段落选择可用 |
| 3 | 手势冲突 | 单击锚点高亮区触发 `anchorClick`/`annotationClick`，长按触发划选，两者不互相误触发；拖动手柄期间页面不滚动 |
| 4 | 系统 callout | iOS 系统复制/粘贴菜单可禁用（`-webkit-touch-callout: none` 等），替换为自绘工具条/RN 底部动作条后交互闭环完整：划选 → 出现动作入口 → 点击 → `selectionAction` 出桥 |
| 5 | 桥可靠性 | 本地 HTML 加载下命令/事件往返延迟 ≤ 50ms；连续 100 条消息不丢不乱序；引擎内异常有 `error` 事件出桥（不得静默） |

### P1 · 完整性项

| # | 项 | 标准 |
|---|---|---|
| 6 | 图片链路 | `asset:` src 走 assetNeeded→inject 全链出图；URL 过期（模拟）后可二次注入刷新；失败 src 显示占位 |
| 7 | 主题 | 深色/浅色 `setTheme` 即时切换，无闪烁重排 |
| 8 | focusCard | 跳转锚点 + 闪烁动画与 web 一致 |
| 9 | 长文档 | 2000 段文档双端不 crash、滚动可接受；记录内存峰值（结论决定 v1 是否做 pageBreak 分段渲染） |
| 10 | dev 体验 | vite dev server 直连热更新可用，改引擎代码无需重打 RN 包 |

### 决策门

- P0 全过 → 方案成立，进入 M2 正式开发（本文档验收记录进 `rn-doc-engine-spike-report.md`）。
- P0-2/3/4 在某一端不达标 → 启动降级路径评估：该端划选降级为**段落级长按菜单**（block 粒度批注/写卡，牺牲字符级精度），并重新评审是否改原生渲染器路线。
- P0-1 不达标（性能）→ 先验证 pageBreak 分段渲染是否达标，再定路线。

## 5. 风险排查清单（spike 中逐项记录）

- [ ] iOS WebView 长按文本的放大镜/选择手柄与 `user-select` CSS 的行为组合
- [ ] Android WebView 选择句柄样式与长按震动反馈
- [ ] WebView 整页滚动与 RN 外层的手势冲突（阅读页整页 WebView，预期无嵌套滚动）
- [ ] `injectJavaScript` 在快速连续命令下的时序（初始化竞态：RN 侧需等 `ready` 后再发 `init`/`setContent`）
- [ ] 单文件 HTML 体积（tiptap + lowlight 全量打包预计 400–600KB gzip 前），真机解析耗时
- [ ] 宋体标题在双端 webview 的字体栈落点（不内置字体文件时的系统 serif 表现）

## 6. 时间盒

**3 个工作日**：第 1 天工程脚手架 + 渲染链路（验收 1/6/7）；第 2 天划选 + 锚点交互（验收 2/3/4/8）；第 3 天双端真机调优 + 可靠性/长文档（验收 5/9/10）+ 出报告。超时未过 P0 直接触发决策门，不追加时间。
