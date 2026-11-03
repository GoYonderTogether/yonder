# 架构

## 1. 定位

Yonder Harness 是一个常驻的 agent 内核：**任何消息都是事件，由 harness 分发给指定 agent 的指定会话，完成工作后把输出交回去。**
除这条主线以外的一切能力（渠道、工具、上下文文件、记忆、执行环境、沙箱、审批、工作流）都由插件提供。

## 2. 主线

```
渠道/触发器/agent_ask ──事件──▶ 绑定解析 ──▶ 会话 ──▶ 运行（模型 + 工具 + skill） ──▶ 投递
                                │                │                                 │
                            身份映射         配置档（分身）                      回到该输入的来源 / 流式 /
                            （谁是谁）       决定模型、工具、级别                 主动发送 / 返回给等待者
```

1. **事件**：渠道或触发器把外部发生的事交给内核（[01-events](spec/01-events.md)）。
2. **绑定**：内核按 agent 声明的绑定表，决定这个事件进哪个 agent 的哪种会话、用哪个配置档、是否唤醒模型（[02-sessions](spec/02-sessions.md)）。
3. **会话**：一段持续的对话上下文。main / persistent / ephemeral 与预设 task，生命周期见 [02-sessions](spec/02-sessions.md)；TUI 可续聊 task 见 [12](spec/12-terminal-interaction.md)。
4. **运行**：在会话里执行一次模型循环，工具按安全级别放行（[05-security](spec/05-security.md)、[07-runtime](spec/07-runtime.md)）。
5. **投递**：运行的输出按规则交回渠道或调用方（[06-delivery](spec/06-delivery.md)）。

预设会话（编码、调研等临时工具人）不在这条线上：它们由 `task_run` 或会话接口显式打开和驱动（[03 §4](spec/03-agents.md#4-预设与临时会话)）。

## 3. 谁负责什么

| 层 | 负责 | 不负责 |
|---|---|---|
| **pi**（`pi-ai`、`pi-durable`、`pi-env`） | 模型调用与鉴权、会话转录持久化与恢复、模型循环、工具执行、压缩、子会话、按需工具、用量统计、执行环境 | 渠道、绑定、身份、agent 工作区、投递 |
| **共享 Bot 核心** | Bot 定义 schema 与解析、事件与绑定、身份与会话、提示词装配、工具暴露、插件接口、安全级别执行、运行循环与投递 | 宿主文件/进程访问、插件代码 import、CLI、安装与更新、具体渠道与策略 |
| **宿主适配** | 本机目录与 SQLite、云端 PG 与 Redis、HostFacts、插件代码加载、可选本机/远程环境；本机另含 CLI、安装与更新 | 另写一套 Bot 解析、提示词或运行循环 |
| **插件** | 通过插件槽提供：渠道、工具、上下文、触发器、执行环境、钩子、预设、skill | 绕过内核直接改会话或事件存储；import pi 的包 |

共享实现的唯一入口为 `@yonder/bot-core.createBot`：本机 `@yonder/local-host.openKernel` 与云端宿主都调用它，不复制路由/会话/投递或运行循环。`@yonder/runtime-adapter` 是唯一 pi 适配包，默认入口只含运行算法和注入契约，`/node` 与 `/postgres` 是显式宿主子路径；本机存储入口不要求注册本机环境，环境由宿主另行组合。消费者直接依赖 `@yonder/bot-definition`、`@yonder/bot-core`、`@yonder/runtime-adapter` 或实际宿主包；删除旧 `@yonder/core` 兼容门面。SDK 的纯注册/collector 独立于 testing/Node 入口，避免共享入口传递加载 FS。保留原 SDK `executionContext(signal)`：index 仅使用 chord/context 的 `BACKGROUND_CONTEXT`、`withAbortSignal` 构造纯取消上下文；pi-ai/pi-durable 仍只能 import type，该精确例外由层级检查限定。

共享 Bot 核心只依赖 Bot 定义来源、工作区与运行状态存储、插件私有存储、运行环境能力、调用方注入的 HostFacts 和模型调用。本机宿主组合目录 + SQLite 存储与可选本机环境；云端宿主组合 PostgreSQL + Redis 存储与无本机环境，按需接入远程设备。核心禁止 import `node:fs`、`node:child_process`、`node:os` 或直接读取 `process.*` 宿主事实，由 `scripts/check-layers.mjs` 强制。轻量组合不包含本机环境层，完整版追加该层；本次不改安装脚本。

内核只通过一个运行时适配层调用 pi（[07-runtime §1](spec/07-runtime.md#1-对接边界)）。

基础 TUI 属于 CLI 客户端，直接沿用 pi v1.3.0 的原生界面、主题与交互，以 pi-tui 和 coding-agent UI 模块承载 Yonder 内容，按 12 §6 精简角色标记与固定底部信息、适配常用键位，不运行第二个 agent 内核。管理命令主要面向 agent/脚本，同时保持人可读；TUI 面向人的输入、阅读与目标选择。channel-cli 仍是渠道插件，任务会话可直接经控制面驱动；具体方案与审核边界见 [12](spec/12-terminal-interaction.md)。

## 4. 核心概念

| 概念 | 定义 | 详见 |
|---|---|---|
| 事件 Event | 系统里发生的一件事，只追加、不修改 | [01](spec/01-events.md) |
| 引用 Ref | 指向任何实体的字符串：账号、会话、群、人、agent | [01 §2](spec/01-events.md#2-引用-ref) |
| 绑定 Binding | agent 声明的"哪类事件 → 哪种会话、哪个配置档、怎么唤醒" | [02 §2](spec/02-sessions.md#2-绑定) |
| 会话 Session | 一段持久的对话上下文，对应 pi-durable 的一个 conversation | [02 §1](spec/02-sessions.md#1-会话) |
| 身份 Identity | 跨渠道、跨 agent 的"这是谁" | [02 §4](spec/02-sessions.md#4-身份映射) |
| Agent | 有身份和工作区的常驻智能体 | [03 §1](spec/03-agents.md#1-两类执行者) |
| 配置档 Profile | 一次运行用什么：模型、工具、指令、级别、执行环境。属于 agent 时叫分身 | [03 §3](spec/03-agents.md#3-配置档) |
| 预设 Preset | 不属于任何 agent 的配置档，用于临时会话（编码、调研……） | [03 §4](spec/03-agents.md#4-预设与临时会话) |
| Skill | Agent Skills 标准的一个目录（`SKILL.md` + 附属文件），索引进 system，按需读取 | [03 §6](spec/03-agents.md#6-skill) |
| 插件 Plugin | 一个发布单位，可向多个插件槽注册多个贡献 | [04](spec/04-plugins.md) |
| 插件槽 Slot | 内核定义的接口，不是目录 | [04 §3](spec/04-plugins.md#3-插件槽) |
| 执行环境 Env | 工具在哪里执行：本机、远程主机、容器 | [05 §4](spec/05-security.md#4-执行环境) |

## 5. 不变量（任何改动都不得违反）

1. **事件只追加。** 后来的事实是新事件，不改旧事件。
2. **agent 只经绑定唤醒。** 给 agent 的一切输入（渠道消息、触发器、外部调用、别的 agent）都是事件，由绑定决定进哪个会话；没有绑定命中，就不花一个 token，但事件照样记录并写明原因。预设会话只由显式调用（`task_run`、会话接口）唤醒，同样留下事件（`session.input`）。
3. **插件提供能力，agent 决定用不用。** 插件装上不等于生效：工具、上下文、钩子只在 agent 或配置档选择了它们时进入运行。
4. **会话状态只归 pi-durable 管。** Yonder 记录"哪个事件进了哪个会话"，不复制转录。
5. **安全只有一层：能力 + 级别。** 判定点只有两个——工具是否提供给模型、工具调用前是否放行（[05](spec/05-security.md)）。不存在第二套审批或验收机制；以后要加审批，写成钩子插件。
6. **完成的定义交给模型。** 一条消息结束只关闭气泡；一次运行在模型给出最终回复（或明确选择不回复）时结束，不代表它等待的后台工作完成。模型仍决定交办目标是否完成：阶段汇报后的后续工作必须已有原生后台等待或 task_continue 接纳的续办输入，不能只以自然语言承诺。内核不猜测承诺、不追加"你确定完成了吗"之类的轮次。
7. **耗时可观察，取消归调用方。** 时间、轮数、tokens阈值只提醒，不截断正常任务；显式abort、真实协议限制和防重复空转仍生效。长工具由共享后台执行边界托管，见[14](spec/14-execution-capabilities.md)。
8. **工作区经由存储能力访问。** agent 的文件可以在本机、远程设备或数据库虚拟工作区；内核通过 WorkspaceFiles 读写，目录实现使用执行环境，数据库实现按租户与 Bot 隔离，不假设本地文件系统。
9. **配置可热重载，代码不热重载。** 重载先校验，失败保留旧配置并报告原因。
10. **不写假数据。** 产品代码、模板、示例不含模拟模型或虚构内容；需要模型的测试用真实模型。

## 6. 内核分层与规模预算

共享内核必须小到一个模型能完整读懂并安全修改。`packages/bot-core/src` 的业务模块按下列层级组织，只允许依赖本层或更低层（含 `import type`）；定义解析在 `packages/bot-definition`，唯一 pi 运行适配在 `packages/runtime-adapter`，本机资源装配在 `packages/local-host`。删除旧 `packages/core`；层级检查覆盖全部 workspace 包和真实宿主子路径。

| 层 | 模块 | 职责 |
|---|---|---|
| L0 | store（含 db）、config、signals、status | 存储、配置解析与纯谓词；不含领域流程 |
| L1 | permissions；独立 runtime-adapter 包 | 纯权限叶子能力与唯一 pi 对接（[07 §1](spec/07-runtime.md#1-对接边界)） |
| L2 | sessions、tools、skills、prompt、retention | 会话接口、内核工具、提示词与保留 |
| L3 | routing → delivery | 绑定求值与投递 |
| L4 | kernel、plugins、views | 共享组合根、纯插件注册/服务接线；本机 control/release/imports/管理归 local-host |

- 上层能力通过构造参数或回调注入下层，不反向 import。createBot 接收来源、已打开的 Store、runtime 工厂、已解析插件描述符、私有存储工厂、共享 scheduler、环境能力及 HostFacts；动态 import、磁盘清单/skills 校验与本机生命周期归宿主。
- 运行时接收已构造的模型/凭据解析、health/quota/watch、环境/附件/缓存和图片能力，不从默认入口反向载入 Node 子路径。watch/poller 调度归宿主，不给每 Bot 留 interval。notifications/budget 的持久读取归 Store 两实现，共享层只保留策略算法。
- check-layers 检查真实共享包和 workspace 传递导入：禁止共享入口触达 local-host、adapter/node/postgres、SDK testing/node-storage 等宿主路径；禁止 fs/child_process/os（裸名与 node:、子路径、动态导入）及直接 process 宿主事实。文本中的示例不作为运行访问；纯 crypto/path 可用。检查使用现有 TypeScript scanner 保留模板插值；共享源码将 `process`/`globalThis` 留作宿主全局标识，不以局部同名变量规避检查，对象自己的 `obj.process` 属性不误报。
- 单个源文件不超过 500 行；超限文件登记在 `scripts/file-size-baseline.json`，只减不增。层级违规同样有基线检查，只减不增。
- 具体策略（某个渠道、某种群聊参与方式、某个平台的规则）写成插件；内核只保留不变量要求的部分：绑定合成与复核、身份关系、能力级别判定、事件与投递。

## 7. 宿主记录事实

凡是"谁、在什么时候、凭什么让 agent 做了什么"，由宿主记录，不依赖模型的叙述：输入事件与路由结果（含丢弃原因）、运行事实、投递回执、授权来源回溯（沿持久事件逐跳核验）。模型可以判断，但它的说法不是事实来源。新增能力若需要"证明某事发生过"，必须落在这些宿主记录上。

后续方向（只记方向，未实现、未批准为接口）：以任务而不是聊天作为长期工作的单位；后续消息按订阅归入已有任务；授权随任务记录来源与范围；推断出来的工作先只观察、判断可靠后再放开。参考来源与对比见 `proposals/convergence/plan.md`。

## 8. 范围与边界

内核之外的官方插件（渠道、浏览器、搜索、cron、MCP 客户端、自动化等）放在同仓库 `plugins/` 的独立 SDK 包，清单见 [plugins.md](plugins.md)；供应商实现不进内核。

多设备执行契约见[18](spec/18-device-execution.md)。当前已有 execution-only、持久命令账本、设备插件、私网/云中继及 Linux 桌面后端；源码能力不等于各平台和生产真实验收。主人批准的云端运行、多资源工作区与模型来源实现契约见[19 §7](spec/19-device-workbench.md#7-运行位置资源工作区与模型2026-11-02-主人批准实施)，进展与验收分别记录。

通用记忆引擎（语义召回、自动画像）、通用工作流、审批平台、通用沙箱管理与自动 PR 审核合并不在当前范围；远程执行环境按 19 §7 的已批准工作台范围实现与验收；用户个人记忆库由官方插件 memory 提供（[15](spec/15-memory.md)），不进内核。04 §8 仅标明这些能力可使用的槽，不代表已实现或已验证。完整主程序的 CLI/TUI 安装目标扩至 macOS、Linux 与 Windows；平台服务与本机 IPC 见 [09](spec/09-cli-release.md)，macOS Helper 仍限 macOS，状态栏在 macOS 与 Windows 提供、Linux 不做，桌面客户端按平台各自构建与验收（[09 §6.2](spec/09-cli-release.md)）。平台适配代码不代表各平台安装与运行已验收；实际状态见 [status.md](status.md)。
