# T14 飞书回复账本只读排查（2026-10-28）

## 范围与口径

- 本机时区 UTC−04:00，最近三个自然日：2026-10-26 00:00:00 至 2026-10-28 10:32:12，左闭右开；下列样例时间均为 UTC。
- 只读 `~/.local/share/yonder-harness/home/.yonder/state.db` 的 `y_events`，目标 `conv:feishu:`、`conv:feishu-*:` 或 `data.to` 为 `acct:feishu*`；关联 `message.attempt`。范围是账本中这些目标的事件，不是飞书服务器完整历史。覆盖本机发现的 `feishu`、`feishu-hermes`、`feishu-z-fish`、`feishu-gpt-senpai` 实例，未假定每个实例都有符合窗口的记录。
- 共 151 条 `message.out`：`delivery.ok=true` 142 条、`false` 9 条。成功代表渠道返回成功，不等于用户已看到或已读；失败不等于一定未产生任何外部副作用。
- 已查阅项目必读文档、`docs/spec/06-delivery.md`、`/Users/zoran/Documents/yonder-lead/program/source/owner-messages.md:256` 的 O49 原文和 `/Users/zoran/Documents/yonder-lead/program/agent-ux/O49/cards/T14.md:1`。O49 提出渠道失败、重复回复及飞书问题；T14 将本项细化为上述五类只读排查。本报告不覆盖 O49 中其他任务，也不将零匹配视为修复完成。

## 结果

| 类别 | 可证明结果 | 限制 |
|---|---|---|
| 重复发送 | 0 组：同一 attempt 有多个不同成功平台消息 ID；另查同目标、同 session、同 run、非空正文完全相同的成功记录，0 组 | 这是两种严格匹配的账本结果，不证明无跨轮、不同正文、缺少关联或未记录的重复；相同正文也不天然证明误发。 |
| 空回复 | 0 条可证明为空消息；有 2 条成功记录正文为空，但均带附件，分别有 1、4 个附件 | 不能把附件消息算作空回复；账本也不证明客户端实际渲染。 |
| 失败提示 | 2 条成功记录匹配当前 `stopNotice` 的固定终止提示模板 | 只统计这些精确模板，不涵盖模型自由文本或历史其他模板；不代表已读。另有 9 条投递失败记录，不能直接等同于用户收到失败提示。 |
| `NO_REPLY` 泄露 | 成功 `message.out` 正文包含字面 `NO_REPLY` 为 0 条 | 只覆盖最终账本正文；不排除流式增量瞬时泄露或账本外发送。 |
| 气泡未关闭 | 无法从本次账本证明或计数 | `message.out` 并非客户端气泡生命周期记录；缺少可直接对照的创建、关闭和客户端展示事实。 |

## 样例

仅列事件 ID、可取得的平台 message ID 和 UTC 时间，不记录正文、会话或个人信息。平台 ID 取自该事件的 `data.delivery.id`；每类最多两条。空正文样例用于说明附件例外，并非空消息缺陷。

- 空正文附件：`01M5XHTYME984PJC7A53HA1JBV` / `om_x100b613437e75cb8cff5cf00a19a627` — `2026-10-27T02:08:11.918Z`；`01M5XN8HZBJ1M5TZ27MVTB9HC4` / `om_x100b6135176c9484ddb3d944f4a1e51` — `2026-10-27T03:08:03.435Z`。
- 固定失败提示：`01M60ANAX9TF9J4W290EHDP6FS` / `om_x100b612378a754b0cf453aa9ce0c4b7` — `2026-10-28T04:00:31.145Z`；`01M60JHXV3HMGFDC1X1G6WXG0M` / `om_x100b612d7577ccacb4ca0dc66d220f4` — `2026-10-28T06:18:28.067Z`。
- 投递失败记录：`01M5WF6TKGXQG929GMG8M7C03Y` / 平台 ID 不可得 — `2026-10-26T16:03:00.848Z`；`01M5WF6YKEA78PV5B7X97W5QKK` / 平台 ID 不可得 — `2026-10-26T16:03:04.942Z`。两条关联同一 attempt，不代表两次独立业务发送。

本次未发送消息、未访问飞书服务端或客户端、未运行模型，也未修改账本。快照截止后的新增事件不在统计内。

## 代码发现与验证边界

- 修复同事发现共享投递的两个路径丢失入站平台 `sourceMessageId`：控制标记前缀形式的短普通回复在消息结束后走普通发送时未携带；流式消息确定未发送后，其关闭正文进入账本和重启恢复补发时未保留。`packages/core/src/delivery/index.ts` 现将该 ID 带入短回复和流关闭记录，`packages/core/src/store/index.ts` 从关闭记录恢复补发内容时保留该 ID。
- 飞书的 `plugins/channel-feishu/src/channel.ts` 将此 ID 传给 `interaction.beforeReply`；后者据此处理既有反应及在来源不再是最新消息时选择引用目标。是否实际形成引用取决于会话状态，并非每条回复都必须显示引用。
- 本次独立运行 `npx vitest run packages/core/src/delivery/delivery.test.ts -t 'an ordinary message that is a control-marker prefix is released at message end|a wholly unsent streaming message recovers its full closed text from the same ledger after restart'`：1 个文件通过，2 条通过、24 条跳过。测试分别断言短回复发送和重启后的确定未发送补发携带来源 ID；使用测试渠道和模拟流失败，不是真实飞书 SDK 回放、真实模型或客户端验收。
- 这证明源码中存在并修正了来源 ID 丢失路径，**不能证明它是主人所见重复发送的根因**，也不能证明其他重复、失败、气泡关闭或全部渠道问题已修复。尚未确认改动已构建、安装或部署到日用服务；旧账本不能验证新代码效果。

## 真实飞书配合验收

1. 先由负责同事在隔离 HOME 和明确授权的测试飞书会话部署待验版本，确认版本、实例、流式配置与账本位置；不要覆盖或重启日用服务。主人确认后在该会话发送一条无私人信息的测试消息，请求一条短回复；记录入站和出站平台 message ID、事件 ID、UTC 时间。
2. 在回复尚未完成时再发送一条无私人信息的引导消息，观察两条输入的回复归属、消息数量、引用目标、气泡是否结束；按实际出现的过程及最终回复分别记录，勿预设一定合并或一定出现引用。核对账本中的来源 ID、attempt、回执与客户端展示是否一致，不将单次结果推广为所有场景通过。
3. 流式失败恢复须由同事在隔离环境使用可控故障或已有测试工具，仅模拟**确定尚未发送**的失败，再恢复并核对来源 ID、单次补发和客户端结果；不在主人日用飞书人为断网或重发不确定结果。若无法安全制造该条件，则标记真实恢复未测，不用普通成功回复替代。
4. 若出现重复、空消息、失败提示、`NO_REPLY` 或未关闭气泡，仅提供相关事件 ID、平台 ID 和时间供对账；不要提供私人正文。客户端截图或录屏须由主人决定是否提供并先遮盖私人信息。

## T14r2：指定提醒的事件链复核

2026-10-28 再次只读查询同一 `y_events`，时间均为 UTC。`message.out` 是一次投递结果记录，包含失败结果，不能把每条都当作飞书实际收到的一条消息。以下记录的 `parent` 均为空，链通过 `data.attempt` 与 `message.attempt.id` 精确关联：

| 提醒时间 | attempt | 失败 out → retry → 成功 out | 成功平台 ID |
|---|---|---|---|
| 09:59，提醒 A | `01M60Z6KVM644NE5RYGVJ51DMP` | `01M60Z6PSPTVXA3HR3EC4VQA46` → `01M60Z6QS1VWDAR4M00HPGW7YS` → `01M60Z6VVJHMH0WG7SPXV1T8R6` | `om_x100b612837cfa914c30dc3357a79867` |
| 09:59，提醒 B | `01M60Z6PST6MKHJXJNQVPR4BFQ` | `01M60Z6SQQGR5H5PER8CV4R1NN` → `01M60Z6TQ9PMFMHMW0ERQ87G2H` → `01M60Z6WG2PPYT589KA22PHVTE` | `om_x100b612837c538b0def399de93e902a` |
| 13:59，QQ 接入提醒 | `01M61CYG5PWKN17ME1R217ZBFX` | `01M61CYT6FCFKEH68EVVPF87MC` → `01M61CYVFVX5WM6KF7VTCDC6YT` → `01M61CYZAJT143QBB3E7W13JDK` | `om_x100b612bb0ad18a0cfc815cac43603e` |

三条链首次结果均为 `retryable: true`，错误为 `fetch failed`、TLS 连接建立前 `ECONNRESET`，重试后各有一条成功结果。13:59 的另一条成功 out `01M61CZ0WQ8E035MFDQG11YVBE` 属于另一条任务提醒的 attempt `01M61CYT6JEBC89TH93WMTTXXQ`，正文不同，并非指定 QQ 提醒的第二个成功回执。09:59 两条提醒也各只有一个 attempt 和一个成功回执；三条 attempt 的来源均为 `plugin:tasks`，目标均为同一个 `conv:feishu:` 实例。

**结论：**这三个实例的账本证明发生了重试，不证明发送方分别调用两次、cron 双触发、两个渠道实例投递，或同一 attempt 返回两个成功的平台消息 ID。首次失败描述连接在 TLS 建立前断开，但账本未指出它发生于 SDK 的哪一次 HTTP 请求，也没有飞书服务端或客户端完整历史，因此无法据此排除首次请求已产生外部副作用，更不能将账本结果解释为主人看到的重复已排除。需要以飞书服务端/客户端记录、平台 message ID 和时间对账；本次没有访问飞书或发送消息。原首轮零匹配结论仅适用于当时所述的严格统计口径，不能排除这些重试或客户端观察到的重复。
