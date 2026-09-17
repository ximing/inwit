# RN 客户端交付报告（G1–G5）

> 编排：Claude；实现：grok headless（任务书见本目录 g1–g5）；验收：每任务独立复跑 + CSI 实测。分支 `feat/unified-doc-engine`，未提交，等人工检查后提交。

## 交付物

| 模块 | 位置 | 内容 |
|---|---|---|
| WebView 文档引擎 | `packages/doc-engine` | 只读 tiptap 引擎（无 React，@tiptap/core 直挂 DOM）、bridge 协议 v1（`src/protocol.ts` 唯一事实来源）、vendor 拷贝（extensions/anchor-highlight/entity-marks/anchors/pm-doc）、asset 注入 map、自绘划选工具条、深浅主题、演示页 |
| Expo 应用 | `apps/mobile` | M0 骨架（expo-router 六 Tab、theme tokens、PAT 登录流、Bearer api client）；M1 复习闭环（Hub/Session/设置面板/SVG 图表）+ 今日页（捕获框/建议 banner/行动卡/周报卡/统计/最近动态/3s 轮询）；M2 文档列表 + 整页 WebView 阅读页（锚点/批注 Sheet、划选三动作、深链 focusCard、搜索）+ 引擎产物同步脚本；M3 主题（列表/详情/图谱树/动态）、任务（队列/用量/历史）、我的（资料/外观/BYOK/OCR/令牌/退出） |

## 验收记录

- G1：typecheck ✅ / vitest 13 ✅ / build 731KB 单文件 ✅ / **CSI 实测**：锚点点击、批注点击、划选（from/to/blockIndex 精确 + viewport rect）、assetNeeded→注入出图、深浅色、划选工具条全通 ✅
- G2：mobile/web/server 三端 typecheck ✅ / expo export iOS ✅
- G3：typecheck ✅ / expo export ✅ / 真实链路冒烟（Bearer PAT 打 me、review/today、review/stats、topics、reports/latest 全 200）✅
- G4：typecheck ✅ / 命令排队单测 4 ✅ / export 产物含引擎 html ✅
- G5：typecheck ✅ / expo export ✅
- 终验：全仓 typecheck ✅ / server 332 tests ✅ / web build ✅ / **CSI web 回归**（首页/文档/复习/主题/任务/设置六页真实数据正常渲染）✅
- 禁区核查：apps/web、apps/server、packages/dto/doc-schema/markdown 零改动（git status 确认）✅

## 如何验收（真机/模拟器）

```bash
pnpm dev                                # server :3020（若已在跑可跳过）
pnpm -F @inwit/doc-engine build         # 引擎产物（改动引擎后需要）
pnpm -F @inwit/mobile start             # prestart 会自动 sync 引擎 html
# Expo Go 扫码；真机需把 src/config.ts 的 baseUrl 改局域网 IP（有注释）
```

登录任意账号即可（app 会自建/复用 `inwit-mobile` PAT，web 设置页可吊销）。

## 已知遗留（下一阶段）

1. **M4 未开工**：编辑器（引擎 editable 态 + 底部格式条）、文件导入（multipart）、PDF 阅读、截图批注。
2. 底部 6 个 Tab 小屏略挤（可考虑「任务」并入「我的」）。
3. 图谱是缩进树，非 web 泳道布局（按方案 §5 有意为之）。
4. 复习「原文」跳转、周报跳转是 toast 占位（依赖 M2 已完成，可接线）。
5. spike 任务书的 P0 真机项（触屏划选手势、系统 callout、选择手柄冲突）**浏览器已验，真机未验**——首次真机运行阅读页时重点观察。
6. 引擎 HTML 打进了 export 包，但 WebView 内的真机渲染性能（长文档）未测。
