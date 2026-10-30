# 微信 iLink 渠道

原生 Yonder 插件 `@yonder/plugin-channel-wechat-ilink`，渠道 type 为 `wechat-ilink`。从 AI-Being 迁入二维码登录、长轮询、上下文令牌、文本与媒体协议，改接 Yonder SDK 的身份、事件、绑定和投递。没有 OpenClaw/Hermes 或旧 Being 运行内核。

## 接入现有系统

在已有 `yonder.yaml` 合并下列插件和渠道配置；`person:owner` 是 `yonder init` 创建的人，应替换为实际 `agent.owner` 对应的已存在引用。配置中不写 token。

```yaml
plugins:
  - use: '@yonder/plugin-channel-wechat-ilink'
    config:
      owner: person:owner
channels:
  wechat-primary:
    type: wechat-ilink
  wechat-contact:
    type: wechat-ilink
    person: null
```

- 首个配置实例 `wechat-primary` 在首次扫码确认时，将**扫码联系人账号**关联 `person:owner`；机器人 bot id 是另一个身份。默认主人需要在插件配置中明确指定，不从昵称、消息内容或第一个来信者猜测。
- `primary.json` 记住首个实例；增删/重排配置和重启都不会把后续实例升为主人。首次注册时即预留，第二个实例先扫码也不会抢到主人资格。
- 第二实例省略 person 或写 null，都不自动关联主人。若属于一个已登记的人，在该实例配置 `person:实际引用`；若暂未确认，保持 null，通过 `identity_link` 或 `yonder identity link` 显式关联。
- 同一实例可配置 `allowedUsers` 额外接收其他私聊账号。扫码联系人之外的账号不会自动关联任何 person。账号列表只决定渠道接收范围，Agent 绑定仍决定是否运行及使用什么权限。
- 同一人可以显式关联多个账号；一个人对不同 Agent 可以分别是 owner 或 known。实例顺序只影响初始配对默认值，运行时权限永远由现有身份和 profile 决定。

在现有 `agent.yaml` 合并绑定。owner 配置档保留原来用来承接 main 的配置，避免改变已有主会话 profile；为它追加所需插件。联系人另设受限 profile。

```yaml
profiles:
  owner:
    level: bypass
    plugins: [channel-wechat-ilink, wechat-archive]
  contact:
    level: readonly
    plugins: []
    tools: { offer: [] }
bindings:
  - id: wechat-owner
    match: { channel: [wechat-primary, wechat-contact], from: owner }
    session: main
    profile: owner
    stream: true
  - id: wechat-contacts
    match: { channel: [wechat-primary, wechat-contact], kind: dm }
    session: { mode: persistent, per: conv }
    profile: contact
    stream: true
```

第二条是显式允许这些实例的其他已准入联系人聊天。若不希望接待他们，省略该条：消息仍留事件账本，但不唤醒模型。`stream: true` 逐条发送阶段汇报和最终气泡，不逐 token 刷屏。自动回来源不要求联系人 profile 有 message/network 工具能力；它不能因此调用任意主动发送、扫码或私密归档工具。

真实输入：`from=acct:<实例>:<peer>`、`conv=conv:<实例>:<peer>`、`type=message.in`、`kind=dm`。原生消息 ID 和发送时间保留在 `data.msgId/createdAt`。第三方发来的消息不能因为经过同一个机器人就进主人的 main。

## 模型工具：入参与出参

Bot 只有在 profile 选择插件、offer/search 选择工具且能力满足时才拿到工具。以下出参均为 `ToolResult.text` 中的 JSON；失败可能是 `isError:true` 加一条安全错误文本，不返回凭据。

| 名称 | 入参 | 正常出参 | 能力 |
|---|---|---|---|
| `channel-wechat-ilink_status` | `{instance?: string}`；省略列全部 | 一个状态对象或状态数组：`instance, paired, peer, person, contextAvailable, lastPoll, error, transport, groups, voiceOutput, audioInput, stopped` | read |
| `channel-wechat-ilink_login` | `{instance?: string, action?: 'start'或'poll', verifyCode?: string}`；验证码 1–12 位数字 | start：`{status:'wait', instance, qrcodeUrl, expiresAt}`；poll：`{status,instance}`，确认后还含 `peer, account, person, contextAvailable:false` | admin + network |
| `channel-wechat-ilink_message` | `{instance, to, text, replyTo?, attachments?}`；to 是当前实例的完整 acct:/conv: 引用 | `{ok, id?, error?, uncertain?}`；id 是本次协议 client ID，不是收件人已读回执 | read + message + network |

`attachments` 为 `Array<{kind:'image'|'audio'|'video'|'file', mime:string, uri:string, name?:string, bytes?:number}>`，uri 必须是 `file:///` 绝对文件 URI；上传还要经过 Yonder 的当前调用方文件权限检查。image/video 按协议媒体发送；audio 作为可下载音频文件发送，不声称支持微信原生语音气泡。单个媒体最多 100 MiB，不能靠软链绕过本地文件读取边界。文本每段最多 2000 个 Unicode 字符。

常见 poll 状态：wait、scaned、scaned_but_redirect、need_verifycode、verify_code_blocked、expired、confirmed、already_connected、unknown。需要用户在微信上扫码确认，工具不会绕过确认。已配对实例可再次 start/poll 更新登录，但相同 peer 的新 bot 会更新登录；不同 peer 默认拒绝。确需更换账号时运行 `yonder channels login <实例> --replace --open`，新账号不会继承旧账号的 person 关联，需通过身份管理显式关联。

通用发送优先复用已有 `message_send({to,via?,text,attachments?})`。如需显式微信引用，用上述 message 工具的 replyTo。主动发给主人可用 `message_send({to:'owner',via:实际实例,text:实际正文})`；owner 经当前 Agent 的身份解析，不是插件全局默认发送对象。显式工具发完本次答案后使用 NO_REPLY，避免自动回复副本。

## 直接申请接入

`yonder channels login` 默认给首个可登录实例申请扫码链接；`yonder channels login wechat-contact` 申请第二个。显式 `--open` 在本机打开返回的 HTTPS 链接；`--json` 返回结构化结果。`--poll` 查询当前扫码状态。命令复用当前服务实例，不经过模型队列。

在 TUI 使用 `/connect` 或 `/connect wechat-contact`；在已接入聊天渠道也可发送同名命令，但来源 profile 必须同时有 admin 与 network。普通联系人不能申请登录或变更身份。

## 真实使用顺序

1. 在已授权管理 profile 中调用 login 工具（默认 `{}`），向人展示返回的可点击二维码 URL。有效待扫二维码会复用。
2. 人扫码后由渠道自动确认并关联身份，无需模型或用户反复 poll；需要验证码时才用 verifyCode 续办。检查 status 的实际 account/person，而不是把所有渠道都叫主人。
3. 该联系人先给机器人发消息，插件保存这个 peer 的 context token。
4. 后续消息经绑定运行，自动回复原会话；其他联系人各用自己的 conv/profile/context。
5. 要跨渠道通知主人，调用 message_send 并明确 via；若当前未得到该收件人的上下文，返回 `ILINK_CONTEXT_MISSING`。本地有 token 也不等于平台保证它永远有效。

SDK 的 credentials 接口保持只读。扫码 token 与游标等协议状态保存在 `<home>/.yonder/plugins/channel-wechat-ilink/<instance>/account.json`，文件 0600、目录 0700；不进入源码、事件、工具输出或 YAML。已有 token 可通过实例 `credential` 指向 SDK 凭据项，并配置 `peerId/botId`，但这条导入路径不自动授予主人身份，应使用现有身份管理。没有自动搬运旧项目的生产凭据。

## 边界与验收

只声明 iLink 机器人私聊；普通个人号全部聊天和普通微信群不在此链路能力内。归档插件负责本机已有私聊/群资料。资料查询不等于代个人号发送。

发送失败明确区分平台拒绝和结果不明；部分成功、断连未知均返回 uncertain，不自行重发整组。错误保留 `ILINK_SEND_REJECTED` / `ILINK_SEND_FAILED` / `ILINK_DELIVERY_UNCERTAIN` 前缀，并附安全诊断 JSON；不要依赖完整错误字符串等值匹配。出站阶段仅使用本地固定标签 `preflight`、`attachment-read`、`upload-url`、`cdn-upload`、`sendmessage`。安全诊断日志 `iLink send failed` 同时记录实例、阶段、固定原因、已知数字 `httpStatus/ret/errcode`、是否已尝试及确认段数，不记录凭据、context、签名 URL、原始响应、文件名、正文或文件内容；未知码不猜测。上传准备失败不等于已尝试发消息，后续段明确拒绝也不能把前面已确认的段改成整组未发送。

停止会取消轮询及在途请求。SILK 入站转 WAV，其他支持的编码保留为音频附件；ASR 通过已存在媒体工具显式调用，接收成功不等于已经转写或理解。

验证及未测项见 [微信迁移验收](../../docs/verification/wechat-plugins.md)。
