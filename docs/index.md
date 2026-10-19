# 文档地图

> 文档就是代码的目标。代码与文档不一致时，以文档为准；要改设计，先改文档。

## 当前工位：P0–P5已收尾，已整合main并正式发行1904（2026-10-19）

用户批准后已完成本轮修复、补检查、独立更新与可执行真实验收；按用户追加要求停止扩展验证。用户随后批准整合所有项目分支/工作树并正式发行；视频播放、真实断网及执行中插话留给日常反馈。未测/平台限制保留，不扩展验证。

- [本轮结果](tasks/finishing-result.md)：变更、原始失败、145项检查、1903实际安装及未关闭项。
- [现状总账](tasks/current-status.md)：当前需求、E01–E17证据及T/N/U/C/R/F/P状态。
- [全量功能与注册名树](function-tree.md)：逐个核心、CLI、插件、工具、渠道及SDK最小单元。
- [整合与发行记录](tasks/stable-release-result.md)：分支吸收、草稿保存与正式版本。
- [官方插件清单](plugins.md)：8个既有插件的贡献、订阅和逐项功能；没有新增插件。
- [Hermes当前对比](tasks/hermes-capability-comparison.md)：当前结论及原历史快照。
- [P0–P5批准方案](tasks/finishing-plan.md)：原范围与顺序保留；cron/复杂记忆继续后置。

正式Release为[0.1.2026101904](https://github.com/zoran-xc/yonder-harness/releases/tag/v0.1.2026101904)，固定提交42646a4；本机更新结果见发行记录。此前1903/504b7fc独立安装与检查为功能基线。D34–D37及现行规范仍是功能边界。

### 既有轮次证据入口

[R修复与验收结果](tasks/repair-main-result.md)、[F恢复结果](tasks/feishu-recovery-result.md)、[D36上下文分析](tasks/feishu-context-proposal.md)、[D37全局入口结果](tasks/global-entry-result.md)。原[R计划](tasks/repair-acceptance-plan.md)、[F计划](tasks/feishu-recovery-interaction-plan.md)与[审查](tasks/review-c0-c6.md)保留，不据旧状态重开开发。

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
| 1 | [spec/12-terminal-interaction.md](spec/12-terminal-interaction.md) | 沿用 pi 原生 TUI、Yonder 内容适配、双语/补全与任务闭环（已实现，完整交互验收未关闭） | 评审与实现终端交互 |
| 2 | [decisions.md](decisions.md) | 关键取舍及理由 | 想改设计的人 |
| 2 | [tasks/](tasks/README.md) | 0.1 的实现任务、状态表与实现循环的规则，每条引用规范的具体行 | 实现者 |

## 原 N 轮实施依据（已批准，N00 已对齐冻结）

- [10 本机运行与项目自维护](spec/10-local-maintenance.md)、[11 官方插件与常规工具](spec/11-official-plugins.md)：下一阶段功能、边界和验收；用户已于 2026-10-18 授权补齐并启动，见 D26。
- [合并实施计划](tasks/next-mcp-self-maintenance.md)、[N00–N14 任务](tasks/next/README.md)：只安排实现顺序、负责人、路径和检查，不重复功能设计。
- [参考快照与本机证据](tasks/next/reference-sources.md)：用户授权更新后的实际来源；不作为已实现声明。

N00 已将本轮批准条款与受影响旧条款统一；冻结提交见 N00 结果，普通实现不再修改功能规范。未受影响的 0.1 规范与全部原验收继续有效。

2026-10-18 用户另行授权修订基础终端交互规范并要求先看方案，见 [12](spec/12-terminal-interaction.md) 和 D30。按用户后续纠正统一沿用 pi 原生界面与交互，关联 02/03/06–09 的新增条款同属已批准新增设计，不代表已实现，也独立按 U00–U04 实现，不并入 N00–N14 的原任务范围。

## 规范用语

- **必须 / 禁止**：违反即为缺陷。
- **应当**：除非文档写明的例外，否则照做。
- **可以**：可选。
- 标 `〔0.1 不实现〕` 的段落定义接口或约束，0.1 不写实现，但 0.1 的代码不得与之冲突。

## 版本目标

当前目标：**0.1**——内核完整、能用真实模型跑起来、接口冻结到足以让外部开始写插件。
0.1 的范围见 [tasks/README.md](tasks/README.md)。

T/N/U/C/R/F各轮已有实现及阶段验收，当前状态统一见本页顶部总账；不再等待U05或重开C/R轮。“已实现”仍不等于验收通过。具体见 [tasks/README.md](tasks/README.md)。
