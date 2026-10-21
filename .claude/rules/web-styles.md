---
paths:
  - "apps/web/src/**/*.css"
  - "apps/web/src/**/*.tsx"
---

# Web 样式组织规范

- **按功能就近维护**：
  - 页面样式放在 `apps/web/src/pages/<功能>/styles.css`；复杂页面按子功能继续拆分（如 `pages/docs/editor.css`、`card-rail.css`、`pdf-pane/styles.css`、`pages/review/reports.css`）。
  - 组件样式放在对应组件目录的 `styles.css`，或与组件同级的同名 CSS（如 `components/doc-row.css`）。
  - 应用骨架样式放在 `apps/web/src/shell/styles.css`。
- **全局样式边界**：`apps/web/src/styles.css` 只维护主题变量、基础元素/reset、全局可访问性规则，以及按钮、表单、对话框、标签等通用基础原语。**禁止**向该文件追加页面或业务功能专属样式；跨页面复用的业务组件仍由所属组件目录维护样式。
- **规则随模块归属**：功能相关的响应式 `@media`、深色主题覆盖、`@keyframes` 和减少动画规则（`prefers-reduced-motion`），与该功能的基础样式放在一起。跨模块的组合选择器按归属拆开，避免在全局文件末尾集中堆积适配或补丁。
- **统一加载入口**：`apps/web/src/main.tsx` 只导入 `style-entry.css`，由它使用 `@import` 统一加载全局与模块 CSS。新增样式文件必须在 `style-entry.css` 中登记，按全局基础样式在前、模块样式按覆盖关系在后的顺序排列；**禁止**在路由或组件中重复或延迟导入 CSS，以免样式表现依赖页面访问顺序。新增类名应使用功能前缀或所属容器约束。
- **视觉参照与验证**：视觉重构以 `docs/design/v2/*.html` 与 `docs/design/v2/inwit.css` 为唯一真相来源。修改或拆分样式后运行 `pnpm --filter @inwit/web build` 与 `git diff --check`，并兼顾宽屏/窄屏、浅色/深色主题表现。
