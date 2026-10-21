# 06 输出与投递

harness 决定模型怎么执行、怎么回复；渠道只决定怎么呈现。

12 §7 的 task 只读控制面观察：观察不是渠道或等待者，不改变本文的回复去向，不产生 message.out。最终显示从实际转录与运行事实取得，不能把观察连接当成新的自动投递目标。

## 1. 四类输出

| 类别 | 触发 | 例子 |
|---|---|---|
| 回到来源 | 运行的最终回复，自动发回它所回答的输入的来源 | QQ 里一条气泡；主会话里，CLI 来的问题回 CLI，飞书来的回飞书 |
| 过程流式 | 绑定 `stream: true` 且渠道 `output.stream` 为真 | 飞书卡片实时显示进度；CLI 实时打印 |
| 主动发送 | 工具 `message_send`、插件 `api.messages.send` | 在 CLI 里说"发我飞书"；agent 自己决定通知主人 |
| 返回给调用方 | 运行有等待者：`task_run`、`sessions.submit({ wait: true })`、`events.ask`、`agent_ask` | 编码预设把结果交回主 agent；MCP 调用拿到返回值；另一个 agent 拿到答复 |

## 2. 最终回复的去向

一次运行回答一组输入：开始它的那条，加上运行中以 `steer` 并入的（pi-durable 让它们共享同一个回答）。这组输入记在 `run.end.data.inputs`。**来源** = 这些输入事件中、`conv` 属于某个渠道实例的那些 `conv`，去重后按输入顺序排列（触发器的 `conv` 不是渠道，不算来源）。

运行结束时得到最终文字 T，按顺序判断，命中即止，结果记入 `run.end.data.replied`：

1. T 去掉首尾空白后为空，或恰好是 `NO_REPLY` → 不发，`none`。
2. 对有等待者的输入返回调用方；抑制该次输入的自动最终回复，其他已接纳来源仍按下条处理。只有调用方接收时记 `caller`。
3. 有来源，且把该输入送进来的绑定是 `reply: auto` → 发往每个这样的来源（自动回复携带原消息 `sourceMessageId`，渠道按呈现策略决定是否引用；显式 `replyTo` 不变），`source`。
4. 开始本次运行的绑定有 `deliver` → 发往 `deliver.to`（经 `deliver.via`），`deliver`。
5. 否则不发，`none`。

`deliver.to` 可以是 `owner`、`person:`、`acct:` 或 `conv:`；目标是人时按 §5 的规则选账号。

同一轮既返回等待者又向其他来源回复时，replied 记 source；它概括渠道去向，不替代调用方的返回结果。投递结果不明用现有 delivery.ok=false、error=DELIVERY_UNCERTAIN 表示，不自动重发。

运行被重复空转保护、显式取消或错误结束时（07 §5），结果同样交等待者，并向第 3 步的自动回复来源说明停止原因。run.end 保存实际模型和回复选择；模型终态与渠道送达独立，渠道等待不占会话执行权。跨重启交付不确定时保留未知，不自动重发（10 §1）。

## 3. 流式

渠道收到 `AsyncIterable<OutputPart>`，自行决定呈现方式：

```ts
type OutputPart =
  | { type: 'message_start'; id: string }  // 原生 assistant 消息的生成时间标识，限当前 run
  | { type: 'text'; delta: string }
  | { type: 'message_end'; text: string }  // 一条 assistant 消息结束，不代表任务结束；被新输入中断的正文为空
  | { type: 'tool'; phase: 'start' | 'end'; name: string; label?: string; ok?: boolean }
  | { type: 'final'; text: string }          // 已按 §2 判定为要发往这个渠道时才出现
  | { type: 'error'; message: string };
```

内核从 pi-durable 的实际 run/inputs 生成这些片段，流式最初发给开始运行的输入来源，归属不能由异步提交 Promise 是否结束推断。后到 steer 保留已发出的完整阶段性气泡；被新输入中断的生成不作为最终回答投递，已可见的部分停止增长并收尾，不能承诺撤回平台已显示内容；该次输入有等待者时不新开流（10 §1）。渠道可以只用 final，也可以渲染完整过程。

流式按一条 assistant 消息开闭，不按整轮任务开闭。内核传递原生消息边界；非空、非 NO_REPLY 的每条消息各自通过一次 channel.stream 投递，在 message_end 时以该条完整正文 final 并结束迭代。工具执行、后台等待不保持上一气泡生成；后续阶段汇报和最终回复分别新建消息，前文不覆盖。纯工具/空消息不建气泡。CLI 每条消息结束换行，不重复打印相同正文。

发送尝试按 session/run/target/message 去重；message 取原生 assistant timestamp（运行内生成标识），最终回执从 answer 使用同一标识，恢复后已尝试的同一消息不重发。旧无 message 的尝试仍按整轮处理，不能据缺失边界猜测旧历史。每条流结束立即记录自己的 message.out；结果不确定记录 unknown，不因最终回复再补发副本。整轮结束不重发已投递的最终消息；未开启流式的来源仍自动 send 最终回复，错误/取消另发终止说明。模型终态不等渠道网络。后台完成继续经原 runtime.tool-result 唤醒，无需用户追问，不增加调度器、转录或定时催促。为避免显示控制标记，内核暂存仍可能构成 `NO_REPLY` 的起始增量，确认不是该标记后继续输出；已经显示的正常过程不撤回。`reply: none` 或有等待者时不启动渠道流式。

## 4. 告诉模型的规则（框架段内容）

框架段（03 §5.2）用几句话说明：

- 你的最终回复会自动发回这条消息的来源；
- 不需要回复时，只输出 `NO_REPLY`；
- 要发给别的人、别的渠道，用 `message_send`；要问别的 agent，用 `agent_ask`；
- 专门任务可以交给 `task_run`；有可用 skill 时，用 `skill_view` 读取（03 §6）；
- `<turn>` 块里的 `notice:` 是给你的内部信息，知道即可，不必主动告诉对方。

阶段汇报后仍需自行执行时，继续调用工具或用 task_continue({text}) 将具体下一步持久排入同会话；后台工具已返回句柄时已有自动完成通知，不重复安排轮询。最终回复结束本轮，不等于交办目标完成；不要声称未被运行时接纳的工作仍在执行。不追加"是否要发送"的确认轮，不要求用工具结束运行（架构不变量 6）。

## 5. 主动发送

```ts
message_send({ to: 'owner' | Ref, via?: string /* 渠道实例 */, text: string, attachments?: Attachment[] })
```

- 发往本次运行的来源不需要额外能力；发往其他地方需要 `message` 能力（05 §1）。
- `to` 是人（`owner` 或 `person:`）时：有 `via` 就用这个人在该渠道的账号；没有 `via` 就用这个人最近活跃的账号。找不到账号时以错误结果返回给模型。
- 每次发送写一条 `message.out` 事件，`delivery` 记录渠道返回的结果。
- 插件用 `api.messages.send`，只接受显式的 `person:`、`acct:`、`conv:` 目标，不接受 `owner`（全局插件不属于某个 agent）；插件可信，不受模型的能力过滤，`message.out` 的 `from` 是 `plugin:<id>`。
- 人解析成账号后，将 `acct:` 交给对应渠道的 send，由渠道投递到该账号的私聊；不得用该账号最近发言的群作为替代。message.out 的 conv 仅在目标为 conv: 时填写，账号目标保存在 data 的可选 `to: Ref` 中。
- 富消息（卡片等）由渠道插件以自己的工具提供，例如 `feishu_send_card`。

## 6. agent 之间

```ts
agent_ask({ agent: string, text: string })   // 需要 message 能力
```

- 内核在内部渠道 `agent` 上写一条 `message.in`：`from = acct:agent:<发起方>`，`conv = conv:agent:<发起方>`，`kind: agent`，`data.target` 为指定目标，`parent` 指向发起方本次运行的触发事件。无 agent 身份的预设会话不能调用 agent_ask。
- 目标 agent 的绑定决定收不收、进哪个会话、用哪个配置档。没有命中时，工具返回错误"目标 agent 不接收你的消息"。
- 这是 `events.ask`：目标的回复作为工具结果返回给发起方，不会再作为消息发回，因此不会来回循环。
- 形成环时拒绝：沿 `parent` 追溯，若目标 agent 已在这条 `agent` 渠道调用链上，返回错误。

## 7. 失败

渠道 send 失败时记录 message.out。Delivery.retryable 仅表示可确定整条消息尚未发送的瞬时故障（如 DNS/建连失败，或发消息前获取 token 时断网），且不得与 id/uncertain 并用。尚未显示的流式消息在关闭后保存完整正文，确认未发送时也沿普通send补达；已有可见卡片不补发副本。内核从原 message.attempt/message.out 保存的正文/目标/身份补达，沿同一尝试并记录每次结果，在线退避与重启均恢复，不重跑模型或业务工具；停止服务释放计时器。真实鉴权拒绝和确定业务错误不自动重试。部分成功或真正结果不确定记 message.unknown，不自动重发。历史尝试缺正文、结果未知时不猜测补达。

## 8. 普通模型发送

普通评论/消息工具与 message_send 使用共同投递入口；模型代发须携带真实 ToolContext，保留 session/来源和发送尝试。附件按 05 的 read 能力、当前 env、真实 cwd/本轮附件规则验证；无 exec 不能借上传读取工作区外文件。供应商仅负责协议与本机/远程传输能力，无法支持当前 env 时明确拒绝。unknown 由 Delivery.uncertain 表达；消息组已部分发送时保留实际 id 和未知/失败事实，不重放整组。

## 9. 程序通知

插件可直接 messages.send 向明确 person/acct/conv 发程序通知，无模型、无伪造 Agent 回复；message.out 归属真实插件。内部 session 通知用 sessions.notify，沿 pi 原生 app-only entry 保存与观察，不经 sessions.submit，不唤醒 Agent、不进入模型消息。TUI 以程序通知独立标识来源，和真实对话按 entry 时序排列；录入回执不等于送达外部渠道或人已读。
