# card 插件

`@yonder/plugin-channel-card`（暂称），插件 id `channel-card`，渠道 type `card`。基于 `tinode-sdk` 把 Agent 作为普通 Tinode 用户接入，和飞书同类：只依赖 `@yonder/sdk`，`setup` 无副作用（[04 §5](../../docs/spec/04-plugins.md)）。**一个渠道实例对应平台上的一个 Agent 账号。**

工具名必须以插件 id 开头（[04 §2、§3.2](../../docs/spec/04-plugins.md)），所以是 `channel-card_<名字>`。

## 1. 贡献

| 槽 | 贡献 |
|---|---|
| channels | `card`：kind `dm`、`group` |
| tools | `channel-card_card_push`、`channel-card_forward` |
| skills | `card-writing`：怎样写名片 |

没有自定义事件，没有预设，没有钩子：平台上的一切消息都是普通的 `message.in`。

## 2. 配置与登录

字段为草案。

```yaml
plugins:
  - use: "@yonder/plugin-channel-card"
    config:
      owner: person:owner          # 显式指定
      endpoint: https://<名片服务地址>
channels:
  card-main: { type: card }
```

登录复用 `Channel.login(action: 'start' | 'poll', signal)`（[04 §3.1](../../docs/spec/04-plugins.md)），流程见 [architecture.md §4](architecture.md#4-关键流程)：`start` 返回页面 6 的授权链接，主人确认后 `poll` 得到结果，插件注册 Agent 账号并把令牌私有保存在 `<home>/.yonder/plugins/channel-card/`。主人的平台账号关联到配置里显式指定的 `person:`，沿用微信插件的做法（[README](../../plugins/channel-wechat-ilink/README.md)）。

`yonder channels login` 和已授权来源的 `/connect` 直接可用。授权链接放哪个字段见 [README 待决定](README.md#待决定)。

## 3. 消息映射

| Tinode | Yonder |
|---|---|
| 私聊 topic 的消息 | `message.in`，`kind: dm`，`conv: conv:card-main:<topic>` |
| 群 topic 的消息 | `kind: group` |
| `@` 提及（Drafty 的 `MN`，指向本 Agent） | `mentioned: true` |
| 发送者 `usr` | `from: acct:card-main:<usr>`，`name` 为显示名 |
| 附件 | `attachments`；Tinode 的文件地址要带令牌，插件下载到本机再给 `file://`〔待验证〕 |
| 重连 | 按每个会话记录的 `seq` 用 `since` 补收 |
| 主人 | 主人的平台账号经显式关联成为 `owner` |
| Agent 发出 | 渠道 `send`，返回平台消息 id |

Agent 回复的 Markdown 要转成 Drafty，能支持的子集待实测。流式输出第一版不做（`output.stream: false`），每条消息整条发送。

## 4. 绑定示例

沿用 [08 §4](../../docs/spec/08-config.md) 的写法，以下是草案：

```yaml
profiles:
  owner: { level: bypass, plugins: [channel-card] }
  guest: { level: readonly, contexts: [agents-md], skills: [] }
  group: { level: readonly, thinking: low }
bindings:
  - { id: owner,    match: { channel: card-main, from: owner },                session: main,                              profile: owner }
  - { id: dms,      match: { channel: card-main, kind: dm },                   session: { mode: persistent, per: from },   profile: guest }
  - { id: groups,   match: { channel: card-main, kind: group },                session: { mode: persistent, per: conv },   profile: group, wake: mention }
```

配置档怎么选是主人的事。上例只是常规做法：非主人的私聊用 `readonly`，群里只在被 @ 时唤醒。

## 5. 名片工具

主人对 Agent 说"帮我起草名片"。Agent 用现有 write 工具写 `card/`，然后调用 `channel-card_card_push`。

```text
card/
  card.md          名片正文
  assets/          图片等附属资源
  display.html     可选：展示卡片（或 display.svg）
```

| 工具 | 能力 | 作用 |
|---|---|---|
| `channel-card_card_push` | `read`、`network` | 把 `card/` 作为草稿推到名片服务，返回页面 5 的链接。可以推主人的名片，也可以推自己的名片 |
| `channel-card_forward` | `message`、`network` | 把平台上的一条消息原样转发到另一个会话 |

- 推送只产生草稿，**不能上线**：上线只能由主人在页面 5 点发布。
- 链接由 Agent 回复给主人。默认只返回链接，类比 2026-10-21 登录链接的做法：默认不由后台服务抢占桌面，显式要求才打开（[decisions.md](../../docs/decisions.md)）。
- 转发不限制内容。
- 插件随包带 `card-writing` skill，教 Agent 怎么写名片；技能的细节另写。

## 6. 对 Yonder 的要求

| 项 | 现状 | 需要 |
|---|---|---|
| 渠道、私聊、群、`mentioned`、附件、`replyTo`、登录 | 规范已有 | 不改内核 |
| 授权链接字段 | `ChannelLoginResult` 只有 `qrcodeUrl` | SDK 变更，或复用该字段 |
| 流式输出 | 渠道可选 | 第一版不做 |

任何内核或 SDK 变更都先改 `docs/`，在 `docs/decisions.md` 记一条。

## 7. 测试计划

- `checkPlugin(dir)`（[04 §7](../../docs/spec/04-plugins.md)）。
- 真实模型 `openai/gpt-6-luna` 下走通：登录、收发私聊和群消息、`card_push`、转发。缺凭据则记"未测"。
- 断线重连与离线补收。
- 未测项如实写进 `docs/status.md`。
