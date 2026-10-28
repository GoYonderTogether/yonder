# Codex companion 验证（2026-10-28）

提交 8546bb1：插件与 core 的 TypeScript 构建通过；插件相关 Vitest 2 项、后台 Vitest 2 项通过；Biome 通过（core 既有 6 条警告）。首次联合 Vitest 因并行 `apps/desktop` 缺少 tsconfig 导致 1 suite 失败、4 项通过；排除该目录后相关检查通过。

`codex login status` 显示已登录；直接运行 Codex `gpt-6-luna` 只读小任务返回 OK（模型列表刷新曾超时，最终命令退出 0）。这不是插件端到端验收。

推送后两次运行 `verify-copy.sh` 分别因其他验收 HOME `aud01`、`p153r3` 正在运行而退出；未停止其他 Agent 的服务。插件通过真实 Yonder 调用、后台完成通知、候选选择及写入仍未验收。
