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

## 6 网页访客、验证登录与分享链接配额

本节描述名片网页（与后端同源的前端）的访客与登录行为，属于 card 服务端与 `apps/app` 的范围，不改变 §1 的设备登录协议；插件渠道侧不参与验证与配额判定。设计来源见 [decisions](../decisions.md) 的 2026-10-29「访客额度登录升级与分享链接配额」条。

- 访客不设登录墙：`#/u/:id`（名片页）、`#/p/:accountId`（个人页）、`#/g/:token`（群邀请）、`#/get`（安装）、`#/connect`（连接）继续免登录可看；匿名访客无需验证即可直接聊天。
- 访客消息额度按匿名身份计消息条数，默认取较小的值并可由服务端配置（具体条数实现时定）。达到上限后前端弹窗提示访客登录并绑定真实账号，不静默拦截、不直接断开。
- 登录只有验证码一种方式：手机号短信验证码或邮箱验证码，不设密码，首次验证即注册。验证成功即把当前匿名身份及其历史（会话、好友、名片收藏等）绑定到真实账号并继续聊天，一次验证完成，不设计多步流程。老邮箱+密码账号首次走验证码后绑回原账号并合并历史，复用现有匿名合并语义。
- 真实账号在「账号与安全」设置里可绑定单个邮箱或单个手机号；已有的绑定方式显示为已绑定，可换绑。
- 验证码位数、冷却与重发间隔、错误次数上限等细节实现时按旧主体契约（腾讯云短信模板与 SMTP）确定，本规范不预先发明。
- 分享链接配额：每次生成名片分享二维码或群邀请链接时，服务端创建一条配额记录（token、已用次数、过期时间、吊销状态）。默认额度 50 次成功验证的新访客、默认有效期 7 天，次数与时间先到先作废；主人可调高额度、可单独吊销。计数只算成功验证的新访客，扫码不计；同一名片可有多个链接，各自独立配额。它与访客消息额度是两套独立计数：前者按链接记成功验证的新访客人数，后者按匿名身份记消息条数，互不抵扣。
- 微信扫码登录尚未实现：实施前先调研旧项目是否有可复用实现，有能力才做，否则在实现与文档中明确记为「未实现」，不得宣称可用。
- 实现必须遵守 decisions 同条列出的 8 条安全基线（用户 id 用随机 UUID、不提供免码登录、验证码存 PostgreSQL `auth_codes` 表并带过期语义与尝试计数、不放 Redis 与进程内 Map、比较恒定时间、发码失败不报 `sent`、换绑/重置类 confirm 限次、换绑后撤销既有会话、任何环境不返回 devCode、发码不透露目标是否已注册），不得照抄旧主体系统。
- 短信沿用旧 zethai 主体的腾讯云 SdkAppId、签名与模板（模板文案「注册验证码」暂用于登录场景，正式模板需在腾讯云侧另行报备，属主人外部事项）；邮箱验证码走 SMTP。新增的短信/邮件环境键必须同步加入 `deploy/env.mjs` 白名单与 `server/src/config.ts` 校验（目前只允许 DATABASE_URL/REDIS_URL/PUBLIC_ORIGIN/PORT）。

## 默认 Bot 与云端创建（增补，主人 10-29）
网页端（apps/app）依赖社交服务的两个增补接口，仅限已登录的 human 会话：
- `POST /api/me/default-bot`，正文 `{name, englishName}`（网页固定发 `小歪` / `Yonder Bot`）。**幂等**：在账号行锁内判断，账号名下已有任意 `kind=agent` 且 `owner_id=本账号` 的账号（含设备接入的）时原样返回其中一个，不创建；否则创建一个云端 Bot（使用云端默认模型与预设，学习功能默认开启）并建立与本人的 DM 会话，返回 Actor。重复登录和并发请求不得产生多个。
- `POST /api/bots`，正文仅 `{name}`，创建云端 Bot，其余参数全部取服务端默认值，返回 Actor。不接受用途、模型、预设等字段。
网页行为：联系人加载后若没有任何自己的 Bot 就调用前者一次；聊天列表不再有选择/创建引导页，旧 `/pa` 重定向到 `/`。服务端实现不在本仓库（yonder-cloud）。
