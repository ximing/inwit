# Inwit React Native 客户端 · 技术方案

> 与 `docs/tasks/rn-doc-engine-spike.md`（文档引擎 spike 任务书）配套。本文档是总体方案；spike 任务书是其中文档引擎的先行验证。

## 0. 总原则

1. **web 端零改动**。不做 client-core 抽包、不改 web 的任何文件；复用靠「拷贝进 mobile/doc-engine 后独立适配」，漂移可接受、靠契约兜底。
2. **服务端零改动**。全部走现有 API；鉴权用已有的 Bearer PAT 能力。
3. **契约唯一来源是 `@inwit/dto`**。这是 web 与 mobile 之间唯一强绑定的共享物（workspace 依赖，types 指向源码，Metro 直接可用）。
4. **文档正文（读/写/划选/锚点）= WebView 文档引擎；其余一切 = 原生**。引擎内零 API 请求，数据全走桥。

## 1. 工程结构

```
apps/mobile/                    # Expo 应用（pnpm-workspace 的 apps/* 自动接纳）
  app/                          # expo-router 文件式路由
  src/
    api/                        # 从 web 拷贝适配（§4.3）
    services/                   # @rabjs/react service，按需从 web 拷贝适配
    lib/                        # 从 web 拷贝的纯函数（cloze/format/presign-cache…）
    doc-engine/                 # WebView 引擎的原生侧封装
    theme/                      # inwit.css tokens 的 RN 转译
    pages/                      # 各 Tab 页面组件
  assets/doc-engine.html        # 引擎产物（构建时从 packages/doc-engine/dist 同步）

packages/doc-engine/            # WebView 文档引擎，独立 vite 构建，自包含
  src/
    protocol.ts                 # 桥协议类型（唯一事实来源，mobile import 其类型）
    vendor/                     # 从 apps/web 拷贝的 extensions/anchor-highlight/entity-marks…
    engine.ts / bridge.ts / main.tsx
  dist/doc-engine.html          # vite-plugin-singlefile 单文件产物
```

依赖方向：`mobile → doc-engine`（产物 + 协议类型）、`mobile → @inwit/dto`、`doc-engine → @inwit/doc-schema + @tiptap/*`（自行声明）。**任何方向都不 import `apps/web`**。

### 拷贝清单（一次到位，之后各自演进）

| 目的地 | 从 web 拷贝 | 适配内容 |
|---|---|---|
| `doc-engine/src/vendor/` | `components/doc/extensions.ts`、`pages/docs/anchor-highlight.ts`、`lib/entity-marks.ts`、`lib/anchors.ts`、`lib/pm-doc.ts` | `AssetUrlsService` 替换为引擎内置的「注入 URL map + 订阅」（~50 行）；`DocView` 不拷，引擎自带入口组件 |
| `mobile/src/lib/` | `cloze.ts`、`format.ts`、`presign-cache-logic.ts`、`asset-urls-logic.ts`、`doc-pipeline.ts`、`card-copy.ts`、`multipart-logic.ts` | 纯函数，零或近零改动；`multipart-logic` 的 localStorage 换 AsyncStorage |
| `mobile/src/api/` | `client.ts` + 15 个 api 文件 | 仅 `client.ts` 改成 Bearer + baseURL（见 §4.3），其余原样拷贝 |
| `mobile/src/services/` | `asset-urls.service.ts`、`auth.service.ts`、各页面 service（按里程碑） | localStorage→AsyncStorage；`document.documentElement` 类落点删除 |

漂移控制：api 函数是薄封装，漂移成本低；锚点/文档语义以 web 为准，靠 spike 的「同文档同选区 from/to 一致」断言锁住；大改 web 文档引擎时对照 `vendor/` 清单人工同步。

## 2. 鉴权（服务端零改动）

```
登录页: POST /api/auth/login { email, password }
  → RN fetch 原生 cookie jar 接住会话（本次进程内有效即可）
  → GET  /api/me/access-tokens            # 查已有 token
  → 有 name="mobile" 的 → POST /api/me/access-tokens/:id/reveal  # 复用
     没有 → POST /api/me/access-tokens { name: "mobile" } → reveal
  → PAT（iwt_…）存 expo-secure-store
之后所有请求: Authorization: Bearer <pat>
401 (INVALID_TOKEN): 清 PAT → 回登录页
退出登录: 删本地 PAT（服务端 token 保留，web 设置页可管理/吊销）
```

要点：PAT 不过期、按 name 复用避免撞 `ACCESS_TOKEN_MAX_PER_USER` 上限；cookie 只在登录瞬间用一次，不依赖其持久性。

## 3. 文档引擎

方案细节、bridge 协议字段、工程结构、验收标准见 **spike 任务书**。本文档只记录与「各做各的」原则相关的两点：

- 引擎的 `vendor/` 拷贝来源固定为上表，spike 即按拷贝方式做（不用 alias 引用 apps/web）。
- 引擎是 mobile 的私有件：web 后续改 DocView/extensions 不会破坏 mobile；要同步时按 vendor 清单逐文件 diff。

## 4. 原生层

### 4.1 导航与信息架构

- **expo-router** 文件式路由；底部 Tab 对齐 web 侧边栏：今日 / 文档 / 复习（dueCount badge）/ 主题 / 我的（设置）。
- web 的 `?doc=xx&anchor=yy` query 式深链 → RN 的 Stack push 参数；`anchor` 深链保留（点卡片跳文档锚点闪烁）。
- 文档详情、阅读弹层（ReaderOverlay 等价物）= Stack 页面 + 底部 Sheet，不做 web 式 overlay portal。

### 4.2 状态管理

- **@rabjs/react**（与 web 同款，本仓库已有 rab-rn-debug 真机调试设施）。每页一个 service 的模式照搬；service 从 web 拷贝后把平台落点替换掉。
- 不引入第二套状态库。

### 4.3 API 层

- 拷贝 `client.ts` 改为：`createMobileClient({ baseUrl, getToken })`；`request` 注入 `Authorization: Bearer`，去掉 `credentials`；保留 `ApiError` / `INVALID_TOKEN → onUnauthorized` 语义。
- 15 个 api 文件按里程碑需要逐个拷贝（M1 只需 auth/review/reports/search/documents/topics 子集；`admin.ts` 永不拷贝）。
- baseURL 走 app config（dev 指向局域网 3020，prod 指向线上）。

### 4.4 媒体与上传

- 图片渲染：`expo-image` + presign 缓存（`asset-urls-logic.ts` + `presign-cache-logic.ts` 拷贝后逻辑不变，缓存放内存 + AsyncStorage 持久化可选）。
- 上传：头像/图片用 `expo-image-picker`，文件导入用 `expo-document-picker`；presigned PUT 用 `FileSystem.uploadAsync`（RN fetch 的 FormData 对大二进制不可靠）。分片 multipart 导入后置到 M4。

### 4.5 存储

- `expo-secure-store`：PAT。
- AsyncStorage：主题、ui-prefs、导入 checkpoint（M4）。

### 4.6 设计系统

- `docs/design/v2/inwit.css` token → `theme/index.ts`：`bg #f6f3ec / surface #fffdf8 / ink #221d16 四级 / accent #b3402a / gold / green / hl #f5e3a4`，圆角 8/12/16/20，暖棕阴影；深色主题同步做（token 已有暗色值）。
- 字体：标题宋体用 `expo-font` 加载思源宋体子集；正文系统默认。引擎（webview）内用系统 serif 栈，不内嵌字体文件。
- 图标 `lucide-react-native`；文案全中文、语气克制书面，与 web 一致。

### 4.7 复习页交互映射（M1 核心）

- Hub：streak hero + 待复习数 + 「开始复习」+ 统计格 + 近 7 天柱状图（`react-native-svg` 自绘，数据来自 `getReviewStats`）。
- Session：卡片翻面 = 单击；评分 = 底部三个大按钮「忘了/模糊/想起来了」（带间隔提示，对齐 web）；cloze 遮罩用 `lib/cloze.ts` 拷贝件；完成页显示明天到期数。
- 数据流完全复用 web 的 review service 模式：`getReviewToday` → 队列逐张 → `submitReviewFeedback` → 刷新 badge。

## 5. 里程碑

| 阶段 | 范围 | 从 web 拷贝的东西 | 出口标准 |
|---|---|---|---|
| **M0 骨架** | Expo 工程、theme、Tab 导航、PAT 登录流、api client | client.ts、auth.ts、`auth.service` 适配 | 真机登录→拉取今日数据渲染占位页 |
| **M1 复习+捕获** | 复习 hub/session 全闭环、今日页（问候/捕获框/行动卡/统计/最近动态）、主题建议 banner | review/reports/topics/search api、cloze/format、review service | 真机完成一轮完整复习并提交评分；捕获框「扔进去/问 AI」成功 |
| **M2 文档只读** | 文档列表（FlatList 分页/主题筛选/失败重试）、阅读页（WebView 引擎）、锚点点击→卡片栏 Sheet、划选→批注/写卡/AI 消化、全局搜索 | documents/cards/annotations/maps api、doc-pipeline；doc-engine 全部 | 通过 spike 全部 P0/P1；真机划选写卡闭环 |
| **M3 主题/任务/设置** | 主题列表+详情（图谱先简化树）、jobs 队列与用量、settings 五节 | jobs/llm/ocr/maps api | 与 web 同账号数据互通无差异 |
| **M4 创作** | 编辑器（引擎 editable 态 + 底部格式条）、选段写卡排队轮询、文件导入（含 multipart）、PDF（引擎壳加载 embedpdf 或降级预览）、截图批注 | paper-editor 的扩展装配、multipart-* | 真机编辑保存与 web 互见 |

前置依赖：M2 开工前完成 spike（3 天时间盒 + 决策门）。

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| WebView 划选手势/系统 callout 冲突 | 高 | spike P0-2/3/4 专项验证；降级路径=段落级长按菜单 |
| 长文档 WebView 性能/内存 | 中 | spike 验收第 9 条（2000 段）；必要时 pageBreak 分段渲染 |
| 双端实现漂移（拷贝路线的固有代价） | 中 | 契约锚定 dto；锚点语义有 spike 一致性断言；vendor 清单对照同步 |
| 引擎打包体积（tiptap+lowlight 单文件 ~500KB） | 低 | 本地资产加载，一次性解析；spike 记录耗时 |
| PAT 无删除端点（退出登录服务端残留 token） | 低 | web 设置页可吊销；后续可补服务端删除端点 |

## 7. 验收与开发流

- `pnpm --filter @inwit/mobile typecheck`；引擎 `pnpm -F @inwit/doc-engine build` 出单文件。
- 真机调试：rab-rn-debug（service 状态/指令）、引擎侧用 Safari/Chrome webview inspector。
- dev：`pnpm -F @inwit/doc-engine dev`（vite :5199 热更新）+ `pnpm -F @inwit/mobile start`（Expo）。
