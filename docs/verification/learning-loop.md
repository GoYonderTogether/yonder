# T09r2 真实学习闭环验收

状态：未完成。2026-10-28 首次启动隔离验收时，共享 `packages/core/dist` 不一致：`kernel/index.js` 引用 `workspace.js` 尚未导出的 `projectRulesFor`，Node 在加载阶段报错，未调用模型、未生成记忆或技能。

随后执行 `npx tsc -b packages/core` 失败：其他并行改动涉及 `config/subagent-definitions.ts` 的 `Dirent` 类型、`kernel/index.ts` 的 `projectRulesFor` 和 `prompt/templates.ts` 的可选字符串。需在共享构建恢复后，以临时 HOME、仅导入 siliconflow 凭据槽，重新执行会话 A → 关闭会话 → 复盘 → 新会话 B 的真实验收，并在此附实际产物原文。当前不声称学习或召回成功。

复试：学习插件实现更新后再次执行 `npx tsc -b packages/core`，仍失败：`delivery/index.ts` 的 `AgentConfig | ""` 类型错误，以及 `kernel/index.ts` 缺少 `projectRulesFor` 导出。未能启动本次源码的内核，真实模型 A/B 和产物原文仍未测。
