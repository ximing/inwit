# T9 问答 Agent + 端到端收尾简报

## 做了什么

### chat API + 问答 Agent

- `POST /api/chat {question, threadId?}`（`authenticate`）：写 `captures(type=chat, raw_content=question, answer=null, status=pending)`，同事务入队 `jobs(type=chat, payload={captureId})`，**立即**返回 capture（`id` 即 captureId）。
- Worker `processChat`：pi-agent-core Agent，tools = `search_cards`（混合检索 pipeline）/ `write_cards`（最多 3 张，`source=chat`）/ `write_questions`。系统提示：先检索已有卡避免重复，用中文回答，再整理 1–3 张原子卡并出题。
- 回答文本写入新列 `captures.answer`，`status=digested`。无回答 / 无卡片为终端失败（job 标 done，capture 标 failed）；缺题可重试。
- 问答卡 `review_states.due_at = now`，立刻进入 `GET /api/review/today`（消化卡仍是次日）。
- `GET /api/captures/:id` 返回 `answer` + `cards`。

迁移：`apps/server/drizzle/0001_capture_answer.sql`（`ALTER TABLE captures ADD COLUMN answer text`）。DTO `captureSchema.answer`，`createChatInputSchema`，`isChatQuestion`（尾随 `?` / `？`）。

### 前端捕捉页

- 内容以问号结尾，或点「问 AI」，走 `/api/chat`；「扔进去」对非问句仍走 `/api/captures`。
- 时间线：用户气泡 + AI 气泡（pending 显示「正在回答…」）；下方自动生成的卡片默认折叠，点击展开 concept / 例子 / 易混点 / 标签。

### 收尾

- 根 `README.md`：简介、PRD 架构图、`pnpm install` / `migrate` / `dev` / `worker`、环境变量表。
- `docs/tasks/tN.md` prompt 保留；`t*-report.md` 内容整合进 `docs/dev-log.md`（原简报文件仍在）。
- `scripts/smoke-t9.sh`：真实 LLM，禁 mock。

## 启动方式

```bash
pnpm --filter @inwit/server migrate
pnpm --filter @inwit/server dev     # :3020
pnpm --filter @inwit/web dev        # :5190，/api → 3020
pnpm --filter @inwit/server worker
```

浏览器打开 http://localhost:5190 。问答需要 worker。

接口自检：

```bash
./scripts/smoke-t9.sh
```

## 验收输出摘要

| 检查 | 结果 |
|---|---|
| `pnpm -r typecheck` | 全绿（dto / server / web） |
| `pnpm -r build` | 全绿（web vite 113 modules） |
| `pnpm --filter @inwit/server test` | 18 条全绿（原 16 + `isChatQuestion` / `extractAssistantText`） |

`./scripts/smoke-t9.sh`（新用户 `t9-smoke-1789324517@inwit.local`，真实 qwen-plus，约 26s）：

```
PASS  unauthenticated chat is 401
PASS  register returns user.id
PASS  chat returns capture id
PASS  capture type is chat
PASS  capture status pending
PASS  capture status digested
PASS  answer nonempty (>=80 chars)     # 1189 字
PASS  answer mentions L1/L2/正则
PASS  cards >= 1                       # 2 张，source=chat
PASS  today queue includes chat cards  # 2/2
passed=10 failed=0
```

回答质量：中文对比 L1（Lasso，稀疏 / 特征选择）与 L2（Ridge，稠密收缩），含几何约束说明。两张卡各 2 道题（cloze / judge / compare）。

浏览器实走 http://localhost:5190（用户 `t9-web-1789324637@inwit.local`）：注册 → 捕捉页点「问 AI」（问题无问号）→ 用户气泡 +「正在回答…」→ AI 气泡全文 +「整理出 2 张卡」→ 点击展开可见例子 / 易混点 / 标签 → `/review` 今日队列 **0 / 2**。桌面 + 390px 窄屏都看过：窄屏侧栏改顶栏，卡片「展开」仍可点。

验收期间临时拉起的 server / web / worker 已停止，避免占用 3020 / 5190。

## 遗留

- evolve / weekly_report / thread Agent 仍是 stub。
- 问答气泡按纯文本渲染，模型若输出 Markdown 表格会显得乱，没有单独的 Markdown 渲染。
- 回答里偶尔夹杂「正在出题」一类过程句（工具调用前后的旁白），不影响知识点。
