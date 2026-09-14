# T14 简报 —— 消化 Agent v2（锚点+关联）+ 文档阅读页

依据：`docs/prd.md` §2.6，`docs/design-system.md` §5 / §6.2 / §7。前置 T11–T13。

## 做了什么

### 消化 Agent

`write_cards` 每张卡必填 `anchor_text`（原文逐字引用，prompt 明确禁止改写）和 `anchor_block`（段落号，从 1 计）。`read_document` 额外返回按空行切好的 `blocks[]`，方便模型对号入座。落库前 `resolveAnchor` 会把引用对齐回原文：先精确子串，再忽略空白，再退到指定段的首句——保证 `anchor_text` 能在 `content_md` 里找到。

新工具 `link_cards(cardId, targetCardId, type, reason)`：

- type：`same_concept` / `confusable` / `prerequisite` / `related`
- origin 固定 `agent`，reason 存人话
- 只允许从本轮新卡指向**旧卡**；每张新卡最多 3 条；重复边当成功返回
- digest 与 chat 都挂了这个工具；chat prompt 要求「回答若引用已有卡也建边」

digest / chat 完成后，若存在 `same_concept` 边，把一句「这和你学过的「X」是一回事的两种说法。」写入 `documents.link_hint`（不覆盖 chat 的 `answer`）。Agent 循环上限 16→24，给检索+建边留回合。

### 阅读页 `/doc/:id`

纸面与 T13 编辑器对齐：衬线、`800px` 纸、padding `48px 56px`。Markdown 渲染后对文本节点做精确（及忽略空白）匹配，命中包 `<mark class="anchor">`（`--anchor` 底 + 左 2px `--anchor-strong` 竖条）。多卡同段按引用分别包裹；同文合并 `data-card-ids`。跨节点做不到时退化为段落级 `.anchor-block`（本次实走 3 条引用全部精确命中，没有走降级）。

点击锚点 → 右侧卡片抽屉 `translateX` 200ms；概念 / 例子 / 易混点 / 标签 / 自测题 +「查看详情」（`/cards/:id`，页面留给 T15）。点纸面空白或 Escape 收起。顶部：返回、衬线标题、线程/时间/卡数、[编辑]。chat 文档文首仍展示 AI 回答；若有 `linkHint` 另起一句朱红淡底提示。

### 库

`0003_card_link_reason_doc_link_hint`：`card_links.reason`、`documents.link_hint`。`GET /api/cards/:id/links` 带出 reason。文档详情多 `threadTitle`。

## 真实 LLM 验收

新用户 `t14-smoke-*@inwit.local`，先消化一篇「反向传播」种子，再 POST 363 字「梯度消失」正文（含反向传播）。约 45s `digested`：

| 检查 | 结果 |
|---|---|
| 2 张卡 | 过 |
| `anchor_text` 非空 | 过 |
| 原文 `includes(anchor_text)` | 过（2/2） |
| `card_links` origin=agent | 过（prerequisite + related，reason 为人话） |
| `link_hint` | 空（本次没有 same_concept，梯度消失≠反向传播；符合「只对高置信 same_concept 写提示」） |

psql（同一用户）：

```
 origin |     type      | reason（人话）
 agent  | prerequisite  | 这张新卡讲梯度消失现象，而…
 agent  | related       | 这张新卡解释梯度消失为何导…
 agent  | prerequisite  | 这张新卡强调梯度消失/爆炸源…
```

`cards.anchor_text` 在对应 `content_md` 中 `in_doc = t`。

回归账号 `regression@inwit.dev` 再跑同一篇，3 张卡、3 条锚点均精确命中（0 段落降级）。Agent 还把它软归属到线程「机器学习基础」。

## 浏览器

`http://127.0.0.1:5190/doc/6c4629f9-…`（regression，CSI 真 Chrome）：

1. 阅读页标题、元信息（线程 · 刚刚 · 3 张卡）、[编辑] → `/editor/:id`
2. 三段批注黄高亮，左侧金条；点第一段 → 右侧滑出完整卡片（概念/例子/易混/标签/填空题）+「查看详情」
3. 点纸面标题空白处抽屉收起
4. 明暗主题高亮/纸面/抽屉都正常

截图：`docs/screenshots/t14-reading.png`（亮，抽屉开）、`t14-reading-dark.png`（暗，抽屉开）。

## 验收命令

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | dto / server / web 全绿 |
| `pnpm -r build` | 全绿；web vite 272 modules |
| `pnpm --filter @inwit/server test` | 5 files / 32 tests 全绿 |
| `scripts/smoke-t14.sh` | 10/10 PASS（真实 LLM） |

## 改动文件

### dto / db / server
- `packages/dto/src/card.ts`（link.reason）
- `packages/dto/src/document.ts`（linkHint、detail.threadTitle）
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0003_card_link_reason_doc_link_hint.sql`
- `apps/server/src/agent/anchors.ts` + `anchors.test.ts`
- `apps/server/src/agent/tools.ts` / `prompts.ts` / `digest.ts` / `chat.ts`
- `apps/server/src/documents/document.service.ts`
- `apps/server/src/cards/card.service.ts`

### web
- `apps/web/src/lib/anchors.ts` / `Markdown.tsx`（`AnchoredMarkdown`）
- `apps/web/src/pages/doc/`
- `apps/web/src/routes.ts`（`cardPath`）
- `apps/web/src/styles.css` / `tokens.css`
- `apps/web/src/pages/home/home.service.ts`（轮询带上 linkHint）

### 脚本
- `scripts/smoke-t14.sh`

## 遗留

- 「查看详情」链到 `/cards/:id`，页面在 T15。
- `link_hint` 只在 agent 建了 `same_concept` 时出现。这次「梯度消失 ↔ 反向传播」被标成前置/相关，没有写「是一回事」——这是 prompt 约束，不是漏写。
- 跨节点精确包裹已实现；空白差异走忽略空白匹配。再不行才段落级高亮。本次 3/3 精确命中。
- 本机 digest worker 已用 T14 代码重启（旧 worker 10:55 的进程不认识 `link_cards`）。
