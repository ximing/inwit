# T3 报告：digest/selection agent 契约改造 — (blockIndex, quote) 结构化引用

## 做了什么

Agent 看文档改为 `blocksFromPmJSON` 编号块视图，写卡改为 `(blockIndex, quote)` + `locateQuote`。旧的 markdown 模糊锚定链删除。server 仍不改文档 JSON（打 mark 是 T4 的事）。

### 编号块视图

- 新增 `apps/server/src/agent/card-anchor-logic.ts`：`numberedBlocksFromDoc` / `formatNumberedBlockView` / `resolveQuoteAnchor` / `inheritSelectionAnchor`
- 格式：`[块 N | 第 P 页] …`；pageBreak 块正文为 `（分页）`
- `read_document`（digest）不再返回 `contentMd` + 空行切段，改为 `blocks` + `numberedView`
- topic fill / analyze 的 `write_document` 返回值同样改为编号块视图，供随后 `write_cards` 对号入座

### `write_cards` 契约

- 参数从 `anchor_text` / `anchor_block` 改为 `blockIndex: int` + `quote: string`（`concept` / `example` / `confusion_point` / `tags` 保持）
- 建卡：`locateQuote(contentJson, blockIndex, quote)`
  - 成功 → `anchorText = quote`，`anchorBlockIndex = blockIndex`
  - 失败 → 卡片照建，`anchorText = quote`，`anchorBlockIndex = null`（不报错、不重试）
- chat 转卡复用同一 tool；topic fill / analyze 的 `write_cards` 描述与 prompt 同步

### selection（划词产卡）

- 路由/DTO 已有 `{ text, blockIndex }`（T2）
- agent 只产出 concept/example/confusion_point/tags，不再自己定位
- 每张卡继承用户划词：`inheritSelectionAnchor(contentJson, { blockIndex, quote: text })`
- 校验失败仍建卡、无锚（不再因匹配失败丢卡）

### evolve

- `split_card` 子卡可选 `quote` + `blockIndex`，同一套 locate；省略则继承原卡锚
- `read_card` 输出 `anchorBlockIndex`（不再把序号编成字符串 `anchorBlock`）

### 删除的降级链

- `anchors.ts` 仅保留 `buildAssociationHint`（digest 关联提示仍用）
- 删除 `resolveAnchor` / `splitMarkdownBlocks` / `parseAnchorBlock` / `sliceIgnoringWs` / `inferBlockIndex` / `firstSentence` 及其测试

未改 `apps/web`、未改 DB schema、未 commit/push。

## 测试

- 新增 `card-anchor-logic.test.ts`：编号块视图；write_cards 参数 → 卡片行锚字段（locate 成功 / 空白容错 / 失败无锚）；selection 锚继承（成功 / 失败仍无锚）
- `anchors.test.ts` 只测 `buildAssociationHint`
- `selection-logic.test.ts` 去掉 agent 自拟 `anchor_text` 约束

## 验收命令

```bash
pnpm -F @inwit/server typecheck     # 绿
pnpm -F @inwit/server test          # 36 files / 320 tests passed
```

## 遗留

1. **T4**：web 编辑器 / DocView / 划词提交 `blockIndex` / 打开文档后幂等补打 `cardAnchor` mark。
2. **T5**：编排验收与浏览器回归。
3. topic fill / analyze / weekly 的 `write_document` 入参仍是 markdown（写库前转 PM JSON，T2 边界），只是返回给模型的视图改为编号块。
