# T09r2 真实学习闭环验收

T09r3 重验准备：已同步 main，将在推送后使用独立验收副本；真实 A/B、撤销与样本尚待验证。验收 HOME 不得导入 siliconflow 以外的凭据。

T09r3 尝试：提交 `b399979` 推送后执行 `verify-copy.sh`，分别因其他验收 HOME `ch07r3a`、`p153r3` 运行而拒绝更新副本；未停止他人服务。副本 HEAD `12b259c` 包含该提交，但本次脚本未完成构建，不能据此声称可验收。此外 `verify-home.sh` 会同时导入 `gw` 凭据槽，超出本任务仅导入 siliconflow 的授权，未执行该脚本。真实模型 A/B、撤销及 3–5 条真实样本均未测；需在副本空闲后解决凭据范围再继续。

状态：未完成。2026-10-28 首次启动隔离验收时，共享 `packages/core/dist` 不一致：`kernel/index.js` 引用 `workspace.js` 尚未导出的 `projectRulesFor`，Node 在加载阶段报错，未调用模型、未生成记忆或技能。

随后执行 `npx tsc -b packages/core` 失败：其他并行改动涉及 `config/subagent-definitions.ts` 的 `Dirent` 类型、`kernel/index.ts` 的 `projectRulesFor` 和 `prompt/templates.ts` 的可选字符串。需在共享构建恢复后，以临时 HOME、仅导入 siliconflow 凭据槽，重新执行会话 A → 关闭会话 → 复盘 → 新会话 B 的真实验收，并在此附实际产物原文。当前不声称学习或召回成功。

复试：学习插件实现更新后再次执行 `npx tsc -b packages/core`，仍失败：`delivery/index.ts` 的 `AgentConfig | ""` 类型错误，以及 `kernel/index.ts` 缺少 `projectRulesFor` 导出。未能启动本次源码的内核，真实模型 A/B 和产物原文仍未测。
