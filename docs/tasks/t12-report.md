# T12 简报 —— 设计系统落地（tokens / 双主题 / 骨架）

依据：`docs/design-system.md`。只改 `apps/web` 视觉与骨架，页面功能逻辑未动。文档列表/阅读页留给 T13。

## 做了什么

### Tokens（§2 / §3 / §4）

`apps/web/src/tokens.css`：`[data-theme="light"]`（白日书桌）与 `[data-theme="dark"]`（灯下夜读）两组颜色；字号阶、字体栈、圆角、间距、阴影、弹层遮罩 `--overlay-scrim` 一并落地。组件与页面样式全部走变量。

`apps/web/src` 内 hex / rgb 检索：除 `tokens.css` 外为 **0**。

### 主题机制

`ThemeService`（全局 rab Service，`light | dark | system`）：

- 写 `document.documentElement.dataset.theme`（resolved `light|dark`）
- `localStorage['inwit-theme']` 持久化，缺省 `system`
- `system` 时监听 `prefers-color-scheme`
- `index.html` 同步内联脚本，避免首屏闪错主题
- 全站 `color` / `background` 150ms 过渡；`prefers-reduced-motion: reduce` 时 duration 归零

入口：侧栏底部日/月 icon 按钮（按当前 resolved 切到对面显式主题）；设置页「外观」三态：浅色 / 深色 / 跟随系统。

### 骨架（§6.1 / §5 导航）

- 左侧 **220px** 细栏：`--bg-sunken`，仅 1px `--line`，无阴影
- 选中项：左侧 2px `--accent` 竖条 + `--accent-soft` 底
- 品牌衬线「Inwit」+ slogan「扔进去，它来消化」（`--ink-faint` / `--text-xs`）
- 导航：文档 / 复习 / 线程 / 设置 / **任务与用量**（后台降级到最后）
- 主区 `--bg-base`，正文 max-width 居中（文档向 680px，复习 560px）

### 基础组件（§5）

主按钮 / 次按钮 / 幽灵 / 危险；卡片（raised + shadow-1 + radius-md + 1px line，hover 只加 shadow-2）；标签；sunken 输入框；弹层 `--bg-overlay` + shadow-3，遮罩纯色无模糊；复习三档为语义色描边 + hover 淡底，不做大色块；`:focus-visible` 为 2px `--accent` + 2px offset。

字体：UI 无衬线；文档/卡片/抽认卡正文衬线（`--text-md` / 行高 1.8）。

## 验收

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | 全绿（此前整仓；本轮再跑 `@inwit/web` 全绿） |
| `pnpm -r build` | 全绿；web vite 118 modules |
| hex 除 `tokens.css` 外 | 0 |
| 亮主题截图 | `docs/screenshots/theme-light.png`（复习页） |
| 暗主题截图 | `docs/screenshots/theme-dark.png`（设置页） |
| 浏览器核对 | 文档/复习/线程/设置/任务与用量 + 新建线程弹层，亮暗均可看、不破版 |

## 浏览器核对时看到的、本任务未改的

捕捉页（现「文档」入口，时间线仍是 T11 形态）在 `regression@inwit.dev` 下会显示「服务器内部错误」。未改 `capture.service` / API；属既有数据/接口问题，T13 换文档列表时再处理。

复习页截图时队列已刷完（「刷完了」+ 近 7 天统计），三档反馈按钮在有卡时才会出现，样式已按规范切好。
