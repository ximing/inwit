# T30 浏览器验收报告（csi / 真实 Chrome）

日期：2026-10-15。会话 t30-verify，账号 regression@inwit.dev（localhost:5190 源，见「环境」节）。
截图存 docs/tasks/shots/t30/。

## 环境

- server :3020（tsx watch 子进程 pid 25214，10:39:36 由最后一个 T30 文件保存触发重启，晚于全部 T30 server 文件与 dto dist 构建，跑的是新代码）；web :5190（vite HMR，T30 web 文件 10:39 保存后即时生效）；worker 验收前新启动（日志 /tmp/t30-worker.log，加载新代码）。
- 登录踩坑（环境性，非产品问题）：`.env` 的 `WEB_ORIGIN=http://localhost:5190`，而验收约定入口是 127.0.0.1:5190；`authModeFromOrigin` 按 Origin===WEB_ORIGIN 判定 cookie 模式，127.0.0.1 源登录走 bearer 不落 cookie，导致 UI 登录后接口全 401。改用 localhost:5190 源后正常（该源已有有效会话 cookie）。建议把 WEB_ORIGIN 与验收约定入口对齐。

（结果待补）
