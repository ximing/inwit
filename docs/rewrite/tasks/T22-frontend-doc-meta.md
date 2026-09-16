# T22 · 前端：文档行展示摘要 + 空标题补偿

先读 `docs/rewrite/CONTEXT.md`。T21 已提供：`Document`/`DocumentListItem` 的 `title` 可空 + 新增 `description`，dto 有共享 helper `docDisplayTitle(doc)`（title → description 首行截断 → 「未命名文档」）。

## 任务（`apps/web/src/`）

### 1. 所有文档条目用 `docDisplayTitle` 补偿显示

- `/docs` 左栏文档流、首页「最近文档」、主题详情「文档」tab、jobs 页相关内容——所有渲染文档标题的地方统一走 `docDisplayTitle`，不再直接渲染 `doc.title`（会 null）
- 编辑器标题输入框：值为 `doc.title ?? ''`，placeholder「无标题」（已有的话确认行为）；保存空标题 → 传 null 而非空串（检查 api 封装）

### 2. 文档行加摘要行

- `/docs` 左栏文档行：标题下一行显示 `description`（一行省略，弱色小字，参考 meta 行但更浅一档）；无 description 不占位
- 视觉参考 docs.html 的 row 节奏，加摘要后行高自适应，保持紧凑
- 主题详情的文档行同样处理

### 3. digest 完成轮询

- 消化中文档轮询完成后，title/description 会被 agent 重写——确认轮询刷新后 UI 拿到新值（list 和打开的 doc 都刷新）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 无标题文档在列表/首页/主题页显示摘要补偿而非「未命名文档」堆叠；有标题的显示标题+摘要两行
- 浅色/深色目检
- 不启动/停止 dev server / worker / s3rver
