# T11 · 前端：新建文档 + 文件导入入口

先读 `docs/rewrite/CONTEXT.md`，再读 `docs/design/v2/docs.html` 与 `docs/design/v2/inwit.css`（视觉唯一真相）。T10 已提供 `POST /api/documents/import`（multipart，字段 `file` + 可选 `topicId`，返回 Document）。

## 背景

`/docs` 工作台左栏目前只有捕获框 + 筛选 + 文档流。现在要加两个入口：**新建空白文档**、**导入文件**。风格严格沿用设计稿（纸质、克制、lucide 图标），不要引入新视觉语言。

## 任务（`apps/web/src/pages/docs/`）

### 1. 新建文档

- 左栏捕获框下方/文档流头部附近加一个低调的「新建文档」按钮（lucide `FilePlus` 或 `Plus`，样式参考稿子里的 ghost/chip 按钮）
- 点击 → `POST /api/documents`（现有接口，contentMd 传空字符串或一个空段落，source: 'editor'）→ 成功后选中文档并直接进入编辑态（`/docs?doc=<id>&edit=1`），用户立刻可以打字，自动保存走现有逻辑
- 失败 toast/错误文案克制

### 2. 导入文件

- 左栏「导入」按钮（lucide `Upload`），点击开文件选择器，accept=".pdf,.docx,.epub,.txt,.md"
- 同时支持**拖拽文件到左栏文档流区域**：拖入时该区域显示虚线高亮态（参考稿子的虚线新建主题卡片风格），松手即上传
- 上传中：按钮/区域显示进度态（转圈 + "正在导入 xx.pdf…"）；成功后：
  - 新文档出现在文档流顶部并自动选中（阅读态），digest pending 的"消化中"脉冲 tag 和轮询是现有逻辑，确认它对新文档生效
  - 文档行 meta 上 source='import' 的显示「导入」tag（样式同现有 AI 回答/AI 复盘 tag 的克制变体；T10 后端已在列表项带 source）
- 失败（415 不支持类型 / 422 解析失败 / 413 过大）→ 在左栏顶部显示一条可 dismiss 的错误条，文案说明原因（如"这个文件解析失败了，可能已加密或损坏"）

### 3. api 封装

- `apps/web/src/api/documents.ts` 加 `importDocument(file: File, topicId?: string)`：FormData，字段名 `file`/`topicId`，带 cookie，返回 Document；以及 `createDocument(input)`（若还没有的话）

### 4. 主题感知

- 若左栏当前选中了某个主题筛选，导入/新建默认带上该 topicId

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 与 docs.html 视觉一致；交互路径：点导入 → 选文件 → 文档出现并消化中；拖拽同样生效
- 新建文档立刻可编辑可自动保存
- **不要启动/停止任何 dev server / worker**
