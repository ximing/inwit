# T20 · 前端：导航收窄可折叠 + 个人资料设置

先读 `docs/rewrite/CONTEXT.md`。T19 已提供：`PATCH /api/me {displayName?,email?}`、`POST /api/me/avatar/upload-url` → `{uploadUrl,key}` → PUT 直传 → `POST /api/me/avatar {key}` 确认；User DTO 带 `displayName`/`avatarUrl`（presigned，1h 过期）。

## 任务 1：左侧导航收窄 + 折叠（`shell/Layout.tsx`、`styles.css`）

- 默认宽度收窄（比现在瘦一圈，~200px），padding/字号节奏同步收
- **折叠开关**：rail 顶部 logo 行右侧或底部放折叠按钮（lucide `PanelLeftClose`/`PanelLeftOpen`）；折叠后宽度 ~56px，**只显示 icon**（首页/文档/复习/主题/任务/设置），nav 文字隐藏，复习角标保留在 icon 右上角；hover icon 出 tooltip（title 或自绘小气泡）
- 折叠态底部：只留头像圆点（点击展开或跳设置）；主题切换和退出收进头像的 hover 小浮层（或折叠时隐藏、展开才见——取更好看的）
- 状态 localStorage 持久化；宽度过渡 150ms ease；折叠态深色/浅色都正常
- 折叠后各页面内容区自适应（布局是 flex 的应该自动，检查一遍）

## 任务 2：个人资料（settings 页新分节）

- 设置页加分节「个人资料」（排在「外观」前）：圆形头像预览（lucide `User` 兜底）、「更换头像」按钮（file input accept image/*）、用户名 input（displayName）、邮箱 input、保存按钮
- 头像上传链路：选文件 → POST upload-url → **fetch PUT uploadUrl（Content-Type 同文件）** → POST /api/me/avatar {key} → 刷新 User；上传中按钮 loading 态；>5MB 或非图片前端直接提示
- 保存调 PATCH /api/me；email 冲突 409 显示「这个邮箱已被使用」
- 保存成功轻提示；User 更新后 auth.service 的 user 同步

## 任务 3：导航底部用户卡片用真头像和用户名

- rail 底部用户区：显示 avatarUrl（无则首字母兜底圆）+ displayName（无则邮箱）
- avatarUrl 是 1h 过期的 presigned URL，`<img>` 加载失败（403 过期）时静默回落首字母兜底，并触发一次 /api/auth/me 刷新换新 URL（防循环：失败后 30s 内不重复刷）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 折叠/展开丝滑且刷新后保持；六个页面在折叠态布局不破
- 上传头像（dev S3 s3rver 在 4569 跑着）→ 头像出现在设置页和导航底部；改用户名/邮箱生效
- 浅色/深色目检
- 不启动/停止 dev server / worker / s3rver
