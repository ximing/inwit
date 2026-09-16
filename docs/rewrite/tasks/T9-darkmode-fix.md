# T9 · 修复：深色模式主区域背景

先读 `docs/rewrite/CONTEXT.md`。

## 问题

切到深色模式后：rail、卡片、按钮都正确变暗，但**主内容区的页面背景仍是浅色米色**（`--bg` 没跟着切）。截图现象：`/` 首页右侧大块区域是浅色底 + 深色卡片，对比刺眼。

## 排查方向

- `apps/web/src/styles.css` 里深色 tokens 的选择器（`[data-theme="dark"]` 或 `.dark`）是否覆盖了 `--bg`/`--bg-sunken`
- `body`、`#root`、`.shell`、`.main` 上是否有写死的背景色（浅色 hex），没用变量
- 各页面级容器（today/docs/review/jobs/topics/settings 的最外层）是否有自己的浅色背景覆盖

## 要求

- 深色下整页（含 body、main、各页面容器）呈现一致的"灯下夜读"暗色纸质背景，卡片/边框/文字对比度可读
- 浅色模式完全不变
- 切换无闪烁残留

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/web build` 通过
- 深色模式逐页（/ /docs /review /topics /jobs /settings）目检无浅色块残留
