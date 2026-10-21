# T31「概念图信息卡」验收报告

- 时间：2026-10-21
- 环境：dev web http://localhost:5190（用户真实 Chrome，CSI 驱动）
- 账号：m5-verify@test.local，主题「M5 验收」→ 概念 tab → 关系图
- 截图目录：/tmp/t31/

## 总体结论

**全部 13 项通过，无失败项。** 核心交互（节点信息卡、chip 跳邻居、跟随平移缩放、边缘裁剪、Esc 分层、边谓词关系卡、空白取消、索引视图直达详情、卡片吞滚轮、窄屏翻转、深浅色视觉）均符合预期，控制台无新增报错。

## 逐项结果

| 项 | 结果 | 现象 |
|---|---|---|
| A 单击节点出信息卡 | 通过 | 单击 Task：节点旁原地长出信息卡（衬线名称、定义「实验的基本单位。」、邻居 chip「Step → 回到」「包含 → Trial」、底部「详情 →」、右上 ×）；语境/别名/例子无数据不显示；右上角不再直接弹详情浮层；其余节点（面有多个 Step、Probe）变淡，只留一级关系。截图 /tmp/t31/A-node-card.webp |
| B chip 跳邻居 | 通过 | 点「包含 → Trial」：选中态跳到 Trial，卡片换锚点换内容（「Trial / Task 的一次执行。」，chip 变为「Task → 包含」「包含 → Step」）。截图 /tmp/t31/B-chip-jump.webp |
| C 平移/缩放跟随 | 通过 | 拖动平移：节点 (+130,+140)，卡片同步 (+130,+140)；滚轮放大：节点 y 695→935（变焦前 455→575 另一轮），卡片同量跟随；卡片字号始终 13px 不随缩放变化。截图 /tmp/t31/C-after-pan.webp、/tmp/t31/C-after-zoom.webp |
| D 出视口裁剪 | 通过 | 把 Task 平移出面板右缘（节点 x=1788 > 面板右缘 1621）：卡片被面板边缘裁剪（chip 文字截断在边缘），不溢出面板外（wrap overflow:hidden）。截图 /tmp/t31/D-clipped.webp |
| E 详情浮层交互 | 通过 | 点卡片「详情」→ 右上详情浮层（出处(1) 带定位原文、编辑/归档、加入复习），信息卡隐藏（/tmp/t31/E-detail-open.webp）；点浮层 × → 卡片恢复（/tmp/t31/E-detail-closed.webp）；再按 Esc → 卡片收起 |
| F Esc 分层 | 通过 | 详情浮层开着按 Esc：只关浮层，选中保留、信息卡回来。截图 /tmp/t31/F-esc-overlay.webp |
| G 边谓词关系卡 | 通过 | 点边 label「回到」：边中点长出关系卡「Step → 回到 → Task」+ 详情 + ×，边高亮（红）；解释/例子无数据不显示（/tmp/t31/G-edge-card.webp）；点「详情」→ 关系详情浮层（练习、出处(0) 暂无出处、编辑/归档）（/tmp/t31/G-rel-detail.webp） |
| H 点空白取消 | 通过 | 点空白：卡片消失、选中/高亮清除、所有节点恢复全不透明。截图 /tmp/t31/H-blank-click.webp |
| I 索引视图直达详情 | 通过 | 切到「索引」，点 Task 行：直接打开详情浮层，无中间卡片。截图 /tmp/t31/I-index-detail.webp |
| J 卡片不挡交互 | 通过 | 卡片上滚轮：图不平移不缩放（节点位置不变）；卡片外滚轮：正常缩放。卡片内容短无溢出，「卡片自身可滚动」未触发到（无足够长的概念数据） |
| K 窄屏翻转 | 通过 | 视口模拟 900px 宽：卡片从右侧翻转为节点下方，完整落在面板内不溢出；B 项中也观察到右缘节点的左翻转。截图 /tmp/t31/K-narrow.webp |
| L 视觉 | 通过 | 浅色：纸感暖白、圆角、柔和阴影，与全局一致（见 A/B 截图）；深色：卡片深底、文字清晰、淡化节点仍可读。截图 /tmp/t31/L-dark-card2.webp |
| M 控制台报错 | 通过 | 全流程 hook console.error/window.onerror/unhandledrejection，最终 `__errs` 为空 |

## 过程备注（非缺陷）

1. **CSI 工具坑（非应用 bug）**：CSI 的 `cdp Input.dispatchMouseEvent type=mouseWheel` 合成滚轮事件会把目标 tab 的扩展通道卡死（任何页面都复现，主页也一样；渲染进程无 CPU 空转）。本次改用在页面内 `dispatchEvent(new WheelEvent(...))` 完成缩放验证，应用本身滚轮缩放工作正常。
2. **自动化点击抖动（非应用 bug）**：整页 reload 后图有入场布局动画，动画期间按旧坐标点击会落空（表现为第一次点击无反应）；布局稳定后单击即选中并出卡。属自动化时序问题。
3. **操作事故已恢复**：验证中途误触「退出登录」，已用验收账号（m5-verify@test.local / m5-verify-pass，凭据来自 e2e/cases/concept-relations.md）重新登录，数据未受影响。
4. 深色主题验证后已切回浅色；所有 CSI 标签页已关闭。
5. 细节观察（可不管）：点空白取消选中后，`.concept-graph-wrap` 上的 `is-focused` 类仍残留（视觉无影响）。
