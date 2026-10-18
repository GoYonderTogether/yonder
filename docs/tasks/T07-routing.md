# T07 绑定解析与会话管理

**依据**
- `docs/spec/02-sessions.md`（会话、绑定、加载时校验、路由结果）、`125-134`（§4.2 相对关系）、`166-199`（§5 会话接口）
- `docs/spec/01-events.md`（`message.in`、`session.*`、`run.end`）
- `docs/spec/06-delivery.md`（内部渠道 `agent`）
- `docs/spec/08-config.md`（QQ 示例）

**路径**：`packages/core/src/routing/`、`packages/core/src/sessions/`

**必须**
- 对每个 agent 独立求值绑定表，取第一条命中；五个维度的匹配语义严格按 02 §2.1；`from` 相对 agent 解析为 owner / known / stranger。
- 会话 key 按 02 §1.1 与 §2.2（`per: person` 在未关联时退化为按账号）；新会话记录当前 harness 版本（`version`）。
- `wake: mention` 未被 @ 时按 `write` 处理；已有会话配置档与命中绑定不同时记 `dropped: 'profile-mismatch'`。
- 写入事件时附 `routes`；无命中时每个 agent 一条 `dropped`；写入后调用 `events.on` 分发器。
- 把 `wake: run` 的输入交给 T05 的会话（按 `busy` 排队），并记录每次运行回答了哪些输入（pi 的回答关系），交给 T09 生成 `run.end.inputs` 与来源。
- `ephemeral` 与 `task` 会话在运行结束后关闭，并写 `session.close`。
- `events.ask` / `io.ask`：写入事件，等待它唤醒的每个运行结束，返回 `AskResult`；这些运行有等待者（06 §2 第 2 步）。
- 实现 `SessionsAPI`（02 §5）：`open` 只开预设会话并按 03 §4 求能力交集；`submit` 只接受 `task` 会话，每次写 `session.input`。

**禁止**：规则语言、正则、任意字段路径匹配；会话级的"当前回复目标"。

**验收**：`08-config.md:78-105` 的绑定表，对 owner 私聊、好友私聊、陌生人私聊、群里未 @、群里 @、owner 来电、陌生人来电七种入站事件，各一个测试，断言命中的绑定、会话 key、wake 或 dropped；一个事件同时进两个 agent；`profile-mismatch`；`ask` 返回结果且不触发回到来源（用真实模型）。

## 结果

- 实现五维绑定首条匹配、`from` 相对身份解析、内部目标限制、会话 key 与 profile mismatch 路由；所有类型的 `events.emit` / `ask` 均可按显式 type 绑定，路由写入事件后异步提交。
- 实现 agent/task 会话管理与 `SessionsAPI`；task 能力按预设、父会话与请求能力求交集，输入可经 T08 预处理；运行按 pi 返回的 run id 去重，并传递输入事件给 T09。
- 检查：`npx vitest run packages/core/src/routing/routing.test.ts` 通过（1 项，覆盖首条匹配、会话 key 和非 `message.in` type 路由）。`npm run build` 未通过，唯一诊断位于并行 T09 文件 `packages/core/src/delivery/index.ts:94`；T07 文件无编译诊断。
- 未执行真实模型与完整任务验收，留第二轮。

## 问题

- 首次 build 曾被 T09 并行实现的 `packages/core/src/delivery/index.ts:94` 类型错误阻断：`Promise<Delivery | { ok: false; error: string }> | undefined` 不能赋给 `Promise<Delivery>`（`exactOptionalPropertyTypes`）。

- 后续接线：T09 完成后核心构建通过；以上保留首次诊断，阻塞已解除。
