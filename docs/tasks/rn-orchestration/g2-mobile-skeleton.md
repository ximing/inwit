# G2 · apps/mobile Expo 骨架（M0：工程 + 主题 + PAT 登录 + api client）

你在 /Users/ximing/project/mygithub/inwit 仓库工作（pnpm monorepo，全 ESM，相对导入带 .js 后缀，tsconfig NodeNext 风格）。

**先读规格**：docs/tasks/rn-mobile.md（总体方案的唯一来源，重点 §0 总原则、§1 工程结构、§2 鉴权、§4.3 API 层、§4.5 存储、§4.6 设计系统）。

## 任务

新建 `apps/mobile`（包名 `@inwit/mobile`），Expo managed workflow 应用。**不 import apps/web 的任何文件**；复用方式 = 拷贝适配（rn-mobile.md §1 拷贝清单）。

### 1. 工程脚手架
- package.json：`@inwit/mobile`，依赖：`expo`（最新 stable SDK）、`expo-router`、`expo-secure-store`、`expo-image`、`expo-font`、`expo-status-bar`、`@expo/vector-icons` 不需要（用 `lucide-react-native` + `react-native-svg`）、`react`、`react-native`、`react-native-safe-area-context`、`react-native-screens`、`react-native-gesture-handler`、`react-native-reanimated`、`@react-native-async-storage/async-storage`、`@rabjs/react`（^9.4.0，与 apps/web 一致）、`@inwit/dto: workspace:*`、`zod`。
- `main`: `expo-router/entry`；scripts: `start`(expo start)、`ios`(expo start --ios)、`android`、`typecheck`(tsc --noEmit)。
- metro.config.js：monorepo 配置——watchFolders 指向仓库根，resolver.nodeModulesPaths 含 apps/mobile/node_modules 与根 node_modules，确保 workspace 包（@inwit/dto）可解析。dto 的 types 指向 src/index.ts（TS 源码），Metro 需要能转译它（expo 默认 babel 可处理 TS；确认 unblock）。
- app.json：name「因文」不合适——用「Inwit」，slug `inwit`，scheme `inwit`，ios.bundleIdentifier `com.inwit.app`，android.package 同名，userInterfaceStyle automatic。
- babel.config.js：babel-preset-expo + react-native-reanimated/plugin。
- tsconfig：extends expo/tsconfig.base，strict，paths `@/* → ./src/*`。
- .gitignore（node_modules、.expo、dist 等）。

### 2. 设计系统（src/theme/）
- 读 docs/design/v2/inwit.css 的 `:root` 与 `[data-theme="dark"]`，把 token 转译成 `src/theme/tokens.ts`：colors（bg #f6f3ec、surface #fffdf8、ink 四级、accent #b3402a 及 deep/soft/line、gold、green、hl #f5e3a4；暗色全套）、radius（8/12/16/20）、spacing、typography（serif 标题 / sans 正文 / mono）、shadow 三档（RN shadow 属性）。
- `src/theme/ThemeService.ts`（@rabjs/react Service）：light/dark/system，AsyncStorage 持久化 key `inwit-theme`；`useTheme()` hook 返回当前 token 集。
- 文案全中文、语气克制书面。

### 3. API 层（src/api/）
- 拷贝 `apps/web/src/api/client.ts` → `src/api/client.ts`，适配：
  - `createMobileClient({ baseUrl, getToken, onUnauthorized })` 工厂；`request` 注入 `Authorization: Bearer <pat>`（getToken 异步）；去掉 `credentials:'include'`；保留 ApiError/errorMessage/setUnauthorizedHandler 语义。
  - baseUrl 来自 `src/config.ts`（dev 默认 `http://localhost:3020`，留注释说明真机要换局域网 IP；可被 app.json extra 覆盖）。
- 拷贝 `apps/web/src/api/auth.ts`、`review.ts`、`reports.ts`、`topics.ts`（只要这些，其余里程碑再拷），import 路径改对，逻辑不动。
- 不拷 `admin.ts`。

### 4. 鉴权（src/services/auth.service.ts + 登录页）
严格按 rn-mobile.md §2 的 PAT 流程：
1. `POST /api/auth/login`（RN fetch 自动接 cookie）
2. `GET /api/me/access-tokens`，找 name === "inwit-mobile" 的，有则 `POST .../:id/reveal` 复用；没有则 `POST /api/me/access-tokens {name:"inwit-mobile"}` 再 reveal
3. PAT 存 `expo-secure-store`（key `inwit.pat`），之后所有请求走 Bearer
4. bootstrap：启动读 SecureStore，有 PAT 则 `GET /api/auth/me` 验证；401/INVALID_TOKEN → 清 PAT → 回登录页
5. logout：删本地 PAT（不调服务端吊销）
- AuthService 为全局 Service：user、bootstrapping、login/register/logout 方法、PAT 读写封装。登录/注册共一个页面（tab 切换），邮箱+密码（≥8 位），对齐 apps/web/src/pages/login 的交互与文案。

### 5. 导航骨架（app/，expo-router）
- `app/_layout.tsx`：root stack；RSRoot/ServiceProvider（按 @rabjs/react 的用法）+ AuthService 挂载；bootstrap 中 splash；未登录 → `/login`，已登录 → `/(tabs)`。
- `app/login.tsx`：登录/注册页。
- `app/(tabs)/_layout.tsx`：五个 Tab——今日、文档、复习、主题、我的；lucide 图标；复习 Tab 预留 badge（dueCount，M1 接真实数据）。
- 五个 Tab 页先放占位：页标题 + 「即将上线」居中文案 + 主题正确的背景色（bg/surface token）。
- 路由常量集中 `src/routes.ts`（对齐 web 的 ROUTES 习惯）。

## 验收（全部必须通过）
1. `cd /Users/ximing/project/mygithub/inwit && pnpm install` 成功（注意 monorepo 下 expo 的 peer 依赖告警要处理干净）
2. `pnpm -F @inwit/mobile typecheck` 通过
3. `CI=1 pnpm -F @inwit/mobile exec expo export --platform ios --output-dir /tmp/inwit-export-test` 成功（验证 bundle 可打包；产物用完即弃）
4. 登录页在 iOS 模拟器截图可看（你起不了模拟器就跳过，由编排方验收）

## 约束
- **禁止修改 apps/web、apps/server、packages/* 的任何文件**。
- **禁止 git commit**。
- 不装 expo-dev-client 之外的重型原生依赖；不 eject。
- 若 pnpm install 因 expo 版本与 react 19.1 冲突，按 expo SDK 推荐的 react 版本在 apps/mobile 内声明（不影响仓库其他包）。
- 完成后 stdout 输出：PASS/FAIL 逐条对应验收 1-3，创建的文件清单，以及遗留问题。
