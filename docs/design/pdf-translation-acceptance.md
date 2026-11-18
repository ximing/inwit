# PDF 按需翻译开发验收记录

状态：功能与本地验收通过；真实模型质量和供应商时延未验，不能宣称全部验收完成。日期：2026-11-17。

## 环境与执行边界

主 Agent 仅调度。解析实现、后端基础、业务实现分别由 SubAgent 负责，独立审阅交叉安排。现有方案及 `.agents/skills/` 保留。

发现 `.env.test` 仍指向远程专用测试库，`NODE_ENV=test` 不等于本地隔离。现有 `testkit/isolated-db.ts` 会在所配置数据库里建立随机 `m1_*` schema，执行迁移后删除 schema；它不是新建独立数据库。基础实现 agent 在发现前执行过两次该测试流程，随后只读核查目标为远程测试库 `inwit_test`，没有遗留 `m1_*` schema。不能将本轮描述为“全程本地验收”。发现后要求所有后续执行显式覆盖本地配置，不再进行远程写入。

本机 Docker CLI 可用，Colima 最初未启动。验收 agent 启动 Colima；PostgreSQL/MinIO 镜像拉取失败，原因是 VM 的 `/etc/resolv.conf` 指向不存在的 `/run/systemd/resolve/stub-resolv.conf`。只在 VM 的 `/run` 下临时补充解析配置；原目录运行时内容可通过 VM 重启清除。未修改宿主 DNS。替代独立本地 PostgreSQL 由基础实现 agent 准备。

## PDF 独立视觉复核

8 篇真实论文、16 个渲染页，固定 103 个视觉正文目标。review_acceptance 独立标注 Adam 1/2、GPT-3 3/4、CLIP 2/3、LoRA 1/2、Diffusion 2/3 共 55 目标；初轮 33/55，第二轮 49/55，第三轮 52/55。另独立抽核 probe 的 Attention 2/4、BERT 2/3、ResNet 1/2，共 46/48。合计 **98/103 = 95.15%**，达技术门槛；5 个含复杂行内分式的降级段落仍保留分母，未用删除困难目标美化结果。最终被启用目标未观察到串栏/错段。

逐轮标注见 `scripts/pdf-translation-acceptance/manual-review.json`；样本哈希、坐标矩阵、扫描页、复现命令与 5 个降级目标见 `pdf-translation-validation.md`。该结果只代表固定样本，不是所有 PDF 的质量保证。几何使用有效可见框；原始文件 CropBox 元数据没有可靠公开 API，`rawCropBox:null`，不能宣称保存了原始 CropBox。

## 实际后端执行与独立审阅

本地 PostgreSQL 127.0.0.1:55439，隔离 schema 实际执行：**12 集成 + 5 纯逻辑 + 2 writer 边界 = 19 通过（2.58s）**。覆盖并发同内容仅一次派发、多幂等键复用、缓存、unknown 明示重试、取消/派发互斥、失联派发不重发、凭据固定与撤销、用户/版本边界、文档软删在途写回隔离、重翻失败保留旧结果、解析异常仍保留选区所需 metadata、不同引擎角点/基线差异整段选区复用、物理删除无孤立 carrier。

独立审阅发现并修复：settings/credential 锁序死锁风险、恢复忽略活跃 lease、失败索引无 geometry 阻断选区、严格角点相等导致同段重复收费、物理删除遗留 carrier。基础模块由业务 agent 审阅；业务由 backend、probe 独立审阅，详见 `pdf-translation-business-review.md`。backend 全量实际执行报告 server 1000 passed / 1 skipped（browser harness 默认需显式开关），Web 584 passed（88 文件）；根 typecheck、Web build、git diff --check 通过。索引 lease 独立 5/5、前端服务 10/10 通过。

## Chrome 实际产品验收

使用 CSI 真实 Chrome、真实 BERT PDF/PDFium、服务器权威索引、真实鉴权/API/本地 PostgreSQL。仅存储传输与模型供应商是本地 fixture；译文明示“本地验收模拟译文”。没有使用前端伪造段落数据。浏览器后台 `document.hidden=true` 时轮询暂停；CDP focus emulation 将页面置为可见后恢复并显示已落库结果，符合可见性规则。这里是自动化前台仿真，不是人工物理窗口操作。

| 动作 | 实际结果 |
| --- | --- |
| 首次单击真实英文段落 | calls 0→1，保存中文浮层；英文 PDF 保留 |
| 400ms 内双击、三击 | calls 保持 1，无误派发 |
| 真实拖动选择文字 | calls 保持 1，出现选区操作 |
| 有选区时首击、随后正常单击 | 首击清选区不派发；第二击 calls 1→2 |
| 显式“翻译为中文”选区退路 | calls 2→3，保存选区译文 |
| Esc 菜单/浮层、焦点恢复、Enter | 先关二级菜单，再关浮层；焦点回到源段按钮；Enter 命中缓存 |
| 浮层内实际 wheel | 译文 scrollTop 0→180；PDF viewport 保持 0 |
| 900×800 窄窗 | 停靠浮层，关闭按钮位于 (845,398)-(875,426)，可达 |
| 90°旋转、再放大 | 同段键盘打开已保存浮层，calls 保持 3 |
| Page.reload 后再次打开同段 | 命中持久缓存，calls 保持 3 |
| 20 次鉴权缓存 GET | 全部 200，P50 5.4ms、P95 7.1ms，低于 500ms 目标 |

首轮 browser harness 在 30 分钟生命周期上限退出为 Vitest timeout（非产品断言失败），不能将该进程算作测试通过；随后只读本地库确认无遗留 `m1_*` schema。下述操作结果来自超时前实际完成的浏览器观测。

证据：`scripts/pdf-translation-acceptance/browser-results.json`、`cache-latency.json`、`screenshots/`。双真实 Chrome tab（762356919 / 762356931）首次同段，两次产品按钮 POST 相隔 229ms、均 202，均轮询任务 `3d398324-417f-4ad2-a17d-3f2958702877`；调用计数 1→2 仅增加一次，两页均显示已保存。CSI 的 URL 查找忽略查询差异，最终用本任务目标 tab 激活后核验不同 tab ID，未把同 tab 重复点击冒充双 tab。

追加持久索引恢复：在本地隔离 DB 为尚未索引的第 10 页设置一个模拟进程中断的活跃 indexing lease，通过产品页码控件跳转；实际 UI 出现“正在建立段落索引”，无段落按钮且正常 GET 轮询。将该本地 fixture 租约时间置为过期，真实服务器解析 BERT，第 10 页恢复 12 个段落按钮，提示消失，provider calls 保持 2。没有伪造服务返回或前端 segments。首次新文档索引也实际生成并显示。真实模型的翻译质量、供应商 P50/P95 未验证，不把模拟译文或模拟 200ms 延时算作通过。Chrome 外浏览器及桌面壳未验证。900px 布局仍受既有侧栏占宽影响；检查的是浮层控件可达性。

## 本地复验

不要直接使用仓库 `.env.test`。先启动 loopback PostgreSQL、创建本地数据库/用户，然后显式设置：

```sh
export PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local
export PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false NODE_ENV=test
export QDRANT_URL=http://127.0.0.1:1 QDRANT_API_KEY=local-only
export MEILI_HOST=http://127.0.0.1:1 MEILI_API_KEY=local-only DASHSCOPE_API_KEY=local-only
pnpm --filter @inwit/server migrate
pnpm --filter @inwit/server exec vitest run src/documents/translation/translation.integration.test.ts src/documents/translation/translation-logic.test.ts src/documents/document-write-boundary.test.ts
```

迁移包含 `0046_previous_clea.sql`；索引 lease 复用现有表，无额外迁移；只在本地数据库执行。普通开发另开终端运行 server dev、server worker、web dev，并配置本地测试对象存储。完整浏览器 fixture 无需真实供应商或 S3：运行 `sh scripts/pdf-translation-acceptance/start-browser-fixture.sh`，另终端 `pnpm --filter @inwit/web dev --port 5190`。读取 fixture 控制台 doc ID；用测试文件中专用本地测试账户登录，再访问 `/docs?doc=<id>`。fixture 每次建立新隔离 schema，30 分钟上限；结束向 `http://127.0.0.1:3020/api/__pdf-test/stop` POST，关闭 app 并清理 schema。测试凭据仅供本地 fixture，不涉及生产密钥。CSI 复验辅助为 `browser_check.py`；其第一批动作需先手动打开已保存浮层。

未部署生产、未推送/合并。未执行真实付费供应商验证。持久索引租约追加实现与两 tab 浏览器验收已完成。最后 failed+geometry:null 提示分支经独立静态复核，优先显示服务器失败诊断，不再误称正在索引。真实模型质量/时延仍为明确未验项。


## 最终清理与存续

第二轮 browser harness 已通过正常 POST stop 收尾，Vitest 1/1 passed、exit 0（783.47 秒，含人工/自动浏览器操作等待）；本任务 Vite 已 SIGINT 停止。临时 PostgreSQL 已由创建 agent 正常停止，数据目录保留。若复验需要重启：

```sh
/tmp/inwit-pdf-postgres/package/native/bin/pg_ctl -D /tmp/inwit-pdf-postgres/data -l /tmp/inwit-pdf-postgres/postgres.log -o '-h 127.0.0.1 -p 55439' start
```

Colima 结束检查发现运行中的 `moment-mysql-1`，它不是本任务创建的容器，因此没有停止 Colima 或干扰该服务。此前只在 VM `/run` 下补充的 DNS 文件会在 VM 下次重启清除；未改宿主 DNS。任务 Chrome 标签仍留在“PDF 翻译验收”分组，按 CSI 规则仅用户要求时关闭。未停止用户原有服务。

## 后续用户真实模型本地验收模式

用户在后续验收中保存了真实模型配置并要求移除模拟译文。为避免 30 分钟 fixture 超时清库，当前用户所在 schema 已原子保留为 `inwit_pdf_reading`；不再运行 Vitest fixture，配置、会话、文档均保留。4 个全部终态且仅含明确模拟前缀的译文内容及关联 carrier 先备份到同一本地库 `pdf_simulation_backup`，再从活动缓存清除；真实配置未删除。新浏览器会话验证鉴权 200、段落索引 ready/200、模拟缓存命中数 0，没有主动调用用户付费模型。

持久启动入口：`sh scripts/pdf-translation-acceptance/start-real-local-reader.sh`，执行 `apps/server/scripts/pdf-local-reader.ts`。使用真实 app、真实队列与 `completeTranslation`，没有模拟供应商或测试 API，无自动过期/清库。只在 loopback 提供原已保留 BERT 文档的精确对象 key；其他对象返回 404，不能将此入口当作完整上传存储。运行时验证数据库和 `current_schema()`，旧 cookie/密钥加密配置沿用本地测试环境，凭据不输出。当前 API 3020、对象 55440、Web 5190、PG 55439 保持运行供用户验收；这取代上节当时的停止状态。退出真实 reader 用其终端 Ctrl-C，只停服务、不删持久 schema。

后续样式修复独立核验：新的只读 Chrome tab 中底部按钮同排 34px，主/次/危险按钮层级清晰；仅保存是 submit，测试和删除为 button。提示采用 settings-hint，反馈按 success/error 使用 ok-line/banner-error；未为查看反馈再保存/测试付费连接。截图 `/tmp/inwit-translation-actions-reviewed.png`。没有读取或输出用户 API key。
