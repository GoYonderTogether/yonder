# 16 名片渠道（channel-card）

官方独立插件 `@yonder/plugin-channel-card`，插件 id `channel-card`，渠道 type `card`。后端以 `yonder-card-web/server/src/{devices,realtime,chat,cards}.ts` 的真实实现为准，PLAN 为接口索引；`proposals/ai-card/plugin.md` 的 Tinode 方案已被取代。只使用 04 的渠道与工具槽，不运行模型，不保存会话转录。

## 1 登录与设备

- `setup` 只注册；联网从渠道 `start` 或显式 `login` 开始。一个设备连接本实例的全部 Yonder Agent，不为每个 Agent 单独登录。
- 方式一（插件发起）：不带 verifyCode 的 `login('start')` 调用 `POST /api/device/start`，正文 `{name, kind}`；name 取 os.hostname()，kind 取渠道配置 device.kind，默认 desktop（`laptop | desktop | server`），获得 `{code, url}`。`ChannelLoginResult.qrcodeUrl` 复用为网页确认 URL，不修改 SDK；返回链接不自动打开桌面。
- `login('poll')` 调用 `GET /api/device/poll?code=`；实际返回 pending / used / confirmed；未知或过期码均为 404 invalid_code（不是 expired 状态），插件终止轮询并显示 invalid_code；`confirmed` 时取出只返回一次的 `deviceToken`。设备码有效期十分钟；后台程序轮询，不唤醒模型。
- 方式二（B，网页发起邀请）：已登录的 human 在网页点击“添加设备”，`POST /api/device/invite`（网页会话，仅人）返回 `{code: "<10 位数字>", expiresAt: "<ISO>"}`；邀请码绑定该账号、十分钟有效、单次使用。人复制含邀请码的提示词给 Agent，无需再次点击确认。
- `login(action, signal, verifyCode)` 收到纯数字邀请码时（start/poll 均适用，以兼容现有 CLI 的 `--verify-code` → poll），调用无需认证、有限流的 `POST /api/device/redeem`，正文 `{code, name: os.hostname(), kind: device.kind ?? 'desktop'}`，成功返回 `{deviceToken}`。插件要求邀请码恰好十位数字；未知、过期或已用返回 404 `{error:"invalid_code"}`，映射 `invalid-code` 并提示重新获取；429 `{error:"rate_limited"}` 映射 `retry-later`。不得记录邀请码或令牌。
- 兑换成功复用确认流程的令牌保存、全部 Agent 登记与连接，返回 `connected`；当前实例已有此 endpoint 的令牌时返回 `already-connected`，不再兑换。CLI 命令为 `yonder channels login card --verify-code <code>`，不改 CLI 或 SDK。
- 未来方式 A（浏览器通过 URL scheme/loopback 唤醒本地 Yonder）未实现，需要维护者批准内核设计后才能实施。
- 令牌及设备协议状态私有保存在 `<home>/.yonder/plugins/channel-card/`，目录 0700、文件 0600；不得进入事件、日志、工具结果或 YAML。令牌绑定服务 origin，HTTP/WS 均以 `Authorization: Bearer` 认证。

## 2 全部 Agent 与连接

启动及登录确认/邀请码兑换成功后、此后每十分钟，通过只读 `api.agents.list(): Promise<{id:string; name:string; avatarUrl?:string}[]>` 枚举本实例全部启用的 Yonder Agent（不含 archived）；同步间隔内的变更等待下一次同步，无事件通知。调用 `PUT /api/device/agents`，正文 `[{key, name, avatarUrl:string|null, note?}]`（新插件始终发送配置值或 null，null 清除；旧客户端省略字段时后端保留原值），`key` 必须等于 Yonder agent id。响应 `[{key, id}]` 建立 Yonder Agent → 平台 Agent 账号的映射；后端按 `(device, key)` 幂等登记，自动加入主人的默认群。

渠道 provider 注册 `multiAgent:true`，实例继承此标记。这是内部 agent 渠道以外允许 data.target 的唯一例外：只求值目标 Agent，仍须命中其自己的绑定，其他 Agent 为 no-binding。

一个设备只建立一条 `/ws/device` 连接，复用上述映射多路收发。插件不得直接读取内核数据库、复制模型队列或绕过绑定提交给 Agent。

## 3 消息与补收

- 下行 `{type:'message', agentId, convId, convKind:'dm'|'group'|'notice', mentioned:boolean, message}` 映射为 message.in；data.target 为映射后的 Yonder agent id；kind 和 mentioned 直接取协议字段。
- 引用嵌入接收/发言 Agent：`conv:<instance>:<agentId>:<platformConvId>`、`acct:<instance>:<agentId>:<platformAccountId>`，其中 agentId 是 Yonder id。原生 msgId、replyTo、createdAt 保留。send 从 ref 解析发言 Agent，不改 OutMessage。
- send 上行 `{type:'send', ref, agentId, convId, content, replyTo?}`；只有匹配 ref 的 `{type:'sent',ref,message}` 才算接纳。15 秒未确认、断连或已发后取消均返回 `{ok:false,uncertain:true}`，不自动重发。标准错误 `{type:'error',error,ref?}`；真实后端当前实际错误仅 `{error}`，无法关联，按未确认超时处理，不误认成功。
- acct 目标先 `POST /api/device/dm` `{agentId,accountId}` → `{convId}`（幂等）；Agent 须属于设备且 enabled，目标须与 Agent 同在一个会话或是其主人的好友，否则 403 forbidden。
- 连接后发送 `{type:'hello'}`，服务端 agent_cursor 补收；仅在 io.emit 接纳后发送 `{type:'ack',agentId,convId,seq}`。失败不 ack。重连指数退避；同步 Agent 后重连刷新服务端 hello 订阅。
- 首版出站仅文本/Markdown，不支持上传附件或流式；入站 image/file 映射附件，interactive 保留其标题和正文。

## 4 名片草稿工具

`channel-card_card_push` 由实际 `ToolContext.agent` 解析平台 Agent，调用 `POST /api/device/cards`，正文 `{agentId, title, markdown, display?}`；`display` 沿用前端 `CardDisplay`（`{kind:'html'|'svg', source}`）。只起草自己的名片；发布只由人在网页完成。插件不注册发布、转发或其他旧草案工具。

## 5 配置与验收

渠道配置 `{endpoint?:string, device?:{kind?:'laptop'|'desktop'|'server'}}`；endpoint 默认 https://yonder.zethai.cn，不含凭据。setup 只注册，不联网。

名片接口返回真实 Card（id、ownerId、respondentId、title、markdown、display?、status、rev、updatedAt 等），工具只返回非秘密结果。Agent 同步接口是 upsert，不删除未提交的远端 Agent；本地映射仅保留当前启用 Agent，不接纳已移除目标。

测试使用仅监听回环的 HTTP/WS 契约服务器，不模拟模型。另在 sibling 后端与本地 PostgreSQL/Redis 可用时启动真实后端完整走设备授权、Agent 登记、hello、网页 DM、事件与回复。契约测试和真实后端证据分别记录；不运行模型、不接触生产。
