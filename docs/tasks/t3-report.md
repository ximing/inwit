# T3 认证 + BYOK LLM 配置简报

## 做了什么

在 `apps/server` 落地认证与用户级 BYOK LLM 配置，模型解析走 `@earendil-works/pi-ai@0.85.1`（同时装了 `@earendil-works/pi-agent-core@0.85.1`，本任务未使用，留给后续 Agent 任务）。`packages/dto` 补了注册/登录输入、LLM 配置入参，以及对外返回的 `apiKeyPreview`。

### 认证

| 路由 | 行为 |
|---|---|
| `POST /api/auth/register` | email + password，argon2id 哈希，201 + `{ user }` |
| `POST /api/auth/login` | 校验后写 cookie，`{ user }` |
| `POST /api/auth/logout` | 清 cookie，204 |
| `GET /api/auth/me` | 当前用户（挂 `authenticate`） |

**Token 策略（简化版，不落库）**：

- Access：JWT（`type=access`），httpOnly signed cookie `inwit_at`，TTL = `ACCESS_TOKEN_TTL_SECONDS`（默认 900s）
- Refresh：JWT（`type=refresh`），httpOnly signed cookie `inwit_rt`，TTL = `REFRESH_TOKEN_TTL_DAYS`（默认 30 天）
- 没有独立 `/refresh` 接口；`app.authenticate` 在 access 失效时用 refresh cookie 静默换发 access
- 选不落库是因为 T2 schema 没有 `refresh_tokens` 表，任务允许简化。无法做 reuse detection / 服务端吊销，logout 只清 cookie。

`fastify` 装饰器 `authenticate` 已挂上。`/health`、register/login/logout 公开；`/api/auth/me` 与全部 `/api/llm-configs*` 走它。后续业务路由同样 `{ preHandler: [app.authenticate] }`。

### BYOK LLM

| 路由 | 行为 |
|---|---|
| `GET /api/llm-configs` | 当前用户配置列表 |
| `POST /api/llm-configs` | 创建；第一条默认 `isDefault=true` |
| `PUT /api/llm-configs/:id` | 更新 model / apiKey / baseUrl |
| `DELETE /api/llm-configs/:id` | 删除，204 |
| `PUT /api/llm-configs/:id/default` | 设为默认（先清掉该用户其它 default，避开 partial unique） |
| `POST /api/llm-configs/:id/test` | ping 级真实调用，`{ ok: true }` 或 `{ ok: false, error }` |

- provider：`openai | deepseek | claude | zhipu | dashscope`
- `api_key` 落库前 AES-256-GCM 加密，密钥为 env `LLM_KEY_ENCRYPTION_KEY`（64 hex = 32 字节）。密文格式 `v1:` + base64url(iv ‖ tag ‖ ciphertext)
- 接口永不回显完整 key，只给 `apiKeyPreview` = 前 6 位 + `****`（例如 `sk-b08****`）

### 模型解析 + 用量

- `src/llm/pi.ts`：`resolveModelFor(userId)` 读默认 `llm_config` → 解密 → 组装 pi-ai `Models` + `Model`
  - openai / deepseek / zhipu / dashscope：`openai-completions` + `createProvider`
  - claude：`anthropicProvider`，provider id 映射为 `claude`
  - 无默认配置（或解密失败）→ 系统 DashScope：`DASHSCOPE_API_KEY`，OpenAI 兼容 `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-plus`
- `src/llm/usage.ts`：`completeChat` 封装调用；成功/失败都写 `llm_usage_logs`（`capability=chat`）。失败行 token/cost 为 0。

## 验收输出摘要

`pnpm -r typecheck && pnpm -r build` 全绿（dto / server / web）。

`./scripts/smoke-t3.sh` 启动 tsx 服务、跑 curl、psql 抽查后关掉进程：

```
== T3 smoke @ http://127.0.0.1:3020 ==
starting server...
-- POST /api/auth/register
{"user":{"id":"e823898f-29dd-4ce2-9503-a40bb3c70dd2","email":"t3-smoke-1789317156@inwit.local","createdAt":"2026-09-13T16:32:36.793Z","updatedAt":"2026-09-13T16:32:36.793Z"}}
PASS  register returns user.email
-- POST /api/auth/login
{"user":{"id":"e823898f-29dd-4ce2-9503-a40bb3c70dd2","email":"t3-smoke-1789317156@inwit.local","createdAt":"2026-09-13T16:32:36.793Z","updatedAt":"2026-09-13T16:32:36.793Z"}}
PASS  login returns user.email
-- GET /api/auth/me
{"id":"e823898f-29dd-4ce2-9503-a40bb3c70dd2","email":"t3-smoke-1789317156@inwit.local","createdAt":"2026-09-13T16:32:36.793Z","updatedAt":"2026-09-13T16:32:36.793Z"}
PASS  me returns user
-- GET /api/llm-configs without cookie → 401
status=401 body={"error":{"code":"INVALID_TOKEN","message":"登录已过期"}}
PASS  unauthenticated llm-configs is 401
-- POST /api/llm-configs (dashscope / qwen-plus)
{
  "id": "03ad3f0d-d869-48f2-b4a2-5d0d48a0bc80",
  ...
  "apiKeyPreview": "sk-b08****",
  ...
}
PASS  created config has masked key
PASS  preview is not the full key
-- GET /api/llm-configs (list mask)
PASS  list key is masked
-- POST /api/llm-configs/:id/test
{"ok":true}
PASS  test returns ok:true
-- psql: api_key_encrypted is not plaintext
encrypted_prefix=v1:KajLPQZS9QBWLcrGy v1=t not_plain=t
PASS  ciphertext starts with v1:
PASS  ciphertext does not contain plaintext key

passed=10 failed=0
```

`llm_usage_logs` 抽查（该 smoke 用户、test ping）：

```
 provider  |   model   | capability | prompt_tokens | completion_tokens | total_tokens
 dashscope | qwen-plus | chat       |            13 |                 1 |           14
```

## 遗留问题

- Refresh JWT 不落库：logout / 改密无法服务端吊销已发出的 refresh。若后续要多端踢下线，需加 `refresh_tokens` 表并改签发路径。
- 未做登录/注册限流（vital 有，本任务未要求）。
- `pi-agent-core` 已入依赖，T5 Agent 任务再接线。
