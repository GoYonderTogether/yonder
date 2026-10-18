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

（无）
