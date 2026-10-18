# 文档地图

> 文档就是代码的目标。代码与文档不一致时，以文档为准；要改设计，先改文档。

## 阅读顺序（渐进式披露）

| 层级 | 文档 | 回答什么 | 谁必须读 |
|---|---|---|---|
| 0 | [architecture.md](architecture.md) | 整体是什么、主线怎么走、谁负责什么、哪些规则不可违反 | 所有人 |
| 1 | [spec/01-events.md](spec/01-events.md) | 事件长什么样、存在哪 | 改内核或写渠道插件 |
| 1 | [spec/02-sessions.md](spec/02-sessions.md) | 事件如何绑定到 agent 和会话；身份映射 | 改内核或写渠道插件 |
| 1 | [spec/03-agents.md](spec/03-agents.md) | agent 工作区、配置档（分身）、预设、提示词组装、skill | 改内核或写上下文插件 |
| 1 | [spec/04-plugins.md](spec/04-plugins.md) | 插件包、插件槽接口、生命周期、版本 | 写任何插件 |
| 1 | [spec/05-security.md](spec/05-security.md) | 能力与级别、执行环境 | 写工具或执行环境插件 |
| 1 | [spec/06-delivery.md](spec/06-delivery.md) | 回复、流式、主动发送、不回复 | 写渠道插件 |
| 1 | [spec/07-runtime.md](spec/07-runtime.md) | 与 pi 的对接、模型与密钥配置、压缩、防空转 | 改内核 |
| 1 | [spec/08-config.md](spec/08-config.md) | 配置文件全貌与示例 | 所有人 |
| 1 | [spec/09-cli-release.md](spec/09-cli-release.md) | CLI 约定与命令、安装、更新、版本通知、发布 | 改 CLI 或发布 |
| 2 | [decisions.md](decisions.md) | 关键取舍及理由 | 想改设计的人 |
| 2 | [tasks/](tasks/README.md) | 0.1 的实现任务、状态表与实现循环的规则，每条引用规范的具体行 | 实现者 |

## 下一阶段草案（待用户审核）

- [10 本机运行与项目自维护](spec/10-local-maintenance.md)、[11 官方插件与常规工具](spec/11-official-plugins.md)：下一阶段功能、边界和验收，批准后冻结。
- [合并实施计划](tasks/next-mcp-self-maintenance.md)、[N00–N14 任务](tasks/next/README.md)：只安排实现顺序、负责人、路径和检查，不重复功能设计。
- [参考快照与本机证据](tasks/next/reference-sources.md)：用户授权更新后的实际来源；不作为已实现声明。

现有 0.1 规范与原验收继续有效。新草案在 N00 获准后才与受影响旧条款统一，不由实现者选择性解释冲突。

## 规范用语

- **必须 / 禁止**：违反即为缺陷。
- **应当**：除非文档写明的例外，否则照做。
- **可以**：可选。
- 标 `〔0.1 不实现〕` 的段落定义接口或约束，0.1 不写实现，但 0.1 的代码不得与之冲突。

## 版本目标

当前目标：**0.1**——内核完整、能用真实模型跑起来、接口冻结到足以让外部开始写插件。
0.1 的范围见 [tasks/README.md](tasks/README.md)。

当前执行分两轮：先实现到 T14 并记录问题，再由用户审核后进行完整验收与修复；第一轮“已实现”不等于验收通过。具体见 [tasks/README.md](tasks/README.md)。
