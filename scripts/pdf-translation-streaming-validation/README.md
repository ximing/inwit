# PDF 翻译流式独立验收

本目录由独立验收 Agent 维护。服务实现与 Web 实现由另外两位 Agent 负责。

## 隔离约束

- 只使用显式 localhost PostgreSQL，创建独立 schema；拒绝默认 `.env.test` 远程库。
- API 与 worker 必须分别启动进程；mock 供应商只使用本地假凭据。
- 不停止用户现有 API、worker 或持久本地服务；验收只清理自己创建的进程/schema。
- 所有模型请求数由 mock 供应商计数，重连与回退不能增加次数。

## 必须验证的故障边界

1. 分段延迟供应商响应，SSE 首个非空 draft 在 terminal 前出现；终态保存全量译文和原始 usage。
2. SSE 断线重连以持久 snapshot 恢复；丢失 NOTIFY 后仍从 PG 补偿读取，不能依赖进程内事件。
3. 多 tab 共享同一个任务和一次供应商请求；SSE/GET 只读，不能重新派发。
4. worker 在 dispatched 后中断，恢复为 unknown，partial 不进入缓存，也不自动重派。
5. 截断/失败保留可辨别的 partial，不设置正式 currentTranslationId；显式重试遵守原有未知计费确认。
6. 每次发送重新检查用户归属和文档未软删；连接中的软删及时结束；不存在/跨用户资源不能泄露草稿。
7. seq 乱序/重复不回退文本；terminal 不会被迟到 active snapshot 覆盖；job/stream/document epoch 隔离。
8. 慢客户端背压不产生无界队列；断开只退订，不取消模型。
9. 取消与派发互斥、旧 worker token 不得覆盖新执行。

执行结果将在真实运行后记录，本文不作为通过证据。

## 实际执行与独立审阅结果（2026-11-18，Asia/Shanghai）

```sh
scripts/pdf-translation-streaming-validation/run.sh
# 最新连接释放幂等修复后定向复核：
PDF_STREAM_RESULT=scripts/pdf-translation-streaming-validation/close-results.json \
  scripts/pdf-translation-streaming-validation/run.sh -t 'graceful close'
```

完整运行 **9 项通过，1 项 browser hold 因环境开关跳过**；最新小修定向 **1 项通过，9 项筛选跳过**。无 unhandled errors。见 `results.json`、`close-results.json`。

- API、worker 各自独立 OS 子进程，真实 HTTP、真实本地 PG 与现有 queue/processor；模型调用经过实际 pi-ai SDK。仅 DNS 公网检查和 SDK HTTP 传输被本地假供应商替代。未使用用户密钥。
- 首个非空 SSE 草稿比 terminal 早 **1444 ms**（此一轮延迟 mock 的单次值，不是供应商延迟基准）。双 tab 及断线重连合计 **1 次**供应商调用；最终 usage 为原始 19 / 8 / 27。
- 在专用 schema 临时禁用该流触发器，持久更新草稿后，SSE 在 **627 ms** 内通过定期 PG 读取补偿。测试后启用触发器，最终删除整个专用 schema。
- 截断输出可见 partial，但任务 failed、`LLM_OUTPUT_TRUNCATED`，`currentTranslationId` 仍为 null。
- 跨用户 SSE 404；已连接文档软删后收到 `RESOURCE_UNAVAILABLE` 并关闭。
- 错误 execution token 写入被拒绝；dispatched 取消 409；queued 取消后重启 worker，供应商调用为 0。
- 慢客户端暂停 HTTP 响应读取，写入 8 个各 30 万中文字的快照；正常 tab 能看到最新快照，GET 仍可读。结合代码审阅确认背压期间仅合并一次 pending refresh，无每 token 或每 snapshot 的无界 JS 队列。本测试没有做长时间 RSS/压力基准。
- 实际 SIGKILL 自建 worker，模拟业务租约与 carrier 心跳过期后恢复 unknown，partial 不缓存，重启 worker 不重派。过期时间使用测试 DB 调整，未等待真实两分钟租约。
- 故意延迟 LISTEN 200 ms，保持 active SSE 时优雅关闭 app；关闭完成且 PG listener 无借出连接。独立审阅发现的关闭竞态由 backend 修复为 preClose 关闭 SSE、onClose 等待 listener 初始化后幂等释放，定向复核通过。

独立审阅覆盖 `translation-draft.ts`、`translation-stream.ts`、`processor.ts`、`translation-call.ts`、0047 迁移及 auth 的流式复核。确认 doc → content → task 锁序、执行 token / generation / activeJob CAS、最终提交先等待 draft flush、终态 seq 递增、只有完整成功进入缓存、流断开不取消模型、每次 snapshot 复核权限、NOTIFY 只含 ID 而不含正文。当前此范围无未关闭阻断项。

未在此重复验证 Web 乱序 seq / 旧响应过滤：由 backend 独立审阅 Web 与专项测试负责；真实浏览器交互由 review_acceptance Agent 执行。这里未测试真实供应商、生产代理/负载均衡、超长负载 RSS 或多台机器网络分区，不将本地 mock 结果宣称为这些环境的保证。

## 浏览器隔离环境

```sh
PDF_STREAM_HOLD=1 scripts/pdf-translation-streaming-validation/run.sh
```

准备后读取 gitignored `browser-ready.json`，另起仅本次使用的 Vite `127.0.0.1:5192`，将 `/api` 代理到其中 API 地址。`WEB_ORIGIN` 明确为 `http://127.0.0.1:5192`，与用户常驻 localhost:5190 cookie 隔离。假用户、密码仅用于此独立 schema；BERT 原件为已有真实样本，合法 fileKey，真实 PDF 引擎建立索引。提供 ready 前预检 `/file`、PDF 字节与首页面段落均成功。供应商 GET `/state` 查看调用数；验收结束 POST `/stop` 退出 hold，清理自己创建的进程、临时目录和 schema。

验收脚本外审：backend SubAgent 独立只读审阅 `run.sh`、`process.test.ts`、`independent.test.ts`，确认显式本地 PG、schema 前缀与子进程隔离、example 域名到本地供应商的限定转发、仅测试文件含原件适配、只清理自己进程/schema，以及核心断言有效。慢消费者结果仅证明其他 tab 响应和最新快照，不声称已测得 RSS 峰值上界。

浏览器 hold 收尾：2026-11-18 约 09:30，review_acceptance 完成真实 Chrome 验收并停其独立 5192 后，本 Agent POST 假供应商 `/stop`；hold 测试正常通过退出。随后以本地 PG 查询确认该 `pdf_stream_*` schema 不存在，API 59361 / 供应商 59340 均已停止响应，删除过期 ready 文件。仅清理本次自建 API/worker 与 schema，用户常驻服务未动。浏览器测得首稿 464 ms、完成 3.636 s 以及关闭重开/流失败回退结果由独立浏览器 Agent 负责记录，本报告不冒称自行操作浏览器。
