# G5 · M3 主题 / 任务 / 设置（apps/mobile）

你在 /Users/ximing/project/mygithub/inwit 仓库工作。前置产物：apps/mobile 已有 M0 骨架 + M1 复习/今日 + M2 文档列表/阅读页。**先读现有代码摸清结构**（app/ 路由、src/api、src/services、src/pages、src/components、src/theme），新页面沿用既有模式（@rabjs/react service + expo-router + theme token）。

**规格**：docs/tasks/rn-mobile.md §5-M3。
**web 参考（只读不改）**：
- apps/web/src/pages/topics/index.tsx + topics.service.ts + detail.tsx（主题列表/详情/图谱/动态）
- apps/web/src/pages/jobs/index.tsx + jobs.service.ts（队列/用量/历史）
- apps/web/src/pages/settings/index.tsx + settings.service.ts（五节设置）

## 任务

### 1. 主题 Tab（app/(tabs)/topics.tsx + app/topics/[id].tsx）
- 列表：输入框回车新建主题；活跃/已归档分组（归档默认折叠）；每行 标题 + 卡数·文档数 + 掌握度进度条；点击进详情。
- 详情页：标题/目标点击即编辑（inline Modal 或行内输入）；菜单（归档/取消归档/删除带确认弹窗）；统计条（卡数/文档/掌握度/最近消化时间/地图覆盖 n/m）。
- 详情三个 tab（分段控件）：
  - **文档**：捕获框（共享组件，固定 topicId；归档主题禁用）+ 文档卡片列表（分页）→ 点击进 M2 阅读页。
  - **图谱**：简化树视图——getTopicMap 拉取后按层级缩进渲染节点（名称 + 卡数 + 覆盖状态点）；节点点击出底部 Sheet（getMapNodeDetail：卡片/资料列表）；顶部「整理」(organizeTopicMap)/「补充」入口 + job 轮询（进行中显示进度、冲突时提示 TOPIC_JOB_IN_PROGRESS 对齐 web 行为）。不做 web 的复杂泳道布局。
  - **动态**：主题动态 feed 列表（web detail.tsx 的 FeedTab 数据源）。
- 主题内搜索：详情页搜索入口（复用 M2 搜索页，带 topicId 作用域）。

### 2. 任务 Tab（app/(tabs)/jobs.tsx）
- 队列条：进行中/排队中/今日完成/失败待处理四格。
- 进行中列表（1s tick 实时耗时秒表）；排队列表（定时/立即标记 + 取消 cancelJob）。
- Token 用量面板：近 7 天柱状图（react-native-svg，对齐 M1 复习图表样式）+ 按类型图例 + 合计（getJobUsage）。
- 执行历史：状态/类型筛选 chips + 分页 + 失败重试 retryJob + 错误详情展开。
- 5s 轮询队列（Tab 失焦暂停）。

### 3. 我的 Tab（app/(tabs)/me.tsx + 各子页）
分节列表（点击进子页或展开）：
- **个人资料**：头像（expo-image-picker 选图 → `POST /api/me/avatar/upload-url` 拿 presign → `FileSystem.uploadAsync` PUT 直传 → `POST /api/me/avatar` confirm，对齐 web 流程与 `AVATAR_MAX_BYTES` 5MB 限制）、用户名/邮箱编辑（PATCH /api/me）。
- **外观**：浅色/深色/跟随系统三段选择（接 ThemeService）。
- **模型配置**（BYOK）：LLM 配置列表（掩码显示）/新增（供应商/模型/API Key/Base URL/设为默认）/设为默认/测试连通/删除——api 拷 apps/web/src/api/llm.ts。
- **文档解析（OCR）**：API Key/模型/Base URL 表单 + 保存 + 测试——api 拷 ocr.ts。
- **接口令牌**：列表/生成（名称输入）/复制（reveal 后写剪贴板 expo-clipboard）/调用日志（方法/路径/状态码，分页）——复用 src/api/auth.ts 里已有的 access-token 函数。
- 退出登录（确认弹窗 → AuthService.logout）。

## 验收（全部必须通过）
1. `pnpm -F @inwit/mobile typecheck` 通过
2. `CI=1 pnpm -F @inwit/mobile exec expo export --platform ios --output-dir /tmp/inwit-export-g5` 成功
3. 不修改 apps/web、apps/server、packages/* 任何文件；不 git commit
4. 所有文案中文；浅色/深色主题都正确

完成后 stdout 输出：PASS/FAIL 逐条 + 文件清单 + 遗留问题。
