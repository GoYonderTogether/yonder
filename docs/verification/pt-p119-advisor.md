# PT-P119 advisor：实施前核对

状态：未实现，未验收。2026-10-28 在 main 上核对当前源码。

- 当前插件与 SDK 注册中未找到 advisor 工具或 adviceId 生产者。`task_run` 使用 `Runtime.runTask` 和真实 `ToolContext` 的 native task 身份完成子会话提交；SDK 的 `sessions.open` / `sessions.submit` 不使用这个调用路径。
- 插件不能通过现有 SDK 调用 `task_run`。直接使用 sessions API 会另走会话调用，不能证明原有调用的取消、幂等及重启恢复；直接调用工具实现还需明确所选工具、钩子及 native replay 的边界。现有 runtime 只为 `task_run` 等具名工具标注 `replay: safe`，普通插件工具没有这个契约。
- SDK `api.paths.data` 已提供插件私有状态目录。pi-advisor-flow 0.14.3（MIT，Philip Brembeck）的 `register-outcome.ts` 默认关闭记录；启用后通过 reserve / commit / release 处理已发放 ID，写入失败释放预约。`outcomes.ts` 只保存 advice 的加盐 HMAC、时间、采纳与验证等字段。其发放 ID 的账本在内存中，任务重置会清空。
- 等待 T08 的插件委派桥接契约，或明确该桥接的权限、钩子、取消与重放语义；不能将仅记录不存在 ID 的工具当作咨询闭环。之后按 PT-P119 完成插件、契约、注册检查、真实咨询、故障/重放/重启和 T05 验收。

本次仅核对实时源码与原插件源码，未运行真实模型、后端、golden 或功能测试；无功能提交。
