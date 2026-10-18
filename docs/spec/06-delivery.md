# 06 输出与投递

harness 决定模型怎么执行、怎么回复；渠道只决定怎么呈现。

## 1. 四类输出

| 类别 | 触发 | 例子 |
|---|---|---|
| 回到来源 | 运行的最终回复，自动交给会话的 `origin` | QQ 里一条气泡；主会话回到最近说话的那个渠道 |
| 过程流式 | 绑定 `stream: true` 且渠道 `output.stream` 为真 | 飞书卡片实时显示进度；CLI 实时打印 |
| 主动发送 | 工具 `message.send` | 在 CLI 里说"发我飞书"；agent 自己决定通知主人 |
| 返回给调用方 | 运行有等待者（`task.run`、`sessions.submit({ wait: true })`） | 编码预设把结果交回主 agent；MCP 调用拿到返回值 |

## 2. 最终回复的去向

一次运行结束时得到最终文字 T，按顺序判断，命中即止，结果记入 `run.end.data.replied`：

1. T 去掉首尾空白后为空，或恰好是 `NO_REPLY` → 不发，`none`。
2. 有等待者 → 交给等待者，`caller`。
3. 绑定 `reply: auto` 且会话有 `origin` → 发往 `origin`，`origin`。
4. 绑定有 `deliver` → 发往 `deliver.to`（经 `deliver.via`），`deliver`。
5. 否则不发，`none`。

`deliver.to` 可以是 `owner`、`person:`、`acct:` 或 `conv:`；目标是人时按 §5 的规则选账号。

## 3. 流式

渠道收到 `AsyncIterable<OutputPart>`，自行决定呈现方式：

```ts
type OutputPart =
  | { type: 'text'; delta: string }
  | { type: 'tool'; phase: 'start' | 'end'; name: string; label?: string; ok?: boolean }
  | { type: 'final'; text: string }          // 已按 §2 判定为要发往这个渠道时才出现
  | { type: 'error'; message: string };
```

内核从 pi-durable 的事件流生成这些片段。渠道可以只用 `final`（例如 QQ 只发一条），也可以全部渲染（例如飞书卡片）。

## 4. 告诉模型的规则（框架段内容）

框架段（03 §5.2）用几句话说明：

- 你的最终回复会自动发给当前对话的对方；
- 不需要回复时，只输出 `NO_REPLY`；
- 要发给别的人、别的渠道，用 `message.send`；
- 专门任务可以交给 `task.run`。

不追加"是否要发送"的确认轮，不要求用工具结束运行（架构不变量 6）。

## 5. 主动发送

```ts
message.send({ to: 'owner' | Ref, via?: string /* 渠道实例 */, text: string, attachments?: Attachment[] })
```

- 发往当前 `origin` 不需要额外能力；发往其他地方需要 `message` 能力（05 §1）。
- `to` 是人（`owner` 或 `person:`）时：有 `via` 就用这个人在该渠道的账号；没有 `via` 就用这个人最近活跃的账号。找不到账号时以错误结果返回给模型。
- 每次发送写一条 `message.out` 事件，`delivery` 记录渠道返回的结果。
- 富消息（卡片等）由渠道插件以自己的工具提供，例如 `feishu.send_card`。

## 6. 失败

渠道 `send` 失败时，内核写 `message.out` 并在 `delivery` 里记录错误，不重试；短暂故障的重试由渠道插件自己负责。
