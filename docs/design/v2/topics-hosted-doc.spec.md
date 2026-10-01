# 主题内文档：与文档页同一套工作台

> 现状规格。视觉参照同目录 `topics-hosted-doc.html`（A–C 是主题页，D–E 是盖在主题页上的文档工作台）。
> 原先的 `topics-reader-overlay.spec.md` / `.html` 已由本文件取代。Web 不再有 `ReaderOverlay` 或 `ReaderService`。

## 结论

主题里打开的文档就是文档页的 `DocsPage`。`TopicsPage` 懒加载 `@/pages/docs` 的同一组件，不另做阅读器，也不把工作台挂进 portal。后续正文、编辑、卡片列表、脑图、脉络、禅模式、右侧对话栏只维护这一份。

主题页多出来的只有三件事：地址停在 `/topics`，底下的主题页保持挂载，上面加一条「返回主题」。

## 地址

帮手在 `apps/web/src/routes.ts`。

- `topicDocPath(topicId, docId, { anchor?, annotation? })` → `/topics?topic=&doc=&anchor=&annotation=`
- `topicHostId(pathname, params)`：pathname 是 `/topics` 且 `topic`、`doc` 都有值时返回主题 id，否则 `null`
- `documentReturnTarget`：托管中的文档回到 `topicPath(topicId)`，并且 `replace: true`。仅当还留在 `/docs` 且带旧的 `fromTopic` 时，才不 replace 地回到该主题。其余回到 `/docs`
- `editorNewPath` 的 `topicId` 只表示「在这个主题里新建一篇」。它不是返回信号，不要和 `fromTopic` 或托管用的 `topic` 混用
- 分享链接仍是 `/docs?doc=`，不带主题参数
- 文档自身的 `topicId` 不决定关到哪里。返回看的是这次从哪进来

从主题列表、主题内搜索、图谱抽屉进文档，用 `topicDocPath`。从文档列表、首页、没有主题范围的搜索进来，仍是 `/docs`，关闭回到文档列表。在托管层里若改去文档列表上的另一篇，这次主题入口就丢掉。同一篇上只改 `anchor` / `annotation` 时保留。

## 主题页怎么挂

`apps/web/src/pages/topics/index.tsx`：

- `.topics-host` 里先渲染原来的 `.ws.ws-topics`。`topic` 与 `doc` 同时存在时，这一层加 `inert`，选中的 tab、图谱抽屉、滚动都留在这棵树上
- 上面盖 `.topic-doc-layer`（铺满主题工作区，`z-index: 16`，盖过节点抽屉的 `z-index: 12`）。应用左侧导航是 `.rail`（`z-index: 4`），和 `<main>` 是兄弟，这一层盖不到它，所以导航仍停在「主题」
- 层内只有退出条：`.topic-doc-back` 文案「返回主题」，旁边是主题名。点击 `navigate(topicPath(id), { replace: true })`
- 退出条下面是 `<DocsPage />`。加载中显示「打开这张纸…」
- 浏览器后退弹出这次 push 的文档地址，回到同一份还挂着的主题页

PDF 也走这一层。文档页用 `@embedpdf` 拉取预签名文件，不再因为是 PDF 就跳去 `/docs`。

## 托管时文档页改哪些行为

`topicHostId` 非空时才走这些分支，组件仍是文档页自己的。

- 根节点加 `ws is-topic-host`，不渲染左侧文档列表（`WorkbenchList`）
- 顶行 `DocTopRow` 不放第二个「返回主题」文字按钮。禅模式旁边是 X：托管时 `title` / `aria-label` 为「返回主题」，否则为「关闭」。两者都走 `documentReturnTarget`
- 非禅模式下，卡片列表和脑图跟正文并排（停靠的卡片栏）。锚点只负责展开对应卡片，不把栏改成浮层。收起后，把手再展开为并排，而不是浮层
- 禅模式沿用已保存的 `UiPrefsService.zenMode`（`inwit-zen-mode`）。`Layout` 在禅模式打开、且地址上有 `doc`，并且当前是 `/docs` 或「`/topics` 且带 `topic`」时，给壳加上 `shell is-zen`。`.shell.is-zen .rail` 隐藏左侧导航。不要因为从主题进来就自动打开这个开关。Escape 退出禅模式，不关闭文档
- 窄屏禅模式仍可改成上下叠（`is-zen-stack`）。这是文档页原有的窄屏规则
- 脉络在展开的卡片下面（`card-link-list.tsx`）。托管时关联卡的链接用 `topicDocPath`。「去复习」仍是栏头的链接，不是每张卡一个按钮
- 右侧对话栏挂在 `Layout` 上，叠在文档层之上。当前文档 id：`/docs` 上的 `doc`，或 `/topics` 已选主题时的 `doc`。在主题里 @ 文档、打开文档，用 `topicDocPath`

缺文档、加载失败时的返回按钮同样走 `documentReturnTarget`。目的地以 `/topics` 开头时文案是「返回主题」，否则是「回文档列表」。

## 主题页其余画面

A–C 仍是主题页自己的布局，打开文档之前就能看见：

- 文档 tab：自适应栅格。点击进画面 D，地址变为 `/topics?topic=&doc=`
- 图谱 tab：章节泳道。点概念仍开节点抽屉；抽屉里的卡片、资料再进画面 D 或 E
- 动态 tab：时间轴。点条目同样进画面 D

这些入口不切换左侧应用到「文档」。

## 明确不做

- 不恢复 `ReaderOverlay`、`ReaderService`，也不做「打开完整页面」再跳进第二套阅读器
- 不把持久化的禅模式当作「从主题打开文档」的开关
- 不改移动端。手机主题详情仍 `router.push` 到自己的文档栈，没有这层托管
- 不改桌面壳的 `on_navigation`。Web 不再用 iframe 打开 PDF；放行其它 `https` 主机是因为该回调分不出主框架，见 `docs/design/desktop-remote-web.md`
