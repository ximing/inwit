# G3 · M1 复习闭环 + 今日页（apps/mobile）

你在 /Users/ximing/project/mygithub/inwit 仓库工作。apps/mobile（Expo + expo-router + @rabjs/react）骨架已由前序任务建好——**先读现有代码摸清结构**（app/ 路由、src/api、src/services、src/theme、src/config.ts），再动手。

**规格**：docs/tasks/rn-mobile.md §4.7（复习交互映射）、§5 M1 行；交互语义以 web 端为准（只读参考，不改）：
- apps/web/src/pages/today/index.tsx + today.service.ts
- apps/web/src/pages/review/index.tsx + review.service.ts
- apps/web/src/components/reader/mini-card.tsx（ClozeText/MasteryDots）
- apps/web/src/lib/cloze.ts、format.ts

## 任务

### 1. 拷贝适配（web → apps/mobile/src/）
- `lib/cloze.ts`、`lib/format.ts`：纯函数，原样拷贝到 `src/lib/`。
- api 层补充拷贝：`apps/web/src/api/documents.ts`、`cards.ts` → `src/api/`（review/reports/topics 骨架里已有）；import 路径适配，逻辑不动。
- `AssetUrlsService`：拷贝 `apps/web/src/services/asset-urls.service.ts` + `apps/web/src/lib/asset-urls-logic.ts` + `presign-cache-logic.ts` 到 mobile（`src/services/asset-urls.service.ts` / `src/lib/`），零逻辑改动（mobile 的 api client 形状已兼容）；卡片截图显示用它。

### 2. 复习页（app/(tabs)/review.tsx + src/pages/review/）
Hub 与 Session 两个模式，交互严格对齐 web：
- **Hub**：streak hero（当前/最长连续天数）、今日待复习数 + 预计分钟、「开始复习」大按钮；统计格（总卡片/已掌握 interval≥21d/近 7 天想起率/近 7 天复习次数）；近 7 天表现堆叠柱状图（想起/模糊/忘了三色，react-native-svg 自绘）；未来 7 天到期柱状图。
- **复习设置面板**：每日复习上限、每日新卡上限、起始 ease、「模糊」间隔倍率、学习步长（1/3/6/10 天多选）、恢复默认——getReviewSettings/updateReviewSettings，本地与默认合并逻辑对齐 web 的 mergeReviewSettings 行为（坏值静默回落默认）。
- **Session**（push 到新 stack 页 `app/review/session.tsx`）：顶部进度条；卡片单击翻面；正面=问题（cloze `{{...}}` 遮罩隐藏答案词，截图卡只显示图），背面=答案（去 cloze 标记）fallback example+confusionPoint；翻面后才可评分；底部三个大按钮「忘了/模糊/想起来了」（≥56px 高，各带间隔提示文案，对齐 web 的间隔计算展示）；面包屑显示卡片主题节点路径（mapPlacement）；「原文」按钮（有 anchor 时显示，先只 toast「网页端可见」占位，M2 再接文档）；队列空显示完成页「今天刷完了」+ 明天到期数（stats.forecast[1]）；返回 hub 刷新数据 + Tab badge。
- 数据流：`getReviewToday` → items 逐张 → `submitReviewFeedback(cardId, feedback)` → 本地 slice；对齐 web review.service.ts 的状态机。
- 复习 Tab badge 显示待复习数（评分后即时刷新，退出 session 回到 hub 也刷新）。

### 3. 今日页（app/(tabs)/index.tsx + src/pages/today/）
对齐 web today 页：
- 日期 + 问候语（dayGreeting/formatTodayLong 逻辑从 web today.service.ts 抄）。
- **捕获框**（核心）：多行 TextInput + 「扔进去」（createDocument 自动消化）/「问 AI」（createChat）两个按钮；草稿以问号结尾自动判定为提问（isChatQuestion 逻辑抄 web）；可选主题下拉（主题列表 + 内联「新建主题」对话框：标题+目标）；提交成功 toast + 清空。
- 主题建议 banner：接受（开题）/忽略（acceptTopicSuggestion/dismissTopicSuggestion）。
- 行动卡：待复习数 + 预计分钟 + 连续复习 streak，点击跳复习 Tab。
- 本周复盘卡：getLatestWeeklyReport（成功率/遗忘数），点击先 toast 占位。
- 统计条：总卡片/主题数/文档数。
- 最近动态（最近 5 个 job，类型图标 + 状态文案）；最近文档（4 条，pending 显示「消化中」、failed 显示失败样式）。
- 3s 轮询 pending 文档直到全部完成（对齐 web 的轮询策略，页面失焦暂停）。

### 4. 全局
- toast 组件（轻量，底部浮现自动消失）。
- 所有文案中文；主题 token 正确应用（浅色/深色都要可看）。

## 验收（全部必须通过）
1. `pnpm -F @inwit/mobile typecheck` 通过
2. `CI=1 pnpm -F @inwit/mobile exec expo export --platform ios --output-dir /tmp/inwit-export-g3` 成功
3. 复习 session 状态机逻辑（翻面→评分→下一张→完成页）抽成纯函数或 service 并有注释说明与 web 的对应关系
4. 不修改 apps/web、apps/server、packages/* 任何文件；不 git commit

完成后 stdout 输出：PASS/FAIL 逐条 + 文件清单 + 遗留问题。
