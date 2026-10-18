# 文档地图

> 文档就是代码的目标。代码与文档不一致时，以文档为准；要改设计，先改文档。

## 阅读顺序（渐进式披露）

| 层级 | 文档 | 回答什么 | 谁必须读 |
|---|---|---|---|
| 0 | [architecture.md](architecture.md) | 整体是什么、主线怎么走、谁负责什么、哪些规则不可违反 | 所有人 |
| 1 | [spec/01-events.md](spec/01-events.md) | 事件长什么样、存在哪 | 改内核或写渠道插件 |
| 1 | [spec/02-sessions.md](spec/02-sessions.md) | 事件如何绑定到 agent 和会话；身份映射 | 改内核或写渠道插件 |
| 1 | [spec/03-agents.md](spec/03-agents.md) | agent 工作区、配置档（分身）、预设、提示词组装 | 改内核或写上下文插件 |
| 1 | [spec/04-plugins.md](spec/04-plugins.md) | 插件包、插件槽接口、生命周期、版本 | 写任何插件 |
| 1 | [spec/05-security.md](spec/05-security.md) | 能力与级别、执行环境 | 写工具或执行环境插件 |
| 1 | [spec/06-delivery.md](spec/06-delivery.md) | 回复、流式、主动发送、不回复 | 写渠道插件 |
| 1 | [spec/07-runtime.md](spec/07-runtime.md) | 与 pi 的对接、模型与密钥配置、压缩、防空转 | 改内核 |
| 1 | [spec/08-config.md](spec/08-config.md) | 配置文件全貌与示例 | 所有人 |
| 2 | [decisions.md](decisions.md) | 关键取舍及理由 | 想改设计的人 |
| 2 | [tasks/](tasks/README.md) | 0.1 的实现任务，每条引用规范的具体行 | 实现者 |

## 规范用语

- **必须 / 禁止**：违反即为缺陷。
- **应当**：除非文档写明的例外，否则照做。
- **可以**：可选。
- 标 `〔0.1 不实现〕` 的段落定义接口或约束，0.1 不写实现，但 0.1 的代码不得与之冲突。

## 版本目标

当前目标：**0.1**——内核完整、能用真实模型跑起来、接口冻结到足以让外部开始写插件。
0.1 的范围见 [tasks/README.md](tasks/README.md)。
