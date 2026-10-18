# T07 绑定解析与会话管理

**依据**
- `docs/spec/02-sessions.md:1-101`（会话、绑定、路由结果）
- `docs/spec/02-sessions.md:113-122`（§4.2 相对关系）
- `docs/spec/02-sessions.md:135-151`（§5 会话接口）
- `docs/spec/01-events.md:40-70`（`message.in`）

**路径**：`packages/core/src/routing/`、`packages/core/src/sessions/`

**必须**
- 对每个 agent 独立求值绑定表，取第一条命中；五个维度的匹配语义严格按 02 §2.1；`from` 相对 agent 解析为 owner / known / stranger。
- 会话 key 的计算按 02 §1.1 与 §2.2（`per: person` 在未关联时退化为按账号）。
- `wake: mention` 未被 @ 时按 `write` 处理。
- 写入事件时附 `routes`；无命中时每个 agent 一条 `dropped`。
- 维护 `origin`：每次唤醒运行时更新为该入站事件的 `conv`。
- `ephemeral` 与 `task` 会话在运行结束后关闭，并写 `session.close`。
- 实现 `SessionsAPI`（02 §5）。

**禁止**：规则语言、正则、任意字段路径匹配。

**验收**：`08-config.md:73-96` 的 QQ 绑定表，对 owner 私聊、好友私聊、陌生人私聊、群里未 @、群里 @、通话六种入站事件，各一个测试，断言命中的绑定、会话 key、wake；一个事件同时进两个 agent 的测试。

## 问题

（无）
