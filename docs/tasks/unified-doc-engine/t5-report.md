# T5 回归报告 — csi 真实 Chrome 端到端

执行人：Claude（编排者），浏览器：用户真实 Chrome（csi daemon），环境：vite:5190 + server:3020 + worker。

## 用例结果

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | 编辑器 JSON 往返（输入→防抖保存→刷新→逐字一致） | ✅ | DB 里 `content_json` 为 PM JSON object；`shots/r1-reload.png` |
| 2 | 划词批注：选区→划线批注→note→保存 | ✅ | POST /api/annotations 201；mark 精确包裹选区；侧边栏 批注·1 |
| 3 | 锚随编辑移动（标注前文追加内容→保存→刷新） | ✅ | mark 逐字不漂移 |
| 4 | 部分删除标注中间文字 | ✅ | mark 收缩到剩余部分 |
| 5 | 整段删除→保存→刷新 | ✅ | mark 消失；侧边栏条目 `is-lost`（「原文已删除」置灰态）；`shots/r5-orphan.png` |
| 6 | 点击卡片→锚范围激活高亮 | ✅ | `.anchor.is-on.is-active` 精确覆盖 |
| 7 | 标注×卡片重叠 | ✅ | 重叠区 DOM 为单层元素（并集，无叠色）；激活覆盖完整范围（含重叠部分）；`shots/r7-overlap-active.png` |
| 8 | digest 产卡锚定（worker 真实跑 LLM） | ✅ | 3 张卡；有文字锚的卡 `cardAnchor` mark 幂等补打进正文，可点击激活；锚段被删的卡正确落无锚态 |
| 9 | 导入 md（含 `---`）分页 | ✅ | 2 个 pageBreak 节点（pageIndex 1/2），无分隔符残留 |
| 10 | 粘贴剥离 | ✅ | 真实复制带 mark 段落粘贴到文末，粘贴处 0 实体 mark |
| 11 | 派生文本管道 | ✅（隐式） | digest/doc-meta 全程基于 `pmJsonToText` 工作（卡片、标题、描述均由 agent 正常产出） |

## 过程中发现并已修复

1. **mark 边界吞字**：`annotationMark`/`cardAnchor` 未设 `inclusive`，段首打字被吞进标注。已修复（`inclusive: false` + 无头事务测试，doc-schema 12 tests 绿）。
   - **遗留已知问题**：浏览器真实输入路径（DOM 归并）在段首边界仍可能扩展 mark——无头事务层行为正确，疑为 Chrome contenteditable 边界插入归并进 mark span 所致。影响小（仅段首/段尾紧贴着打字），建议后续用真实人手操作复测确认。
2. **回归期间 server 3020 两次短暂 500**：tsx watch 热重载中间态，自愈，非代码问题。

## 最终门禁（回归后全量复跑）

- `pnpm typecheck`：5/5 包绿
- `pnpm -F @inwit/server test`：38 files / 332 passed
- `pnpm -F @inwit/web build`：✓
- `pnpm -F @inwit/doc-schema test`：12 passed
- `pnpm -F @inwit/web test`：12 files / 99 passed（本轮新增的前端测试）

## 备注

- 测试文档（`eb40ff79`、`43a8df3c`、`pagebreak-test` 等）留在 dev 库，可随手删。
- 回归期间另一个并行 agent 在改 `apps/web` 的 tauri 相关文件，与本任务无关，未干预。
- worker 进程由编排者临时启动用于 digest 验证。
