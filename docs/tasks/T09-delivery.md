# T09 投递与内置工具

**依据**
- `docs/spec/06-delivery.md:1-64`（全文）
- `docs/spec/03-agents.md:77-84`（`task_run`）
- `docs/spec/02-sessions.md:123-184`（`identity_lookup`、会话接口）
- `docs/spec/05-security.md:5-20`（`message`、`cross-agent`、`admin`）
- `docs/spec/01-events.md:41-86`（`message.out`、`run.end`）

**路径**：`packages/core/src/delivery/`、`packages/core/src/tools/`

**必须**
- 最终回复去向的五步判定（06 §2），结果写入 `run.end.data.replied`。
- 流式：绑定开启且渠道支持时调用 `channel.stream`。
- 内置工具及其能力：`message_send`（发往当前来源以外需 `message`）、`task_run`、`session_list` / `session_read`（跨 agent 需 `cross-agent`）、`identity_lookup`（跨 agent 信息需 `cross-agent`）、`identity_link`（需 `admin`）。
- 结束运行（含 `limit`）时按 07 §5 向来源说明。
- 每次发送写 `message.out`。

**禁止**：追加确认轮；要求用工具结束运行；内核重试发送。

**验收**（真实模型）：普通回复回到来源；模型输出 `NO_REPLY` 时不发送；CLI 会话里要求"发给 owner 的另一个渠道"时经 `message_send` 送达（用 channel-cli 的第二个实例代替真实外部渠道）；`task_run` 返回结果给发起方。

## 问题

（无）
