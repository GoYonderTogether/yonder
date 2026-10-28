# T09r2 真实学习闭环验收

T09r3 重验准备：已同步 main，将在推送后使用独立验收副本；真实 A/B、撤销与样本尚待验证。验收 HOME 不得导入 siliconflow 以外的凭据。

T09r3 尝试：提交 `b399979` 推送后执行 `verify-copy.sh`，分别因其他验收 HOME `ch07r3a`、`p153r3` 运行而拒绝更新副本；未停止他人服务。副本 HEAD `12b259c` 包含该提交，但本次脚本未完成构建，不能据此声称可验收。此外 `verify-home.sh` 会同时导入 `gw` 凭据槽，超出本任务仅导入 siliconflow 的授权，未执行该脚本。真实模型 A/B、撤销及 3–5 条真实样本均未测；需在副本空闲后解决凭据范围再继续。

状态：未完成。2026-10-28 首次启动隔离验收时，共享 `packages/core/dist` 不一致：`kernel/index.js` 引用 `workspace.js` 尚未导出的 `projectRulesFor`，Node 在加载阶段报错，未调用模型、未生成记忆或技能。

随后执行 `npx tsc -b packages/core` 失败：其他并行改动涉及 `config/subagent-definitions.ts` 的 `Dirent` 类型、`kernel/index.ts` 的 `projectRulesFor` 和 `prompt/templates.ts` 的可选字符串。需在共享构建恢复后，以临时 HOME、仅导入 siliconflow 凭据槽，重新执行会话 A → 关闭会话 → 复盘 → 新会话 B 的真实验收，并在此附实际产物原文。当前不声称学习或召回成功。

复试：学习插件实现更新后再次执行 `npx tsc -b packages/core`，仍失败：`delivery/index.ts` 的 `AgentConfig | ""` 类型错误，以及 `kernel/index.ts` 缺少 `projectRulesFor` 导出。未能启动本次源码的内核，真实模型 A/B 和产物原文仍未测。

## T09r4（2026-10-28）

按第四轮裁定使用池副本 `t09r4`，构建成功，HEAD `3b90c1a3d88f1c10393b09d992170a8b19352ef4`；仅在隔离 HOME 配置 learning scope，正式 HOME 未修改。模型 siliconflow/deepseek-ai/DeepSeek-V3.2。首轮要求以后发布前依次检查文档、测试、打标签：83.1 秒，前台 5 次工具调用，模型通过 `learning_memory_edit` 写入记忆。后台技能复盘会话 `77` 启动，先尝试两个不允许的 memory 读取（被拒），随后读取三个不存在的技能；随后生成 `hermes-learned-release-checklist`，学习面板出现一条技能记录。第二次相同类别请求：34.2 秒，0 次工具调用，回答引用相同顺序并称使用记忆。

限制：两次均在同一主会话，前台直接写记忆，故不能证明新会话召回复盘产物。通过 `views.data` 查看学习面板记录，通过 `views.act` 对该记录执行 undo 成功；随后技能索引不再包含该技能。撤销后的模型实际召回未测。技能内容把短对话扩展为强制完整测试、具体命令等未经确认的规则，有误记风险。仅有一条真实样本，已写入 `yonder-lead/program/agent-ux/O49/hermes-samples.md`；3–5 条样本、完整 A/B 和撤销验收仍未完成，默认保持关闭。
