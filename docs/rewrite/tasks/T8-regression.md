# T8 · 收尾：回归脚本 + 文档更新

先读 `docs/rewrite/CONTEXT.md`。

## 背景

大重构完成后，`scripts/smoke-t21.sh`、`smoke-t22.sh`、`smoke-t23.sh` 可能引用了旧路由/旧接口字段；`docs/regression-v0.md`、`docs/dev-log.md` 需要更新。

## 任务

1. 逐一运行 `scripts/smoke-t21.sh`、`smoke-t22.sh`、`smoke-t23.sh`（先看脚本内容确认前置条件；需要 dev server 的先确认 5190/3020 在跑，不在跑就在报告里说明而不自行启动）
2. 修复因路由收敛（/doc→/docs、/editor、/card、/admin 移除）和新接口字段（review/stats 扩展、jobs/queue、jobs/usage、review/settings）导致的脚本失败；功能语义变化导致的断言更新为新预期
3. 新增 `scripts/smoke-t24.sh`：覆盖本次新增接口的冒烟 —— GET/PUT /api/review/settings（含非法值 422）、/api/review/stats 新字段存在性、/api/jobs/queue、/api/jobs/usage。风格参照现有 smoke 脚本
4. 更新 `docs/regression-v0.md`：路由表、页面清单、新接口清单、已验证项打勾
5. 更新 `docs/dev-log.md`：追加本次重构条目（日期、范围：路由收敛、复习设置/统计、任务队列接口、设计系统重写）
6. 更新 `README.md` 中过时的页面/路由描述（如有）

## 验收

- 全部 smoke 脚本通过（输出贴进任务报告）
- `pnpm typecheck` 通过
