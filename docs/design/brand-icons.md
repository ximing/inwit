# inwit 应用图标（Icon）生成方案

> 单一真相来源：`packages/brand/src/logo.svg`（字形）+ `packages/brand/scripts/raster-icons.mjs`（渲染管线）。
> 改图标只改这两处，然后跑 `pnpm --filter @inwit/brand raster-icons`，**不要手改各端 PNG/ICO/ICNS**。

## 设计决策（2026-09 定稿）

- **方案**：B1-b「豆入门」——小写 `in` 字标，`n` 的拱是一道门，门洞里一颗豆子：「扔进去（in）」。与产品内核「扔进去、AI 消化、催你复习」对应。
- **色板**（与设计稿 v2 一致）：朱砂红 `#B3402A` 字形；纸面渐变 `#FFFFFF → #F7F3EC` 纸砖；描边 `rgba(34,29,22,0.08)`。
- **形态**：圆角纸砖 + 四角透明（squircle 连续曲率圆角，非普通圆角矩形）。不用满幅白底。
- 历次方案对比页留档：`docs/design/icon-options.html`（v1）～`icon-options-v4.html`（终选）。

## 管线结构

`raster-icons.mjs` 用 `@resvg/resvg-js` 渲染 SVG（ImageMagick 自带 SVG 渲染器画不出 stroke，不可用），`png-to-ico` 打 ICO，`iconutil` 打 ICNS。

关键比例规则（改之前先读懂）：

| 目标 | inset（纸砖占画布） | 字形比例 | 说明 |
|---|---|---|---|
| web / mobile / Win·Linux | 6%（纸砖 88%） | 原尺寸铺满 | 字形与纸砖等比，由 `BASE_TILE_SPAN=0.88` 保证 |
| macOS `icon.icns` | 10%（纸砖 80%） | 随纸砖等比 | Apple HIG：1024 画布可见图形 ≈824px（80%），否则 Dock 里偏大 |
| Android `adaptive-icon.png` | —（透明前景） | 0.78 | 字形须在 adaptive mask 安全区（圆形 mask 直径 ≈61% 画布）内 |
| `tray.png` | —（纯字形） | 0.9，黑色 | macOS 菜单栏模板图标，系统着色 |

## 各端输出

- `apps/web/public/` — `favicon.svg`（矢量纸砖）、`favicon.ico`（16/32/48）、`apple-touch-icon.png`（180）
- `apps/mobile/assets/` — `icon.png`（1024，iOS/splash 共用）、`adaptive-icon.png`（1024，`app.json` 已引用，背景色 `#f6f3ec`）
- `apps/desktop/src-tauri/icons/` — 16/32/128/128@2x/256/`icon.png`（512）、`icon.icns`、`icon.ico`、`tray.png`
- `packages/brand/design/` — 预览副本（app-icon.png、tray.png）

## 注意事项

- **iOS 图标官方要求不透明**：目前按产品决定使用透明纸砖；若真机出现黑角或 App Store 校验报错，单独把 `apps/mobile/assets/icon.png` 换成满幅版即可。
- 浏览器 favicon 有缓存，验证时需强刷或清站点数据。
- Windows/Linux 端纸砖保持 88%（平台惯例更饱满），只有 macOS 收到 80%。
- 调 Dock 里 mac 图标大小：改 `writeIcns` 里的 inset（`0.1` → `0.12` 更小）。
