# T09 投递与内置工具

**依据**
- `docs/spec/06-delivery.md`（全文）
- `docs/spec/05-security.md`（内置工具能力表）
- `docs/spec/03-agents.md`（`task_run`）
- `docs/spec/02-sessions.md`（身份查询、会话接口）
- `docs/spec/01-events.md`（`message.out`、`run.end`）
- `docs/spec/07-runtime.md`（上限结束时的说明）

**路径**：`packages/core/src/delivery/`、`packages/core/src/tools/`

**必须**
- 每次运行结束：按 06 §2 确定输入与来源，五步判定去向，写 `run.end`（含 `inputs`、`replied`）；回复渠道原消息时带 `replyTo`。
- 流式：开始运行的那条输入的绑定开启 `stream` 且渠道支持时调用 `channel.stream`。
- 上限或错误结束时向来源说明（07 §5）。
- 内置工具：`message_send`、`agent_ask`（06 §6，含成环检测）、`task_run`、`session_list`、`session_read`、`identity_lookup`、`identity_link`，能力严格按 05 §3 的表。
- `api.messages.send` 的实现（与 `message_send` 同规则，`from` 为 `plugin:<id>`）。
- 每次发送写 `message.out`。

**禁止**：追加确认轮；要求用工具结束运行；内核重试发送。

**验收**（真实模型）：普通回复回到来源；`NO_REPLY` 不发送；主会话里 CLI 实例 A 的运行进行中、实例 B 的消息排队，两个回答各自回到 A 与 B；要求"发给 owner 的另一个渠道"时经 `message_send` 送达（用 channel-cli 的第二个实例代替外部渠道）；`task_run` 返回结果；两个 agent 之间 `agent_ask` 得到答复，A→B→A 被拒绝；`readonly` 配置档调用 `session_read` 被拦下。

## 问题

- 第一轮未执行真实模型投递验收，原验收全部保留第二轮：双渠道排队／steer 的 final 去重、实际发送失败、agent_ask 调用链、task_run 子会话中止与恢复。
- Router 的 onStart 发生于提交前，没有 pi runId。实现按会话保留第一条输入的活动槽，收到过程片段或判定最终投递时才启动 stream；followup／steer 与异步渠道结束交错需第二轮实际组合验收。
- SDK ToolContext.event 目前仅给开始运行的触发事件，message_send 的免 message 能力判定依据该事件的 conv；被 steer 并入的其他来源的免能力判定尚缺运行来源接口，第二轮核实。
- run.end.model 从运行结束时 resolveSession 取得；若运行中热重载修改模型，实际运行模型的精确归属需第二轮与 runtime 一并核实。
- 无 agent 的预设会话事件省略 from；规范事件表只列 agent/plugin，未明确定义这种情况下的归属。未新增身份字段或虚构 agent。
- task_run 对已有 owned child 复用 session.input 事件并使用 pi task requestId；跨进程崩溃窗口内的外部投递恰好一次语义尚未验收。


## 结果

第一轮：已实现（待验收）。

- `delivery/index.ts`：五步最终回复判定；按输入顺序去重渠道来源，回复携带原消息 msgId；流式延迟启动、NO_REPLY 起始片段暂存、单目标 final/send 去重，stream Delivery 与 send Delivery 都写 message.out；错误／上限向自动回复来源说明；每次运行写 run.end（inputs/replied/model/usage）。渠道异常转失败 Delivery，不重试。
- `sendPlugin` 使用 plugin 身份、显式引用；`sendTool` 支持 owner／person 解析与最近活跃账号，调用前检查来源外 message 能力。人解析后将 acct 引用直接交渠道发送，未使用最近群代替私聊。
- `tools/index.ts`：7 个内核 SDK 工具及参数 schema、能力声明与调用时检查。agent_ask 走 events.ask 绑定，沿 parent 检查环并响应取消；会话／身份查询按 admin、cross-agent 和当前发送者过滤。
- task_run 通过 Runtime.runTask 的 pi task ownership 创建同一个 child，不再调用 sessions.open；写入该 child 的 Yonder 元数据与 pi session state，能力取预设与调用方交集，继承 cwd/env；复用输入事件、可注入 T08 prepareInput，结果交调用方并关闭会话。
- 对外组装：createDelivery 返回 onStart/onRun/sendPlugin/sendTool；createCoreTools 接受 store/agents/sessions/runtime/delivery/ask/getPreset，以及可选 presets、prepareInput。已与 T07 和主 agent 对齐。
- 实际检查：`npx tsc -b packages/core --pretty false` 通过；`npx vitest run packages/core/src/delivery/delivery.test.ts` 为 1 文件通过、1 测试通过（NO_REPLY 分片隐去及正常过程前缀无丢失）；`npx biome check --write packages/core/src/delivery packages/core/src/tools` 通过，无警告。未请求模型，未修改用户数据或发送外部消息。
