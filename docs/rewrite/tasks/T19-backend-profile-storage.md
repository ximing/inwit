# T19 · 后端：个人资料 + S3 签名下发的头像存储

先读 `docs/rewrite/CONTEXT.md`。

## 背景现状（已核实）

- `users` 表只有 email/passwordHash/reviewSettings（schema.ts L45）；User DTO 在 `packages/dto/src/user.ts`
- **没有任何对象存储配置**——需要新建 storage 模块，env 驱动
- 项目规范要新增一条（见任务 4）

## 任务

### 1. users 表加字段（drizzle migration）

- `display_name varchar(64)`（可空）、`avatar_key varchar(255)`（可空，存对象 key 不存 URL）
- DTO `user.ts`：`User` 加 `displayName: string | null`、`avatarUrl: string | null`；新增 `UpdateProfileInput = { displayName?: string(1-64), email?: string }`

### 2. storage 模块（`apps/server/src/storage/`）

- `client.ts`：`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`，从 env 读 `S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY / S3_FORCE_PATH_STYLE`；**未配置时所有入口抛 503 `STORAGE_NOT_CONFIGURED`**（优雅降级，不影响其他功能）
- `presign-logic.ts`（纯逻辑 + 测试）：`avatarKeyFor(userId, contentType)` → `avatars/<userId>/<uuid>.<ext>`（mime→ext 白名单 image/jpeg|png|webp，其它拒绝）；`validateAvatarUpload(contentType, sizeBytes)` 限 5MB
- `presignPut(key, contentType)`、`presignGet(key, ttlSec=3600)`

### 3. 接口（auth 或新 users 模块，遵守分层模式）

- `PATCH /api/me` — 改 displayName / email（email 要查重，冲突 409 `EMAIL_TAKEN`）
- `POST /api/me/avatar/upload-url` 入参 `{contentType, sizeBytes}` → `{uploadUrl, key}`（presigned PUT，15 分钟有效）
- `POST /api/me/avatar` 入参 `{key}` → 校验 key 前缀属于该用户 → 落 users.avatarKey → 返回 User
- **User DTO 的 avatarUrl 由服务端在 mapper 里实时 presignGet 签发**（1h 过期），客户端永远不接触 storage 凭证；`/api/auth/me`、登录、注册、PATCH /api/me 的返回都带上

### 4. 项目规范（写进 `CLAUDE.md`）

在 CLAUDE.md 加一节「文件/图片访问规范」：**所有图片与文件的上传/访问一律由服务端接口层签发 S3 presigned URL（PUT 上传、GET 读取带过期时间）；客户端禁止持有 storage token、禁止直连 bucket 二次获取；DB 只存对象 key，不存 URL。**

### 5. dev 环境 S3

- 加 devDependency `s3rver` + script `dev:s3`（端口 4569，数据目录 `.tmp/s3`，地址 127.0.0.1，path-style），在 `.env` 追加 dev 用的 S3_* 配置指向它（bucket 名 inwit-dev；s3rver 不校验凭证，任意 key 即可）
- 用 tsx 起个一次性脚本或直接用 node 跑通：起 s3rver → 创建 bucket → presignPut → PUT 一个文件 → presignGet → GET 回来内容一致，验证通过后写在任务总结里（脚本留 scripts/dev-s3-smoke.mjs 也行）

## 验收

- `pnpm typecheck`、`pnpm -F @inwit/server test`、`pnpm -F @inwit/web build`（dto 变了）全过
- migration 执行到远程 dev 库
- curl 实测：PATCH /api/me 改 displayName/email（含 409 冲突）；avatar upload-url → PUT → confirm → /api/auth/me 返回带 presigned avatarUrl 且能 GET 到内容；未配置 S3 时 503（可临时注释 env 验证后恢复）
- CLAUDE.md 规范已写入
- 不启动/停止 dev server / worker（s3rver 可以起，验收完保留跑着，4569 端口）
