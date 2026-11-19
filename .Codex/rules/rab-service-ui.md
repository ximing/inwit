---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.service.ts"
  - "apps/mobile/src/**/*.tsx"
  - "apps/mobile/src/**/*.service.ts"
  - "apps/mobile/app/**/*.tsx"
---

# `@rabjs/react` 响应式 Service 与组件规范

- **状态管理唯一方案**：每页或功能域维护对应的 `*.service.ts`（继承 `@rabjs/react` 的 `Service`），组件通过 `bindServices` + `observer` + `useService` 消费状态，禁止引入 Redux、Zustand 等其它状态管理库。
- **延迟解析依赖**：Service 依赖其它 Service 时，必须在使用点（getter 或方法内部）调用 `this.resolve(OtherService)`，**严禁在 `constructor` 中调用 `this.resolve`**。
- **跨 Service 协作**：跨 Service 的事件监听或回调 wiring 放在页面组件的 `useEffect` 中管理，避免 Service 之间产生隐式循环耦合。
- **网络调用边界**：禁止在 React 组件内直接调用 `fetch`，所有接口请求必须经由 `src/api/` 封装并由 Service 方法编排状态。
- **文案与图标**：界面文案全部使用中文，语气克制、书面、不卖萌；图标统一使用 `lucide-react`（Web）或 `lucide-react-native`（Mobile）。
