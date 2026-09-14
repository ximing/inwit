# V0 回归报告（2026-09-14）

方式：Claude 编排，grok 执行全部实现，CSI 驱动真实 Chrome 做端到端回归。
回归账号：regression@inwit.dev（inwit_dev 库）。

---

# V1 概念重构回归（2026-09-14，T16–T20）

范围：概念模型定稿（四实体：资料/卡片/主题/关联）、thread→topic 改名、知识地图主视图、主题 Agent、提议开主题。

| # | 场景 | 结果 |
|---|---|---|
| 1 | thread→topic 全量改名（表/列/API/路由/文案） | ✅ 代码 0 残留 |
| 2 | map_nodes 树 + 归属 API + 状态自动重算（learning→covered） | ✅ smoke 31/31 |
| 3 | digest 自动挂地图节点 | ✅ |
| 4 | 整理地图：5→11 节点（6 空白），卡片零丢失对账 | ✅ |
| 5 | 空白节点「让 AI 补」→ 生成入门卡进复习队列 | ✅ 36s 出 2 卡 |
| 6 | 主题页地图主视图（折叠树/状态点/节点侧栏/资料流） | ✅ 明暗皆验 |
| 7 | 提议开主题：5 篇 Rust 资料 → 建议 → accept → 建主题+归属+初始地图（8 节点） | ✅ smoke 21/21 |
| 8 | 建议幂等：dismiss 后 30 天不重复 | ✅ |
| 9 | 首页提议提示条（明暗主题） | ✅ |
| 10 | 单测 64 条、typecheck/build 全绿 | ✅ |

截图：t16-home、t19-map-light/dark、t19-node-panel、t20-banner-light/dark、t20-accept-map、final-map-light/dark

---

# V0.5 改版回归（2026-09-14，T11–T15）

范围：C 端化改版——「纸上学习」设计系统（明暗双主题）、文档为中心（tiptap）、卡片锚点与关联。

| # | 场景 | 结果 |
|---|---|---|
| 1 | captures→documents 数据迁移 | ✅ 12 行无损，cards.document_id 无孤儿 |
| 2 | 明暗双主题 + 三态切换（浅/深/跟随系统） | ✅ |
| 3 | 组件无写死颜色（hex 仅在 tokens.css） | ✅ |
| 4 | 文档主页：快捷捕捉条 / 写文档 / 线程切换 / 细线条目列表 | ✅ |
| 5 | tiptap 编辑器：浮动工具条、⌘S、2s 防抖自动保存、保存状态 | ✅ |
| 6 | 消化 Agent v2：anchor_text 逐字回引（3/3 精确命中） | ✅ |
| 7 | link_cards：Agent 自主建边（prerequisite/related + 人话 reason） | ✅ |
| 8 | 文档阅读页：批注黄锚点高亮 → 点击侧滑卡片面板 | ✅ 明暗皆验 |
| 9 | 卡片详情页：出处引用回跳（?anchor= 滚动定位）、相关卡片分组、删边 | ✅ |
| 10 | 复习页：大纸面翻面、2px 进度条、关联 N 张轻提示、新完成态文案 | ✅ |
| 11 | 单测 33 条、typecheck/build 全绿 | ✅ |

截图：theme-light/dark.png、t13-home/editor.png、t14-reading(-dark).png、t15-card/review(-dark).png、v05-doc-dark.png、v05-home-light.png

---

# 以下为 V0（T1–T10）回归记录

## 回归结果：全部通过

| # | 场景 | 结果 |
|---|---|---|
| 1 | 注册 → 登录 → 路由守卫 | ✅ |
| 2 | 新建线程（标题+目标） | ✅ |
| 3 | 线程内粘贴笔记 → 异步消化 → 2 张原子卡（概念/例子/易混点/标签） | ✅ 约 14s |
| 4 | 对话框问「L1 和 L2 正则化区别」→ Agent 先检索已有卡避免重复 → 1318 字回答 + 2 张卡 | ✅ 约 38s |
| 5 | 今日复习队列：抽认卡翻面、三档反馈、进度 2/2、完成态 | ✅ |
| 6 | 「模糊」反馈自动触发 evolve job | ✅ |
| 7 | 线程页：卡片数/捕捉数统计 | ✅ |
| 8 | 后台-任务队列：digest/chat/evolve 三个 job 全 done，耗时列示 | ✅ |
| 9 | 后台-Token 用量：chat/embed/rerank 分列（24.4k/775/384 tokens）+ 按天趋势 | ✅ |
| 10 | 后台-Agent 执行：下钻 steps 时间线（search_cards 473ms 入参/结果摘要） | ✅ |
| 11 | 设置-BYOK：五供应商（OpenAI/DeepSeek/Claude/智谱/百炼） | ✅ |
| 12 | AI 回答 markdown 渲染 + 长文折叠（T10 修复后复验） | ✅ |

## 冒烟测试（grok 侧，真实 LLM 无 mock）
- smoke-t3.sh 10/10、smoke-t4.sh 29/29、smoke-t5.sh 11/11、smoke-t6.sh 27/27、smoke-t9.sh 10/10
- 单测 18 条（SM-2 等）全绿；typecheck/build 全绿

## 已知小事
1. 复习页统计区有两个数字 0 含义不明（UI 小瑕疵，V1 打磨）
2. 线程目标在回归中显示「还没写学习目标」——CSI 自动化 fill 未触发 rab 状态的测试工具假象，非应用 bug（key_type 输入正常）
3. meilisearch.aimo.plus key 已失效，检索切到同机 7700 实例（.env 已更新）
4. 删除 capture 保留卡片（cards.capture_id SET NULL）——设计选择，见 t4-report

## 启动方式
```bash
pnpm dev                              # server:3020 + web:5190
pnpm --filter @inwit/server worker    # 消化/问答 Agent 队列
```
