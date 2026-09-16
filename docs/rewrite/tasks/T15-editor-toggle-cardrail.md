# T15 · 编辑/预览全局开关 + 右侧批注卡片栏 + 退出死循环修复

先读 `docs/rewrite/CONTEXT.md`。视觉沿用现有设计体系（docs/design/v2/ + styles.css tokens），T13 刚打磨过 docs 工作台，保持一致。

## 背景现状（已核实）

- `/docs` 右 pane 的编辑态由 URL `?edit=1` 驱动（`pages/docs/index.tsx` ~L29 `params.get('edit') === '1'`），打开文档默认是阅读态
- 划线锚点：`lib/Markdown.tsx` 的 `AnchoredMarkdown` + `lib/anchors.ts`（`wrapAnchors` 把卡片 anchor 文本包成 `mark.anchor`），点击划线有 `activeCardId` 联动逻辑；卡片列表目前是内容下方的「本文卡片」mini-grid
- 编辑器：`pages/docs/paper-editor.tsx`（tiptap）+ `editor.service.ts`（自动保存）
- 退出按钮在 `shell/Layout.tsx` ~L93，调 `services/auth.service.ts` 的 `logout()`

## 任务

### 1. 修复退出报错「Maximum update depth exceeded」

- 复现：登录态点左侧导航底部退出 → 控制台/页面抛 `Maximum update depth exceeded`（某组件在 useEffect 里 setState 且依赖每次渲染都变）。嫌疑区：docs 页 effects（`index.tsx` L80-114 的 editor open/save 编排）在 user 变 null、路由跳转过程中的循环
- 找到根因并修：logout 后干净地回到 /login，控制台无报错，不白屏
- 顺手检查其他页面在 logout 跳转时是否有同类问题

### 2. 编辑/预览全局开关

- **打开文档默认进入编辑态**（用户要求）
- 编辑⇄预览切换是**全局 flag**（不是每个文档的 URL 参数）：右 pane chrome 上放一个分段开关（编辑 ｜ 预览，参考设置页外观选择器的视觉），切一次对所有文档生效，**localStorage 持久化**
- 不再用 `?edit=1` 驱动；为兼容旧链接，`?edit=1` 进入时把全局 flag 置为编辑态后清掉该参数
- chrome 布局：左 ✕ 关闭；中 topic 选择 + 保存状态（编辑态时）；右 分段开关 + （编辑态的"完成"可以去掉，分段开关即切换）
- 全局 flag 建议放 `services/` 下的一个 UI prefs service（参考 theme.service.ts 的模式）

### 3. 批注卡片移到右侧面板

- 打开文档时（**阅读态和编辑态都有**），内容区右侧出现「卡片栏」：
  - 列出本文全部卡片（问题 cloze 渲染用现有 `lib/cloze.ts`、掌握度格、下次复习文案——从现在底部 mini-grid 搬上来）
  - 点击正文中的划线 `mark.anchor` → 右侧对应卡片**滚动到位并高亮**（复用 activeCardId 联动）；点击右栏卡片 → 正文对应划线高亮（现有逻辑已有，接上来）
  - 底部「本文卡片」mini-grid 移除，「去复习 →」链接挪到卡片栏头部
- **宽度不够时收起**：卡片栏常态宽 ~300px；pane 容器宽度不足（如窗口 <1280px）时自动收起为右缘一个竖向把手按钮（lucide `PanelRight` / 卡片数角标），点击以浮层形式从右侧滑出覆盖在内容上，点外部或 ✕ 收起。也允许用户在宽屏手动收起
- 卡片栏头部：「本文卡片 · N」+「去复习 →」

### 4. 编辑态也要能看到划线

- tiptap 编辑器里把卡片 anchor 对应的文本高亮出来（与阅读态 `mark.anchor` 同款视觉，暖色底）
- 实现建议：tiptap **Decoration 插件**（不改文档内容，只对匹配 anchor quote 的文本范围加 inline decoration class），anchor 数据来自文档的卡片列表（`docs.service` 已有）；文档编辑导致文本变化时 decoration 跟着重算，匹配不到的 anchor 静默跳过
- 编辑态点击划线高亮右侧对应卡片（如果 ProseMirror 事件好接就接，不好接可以只做高亮不做点击联动，在任务总结里说明取舍）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 退出无报错、回 /login 正常
- 打开文档默认编辑态；分段开关全局生效且刷新后保持；旧 `?edit=1` 链接兼容
- 阅读态/编辑态都有右侧卡片栏；窄窗口自动变浮层；划线⇄卡片双向高亮
- 编辑态正文可见划线高亮
- 浅色/深色模式目检
- 不启动/停止 dev server / worker
