# T29 浏览器验收报告（csi / 真实 Chrome）

日期：2026-10-05 12:15–13:00。会话 t29-verify，账号 regression@inwit.dev。
环境：web :5190、server :3020 在跑；worker 验收中途重启过一次（见「weekly_report」节）。
截图均为 webp，存 /tmp/t29-*.webp。

**环境性说明（影响所有翻转的观测时延）**：csi 驱动的新标签页在用户 Chrome 里处于后台（`document.visibilityState = hidden`），Chrome 把后台页 setInterval 节流至约 1 次/分钟。POLL_MS=3s 的轮询实际约 60s 才 tick 一次，因此下文所有「翻转检测」都比 DB 真实翻转晚 0–90s。这是验证环境伪影，不是产品问题；前台使用时翻转应在数秒内出现。

## 1. 主流程 live 翻转 — 通过

- 12:17 capture 一句话 → 自动打开新文档（sync 激活，URL 带 `?doc=`），行内出现 T28 皮肤「✦消化中…」，文档窗格标题下显示「消化中…」（/tmp/t29-02-pending-digesting.webp）。
- 该句以「？」结尾，`submit('auto')` 按既有规则路由为 chat job（行带「AI 回答」徽标）——产品既有行为，非本次问题。
- **不刷新、不离开文档视图**，12:20 前后「消化中…」live 消失、卡数「3 卡」出现、行标题更新为「SM-2 难度因子与间隔计算」（/tmp/t29-03-digested-live-flip.webp）。
- 为覆盖纯 digest 路径，又连投两句无问号 capture（见第 4 项），两句均在停留在文档视图的情况下 live 翻转，打开文档的窗格标题从「无标题」live 更新为「艾宾浩斯遗忘曲线」、主题徽标、右侧卡片栏 2 张卡 live 出现（/tmp/t29-06-both-flipped.webp）。

## 2. 编辑器保护 — 通过

- 消化进行期间在打开的文档正文连续打字约 40s（每 2s 一个编号 token，共 20 个）：20/20 token 全部按序存在，无丢字、无回跳（len=171）。
- 翻转发生后再次校验：token 全在、顺序正确、`document.activeElement` 仍在编辑器内（光标未被抢走）。
- 残留空白：打字覆盖了消化中段，翻转落点前后各有一次完整性校验，但没有做到「翻转那一秒正好在击键」。合并路径只写元字段（mergeDocMeta 不碰 contentJson），风险可接受。

## 3. PDF 导入全阶段 — 通过（一处无法捕获）

- 12:26 经隐藏 file input 导入真实 1 页 PDF（cupsfilter 生成）→ 自动打开 PDF 文档，PDF 窗格渲染、行带「导入」tag、「✦消化中…」与窗格「消化中…」（/tmp/t29-07-pdf-uploaded.webp、/tmp/t29-08-pdf-digesting.webp）。
- 小文本 PDF 的 upload→extract 在秒级完成，**「提取中」阶段 tag 来不及被截图捕获**；extract 完成的旁证：today 页「最近动态」出现「提取完成 ·「t29-import」」（/tmp/t29-10-today.webp），DB 中 extract job done。
- 12:31 行 live 翻转为「导入 3 卡」，再次打开该文档：卡片栏 3 张填空卡、状态全绿（/tmp/t29-12-pdf-flipped.webp）。

## 4. 多文档独立翻转 — 通过

- 12:21/12:22 连投两句 capture，列表同时两行 pending（/tmp/t29-04-two-pending.webp）。
- 过渡态观察到一行已出「2 卡」而另一行仍在消化，无串状态（/tmp/t29-05-mixed-state.webp）。
- 最终各自独立翻转：「费曼技巧与理解缺口 / 机器学习基础 / 2 卡」与「艾宾浩斯遗忘曲线 / T4 验证主题 / 2 卡」（/tmp/t29-06-both-flipped.webp）。

## 5. 回归 — 通过（含一条既有小瑕疵记录）

- **sync 未激活（不开文档停在列表）**：12:39 投一句后立即关闭文档视图，12:43 列表行照常翻转出「3 卡」（/tmp/t29-09-list-only-flip.webp）。
- **today 页**：最近动态正确显示「消化完成/提取完成/主题进化」等翻转，统计卡正常（/tmp/t29-10-today.webp）。
- **T28 AI 皮肤无回退**：✦消化中 高亮皮肤、卡数出现均在（静态 webp 无法证明流光动画，皮肤元素在位）。
- **既有小瑕疵（非 T29 引入）**：sync 未激活时，行状态翻转后该行的标题/描述/主题可能停在原始 capture 句子（如「交错练习…」行翻转后 4 分钟仍是原句标题；DB 早在 12:42:35 已写好新标题「交错练习与集中练习」）。机制：digest 的状态翻转与 meta（标题/描述）写入是两步，翻转那次 fetch 若先于 meta 写入，随后 `syncPolling()` 因无 pending 直接停轮询，行的标题/描述/主题要等下次列表加载才补上（12:50 回列表后已正常显示）。T29 未改动该路径（sync 未激活走原有 refreshOne 全量合并），属既有行为；sync 激活时无此问题（标题经 sync 通道 live 更新，见第 1 项）。

## 6. weekly_report（server 侧）— 通过，真实触发

- 12:01 的 hourly 扫描留下的失败 job（demo 用户 a1000000，`weekly report document missing card links for relearn concepts`，3 次重试耗尽）运行的是**修复前**代码：worker 进程 11:01 启动，修复文件 12:11 才落盘。
- 12:46 重启 worker（新 pid 91743，日志 /tmp/t29-worker.log）加载修复代码；启动扫描立即重新入队本周周报。
- **demo 用户（10 张 lapse 卡，relearn 分支真实触发）**：job `bc1a0feb` 一次通过、16.9s 完成，周报文档 `ff53536f`「10/5–10/11 学习复盘」content_json 含 `/cards/` 链接（link mark）——旧校验必挂的场景在新校验下正常收尾。
- regression 用户 job `76747cf0` 同样一次通过（50.4s）；该用户当前无 lapse 卡，报告无卡链，属正常降级。
- DB 复核：`select ... from jobs where type='weekly_report'` 两条新 job 均 `done / attempts=1 / 无错误`。

## 问题清单

1. **P2 待人工确认：来源不明的重复文档**。12:49:19 出现文档 `8c90cb94`（source='editor'，正文与 12:39:19 的 capture 文档 D 一字不差），digest job 同事务入队。已排除：csi 本标签页（该时段只读操作、代码中无 10 分钟定时器）、PAT/移动端（access_token_logs 无记录）、本验证脚本的后台循环（逻辑上从未发出写操作）。exactly 10 分钟后同秒创建指向某种重放/自动保存边缘，也可能是人或其他标签页操作。**请确认 12:49 前后是否动过该浏览器**。其 digest job 因 editor 10 分钟空闲延迟约在 12:59:19 后执行，若不处理会为该重复文档再切一轮重复卡片（测试数据，可自行删除 8c90cb94 清理）。
2. **P3（既有，非 T29）**：sync 未激活时行翻转后标题/描述/主题可能滞留至下次列表加载（机制见第 5 项）。建议另立小任务：翻转后保留 1–2 个收尾 tick 或翻转时若 detail.updatedAt 晚于本地则补一次全量合并。
3. **提示（非问题）**：capture 以「？」结尾会被 auto 路由为「问 AI」（chat job），验收纯 digest 路径需用陈述句。

## 备注

- 重启后的 worker（pid 91743，日志 /tmp/t29-worker.log）保持运行，加载的是含修复的代码；原 11:01 启动的旧 worker 已停。
- 本次验收产生的测试文档（5 篇 capture + t29-import + 2 篇周报）留在 dev 库中。

---

## P3 回归（FlipFollowUpScheduler，2026-10-05 13:10–13:30）

修复：翻转文档在 4s/10s 各补拉一次 meta（sync 激活走 refreshOneMeta，未激活走 refreshOne 全量合并）。回归期间用 `Page.bringToFront` 把 csi 标签页带到前台（`visibilityState=visible`），排除了上轮的后台节流伪影；两次翻转均在 DB digested 后 ~3–13s 内出现在 UI。

1. **sync 未激活（留在列表）— 通过**。13:14:17 投「必要难度理论…」一句并立即关闭文档视图；13:17:38 翻转检测时行已直接带全量 AI meta：标题「必要难度理论与三种学习手段」+ 描述 + T4 验证主题 + 2 卡，无手动刷新（/tmp/t29-regression-01-list-flip-with-meta.webp）。对照修复前同路径（交错练习行翻转后 4 分钟仍是原始 capture 文案），P3 消除。补充：本次 DB meta 写入（13:17:35.6）与翻转 tick 几乎同刻，无法严格区分 meta 是由翻转那次全量合并带入还是 4s 补拉带入，但验收标准「翻转后 ~15s 内 meta 到位、无需手动刷新」满足。
2. **sync 激活（打开文档）— 通过**。13:19:24 投「间隔效应…」一句并保持文档打开；消化期间在正文打了 5 个 token（回归01–05）。13:24:07 DB digested，13:24:20 UI 翻转：行已带全量 meta「间隔效应：分散学习与持久记忆」+ 描述 + T4 验证主题 + 2 卡；编辑器窗格标题同步 live 更新，卡片栏 2 卡出现（/tmp/t29-regression-02-sync-flip-with-meta.webp）。
3. **无回退 — 通过**。编辑器 5/5 token 在翻转后完整、焦点仍在编辑器内（翻转瞬间 sync 通道给原句加卡片划线高亮，未触碰打入的文字）；翻转后无 pending 轮询停止的逻辑未变（本次修复只在 tickPending 增加翻转检测与一次性补拉定时器）；T28「✦消化中…」皮肤在两轮消化期间均在位。
4. 旁证：上轮的重复文档 8c90cb94 已不在列表中（疑似已被人工清理）；上轮 P3 的滞留样本「交错练习…」行在列表重载后显示为完整 meta「交错练习与集中练习」。
