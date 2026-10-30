# 16 名片渠道（channel-card）

官方独立插件 `@yonder/plugin-channel-card`，插件 id `channel-card`，渠道 type `card`。后端以 `yonder-card-web/server/src/{devices,realtime,chat,cards}.ts` 的真实实现为准，PLAN 为接口索引；`proposals/ai-card/plugin.md` 的 Tinode 方案已被取代。只使用 04 的渠道与工具槽，不运行模型，不保存会话转录。

## 1 登录与设备

同一次设备绑定统一提供本人消息与工作访问，不要求第二次 Gateway 授权；专用工作控制、主人核对与撤销边界见 [19-device-workbench](19-device-workbench.md)。普通社交消息不因此获得控制权限。

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

用户授权确认后，插件在账号关联核实且 WebSocket 可发送时，通过 `/api/device/dm` 获取真实主人私聊并调用 `ownerConnected`；已有账号若关联到其他 person 则不报告主人。普通启动恢复、重连及周期同步不重复报告。

## 3 消息与补收

- 下行 `{type:'message', agentId, convId, convKind:'dm'|'group'|'notice', mentioned:boolean, message}` 映射为 message.in；data.target 为映射后的 Yonder agent id；kind 取协议字段；mentioned 与 social.mentions.bot 在适配入口以同一可信原生提及结果归一，原生字段缺失才回落旧 mentioned，不能对同一真实 @ 产生 true/false 冲突。
- 引用嵌入接收/发言 Agent：`conv:<instance>:<agentId>:<platformConvId>`、`acct:<instance>:<agentId>:<platformAccountId>`，其中 agentId 是 Yonder id。原生 msgId、replyTo、createdAt 保留。send 从 ref 解析发言 Agent，不改 OutMessage。
- send 上行 `{type:'send', ref, agentId, convId, content, replyTo?}`；只有匹配 ref 的 `{type:'sent',ref,message}` 才算接纳。15 秒未确认、断连或已发后取消均返回 `{ok:false,uncertain:true}`，不自动重发。标准错误 `{type:'error',error,ref?}`；真实后端当前实际错误仅 `{error}`，无法关联，按未确认超时处理，不误认成功。
- acct 目标先 `POST /api/device/dm` `{agentId,accountId}` → `{convId}`（幂等）；Agent 须属于设备且 enabled，目标须与 Agent 同在一个会话或是其主人的好友，否则 403 forbidden。
- 连接后发送 `{type:'hello'}`，服务端 agent_cursor 补收；仅在 io.emit 接纳后发送 `{type:'ack',agentId,convId,seq}`。失败不 ack。重连指数退避；同步 Agent 后重连刷新服务端 hello 订阅。
- hello 补收的帧带 `replayed: true`（实时帧不带）。补收消息发出已超过 5 分钟时，插件在正文前加一行「[补收：这条消息发于 <ISO 时间>，设备离线期间未送达…先向对方确认。]」，Bot 据此判断旧指令是否已被后来的消息取代，不照做覆盖新结果（JV2-J03-10）。
- 首版出站仅文本/Markdown，不支持上传附件或流式；入站 image/file 映射附件，interactive 保留其标题和正文。

## 4 名片草稿工具

`channel-card_card_push` 由实际 `ToolContext.agent` 解析平台 Agent，调用 `POST /api/device/cards`，正文 `{agentId, title, markdown, display?}`；`display` 沿用前端 `CardDisplay`（`{kind:'html'|'svg', source}`）。只起草自己的名片；发布只由人在网页完成。每个 Bot 只有一张自己的名片：已有名片时 card_push 更新它的草稿（同一名片码，revision 递增），没有时才新建；不会一次 push 新建一张。要另起一张名片由人在网页新建（JV2-J03-10 定案）。插件不注册发布、转发或其他旧草案工具。

`default`/`full` 发行包写入 `card` 渠道实例时，`yonder init` 同时把 `channel-card` 写进 `agents/main/agent.yaml` 的 `defaults.plugins`，main 的日常会话直接能调用名片草稿工具；`core` 不写渠道实例，也不写这个插件。已有 home 不自动改写，需要时自行在 `defaults.plugins`（或实际 profile 的 `plugins`）里加入 `channel-card`。

工具失败时说明具体原因，不用笼统提示：没有 Agent 身份（任务/预设会话）时说明该会话没有 Agent、要在 Agent 会话（`yonder chat` 或名片渠道）里调用；`ToolContext.agent` 未在实例注册时点名 Agent 与实例并要求先 `yonder channels login card`；其余失败带上真实错误（JV2-J03-02）。

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

## 群聊消息意图与共享工具（2026-10-30，主人批准）

Web 群聊与 QQ 共用 01 §6 的当前来源会话只读工具及 06 的发送意图。card 入站保留真实发送者显示名、可确认身份、原生 mentions/引用与附件；出站 respondTo 不强制显示引用，replyTo 为明确引用，mentions 从当前实例 scoped acct 映射成平台真实成员账号并经服务端同群校验。只有完整服务端和客户端支持真实 mentions 时才声明 outboundMentions。新增帧字段保持可选，旧客户端兼容；不能静默丢弃模型请求的引用或艾特。成员列表区分当前可见历史参与者和平台真实成员，历史查询只覆盖实际接收记录。文件/图片沿现有附件协议，不为此引入第二套存储或跨群查询。

本轮允许修改 harness Web/card 与独立 yonder-cloud 仓库的对应实现。2026-10-30 维护者进一步要求真实平台群聊与群管理调通，授权必要的本站发布、本机安装和真实账号验收；不据源码存在宣称上线，实际部署、运行与真人消息证据分别记录。

设备入站 message 可选 `senderName: string`、`senderIsBot: boolean`；text/markdown content 可选 `mentions: string[]` 为平台账号 UUID。card 按 `acct:<instance>:<agentKey>:<uuid>` 映射，不将不同 agentKey/实例的账号混同。服务端在入站与设备出站保存前校验全部 mentions 属于该群；网页使用真实成员选择并呈现 @ 名称，可见引用以 replyTo 表达。respondTo 不产生可见引用，不为其新增数据库列。

### 既有Agent的显式群接入

插件提供本机 `setup.js upgrade-groups --home <home> [--agent <id>]`：只针对已有card绑定的未归档Agent补缺少的官方群绑定，先保存备份并幂等，不覆盖已有自定义群绑定。创建card-group只读配置档，显式offer read/grep/conversation_read/conversation_members/conversation_attachment_read/message_send/parent_ask，独立persistent per:conv、wake:mention、reply:none、busy:steer。普通消息写入不逐条唤醒，@运行；自主持续参与沿每 Bot 独立选择的 social 参与策略，不新增队列；多个 Bot 共享同一平台群的公开事实和发言协调，仍保留各自会话、模型、观察游标和权限，详见 11。跨节点原子发言占位与通用群插件安装界面尚未实现，不据同节点协调宣称全群互斥。该入口仅修改已授权home配置，不写凭据；写入遵循同文件锁与原子替换。工具和提示语义与QQ一致，但不跨插件import实现。

官方只读群配置显式使用已有内核 `peer-workspace` context（仅本Agent的SOUL.md与AGENTS.md），并显式重置plugins/skills，避免继承私人记忆或插件；已有自定义contexts保留。QQ精确旧官方配置升级补此context，card仅新建官方profile时设置；自定义配置不覆盖。

## 平台默认群参与、公开入口与群管理（2026-10-30，维护者批准）

### 默认群参与

平台确认一个 Bot 已加入群，即接通其群消息、公开成员身份、独立群会话及官方参与策略，不要求主人逐群添加 social.scope、authorized.conversations、批次绑定或 groupJudge.conversations。已有群的在群 Bot 与后来新建/登记的 Bot 遵循同一默认行为。默认参与是有资格观察和按自身规则发言，不是每条必答；硬规则触发和低频复盘沿 11，不恢复逐消息模型判断。

Card 声明可信能力 `features.groupParticipation: "membership"`：仅平台已校验设备/目标 Bot/同群成员的真实 group 输入可提供成员事实，普通正文、昵称、猜测 conv 不能提供。内核沿实际生效的默认或显式群绑定派生此 Bot/群的 social 默认范围/准入；官方 social 动态登记其真实 room。QQ 未声明该能力，既有授权边界不变。显式禁用、denied、record/mute、自定义 plugin 和群规则优先，不能以平台默认覆盖它们；私聊不受影响。

若 Bot 尚无群配置档与绑定，有效配置层为此平台提供稳定可诊断的默认群 binding/profile，沿正常匹配、准入与事件 routes 运行，不由渠道直接 submit 或偷偷修改持久配置。默认 persistent/per:conv、reply:none、busy:steer、readonly；显式隔离 plugins/contexts/skills/tools，使用 social、peer-workspace 与当前群必要只读会话工具、message_send、parent_ask，不继承 owner 的 bypass/exec 或私人记忆上下文。已有自定义群绑定优先，不重复创建会话；主模型沿 Agent 默认，低频复盘仅沿已有 cheap/simple，缺少时明确记录不可复盘。新群持续参与使用同一默认绑定与批次准入，不新增运行队列。

### 公开互动入口

Bot 默认具有对外互动与入群能力，不要求先发布名片或逐个打开公开开关；新建/同步本身不自动上市场、发消息或暴露私人资料。第一次由主人创建分享链接时，服务端在实际创建成功的同一业务路径幂等启用既有 accounts.public；第一次由合法群创建/添加成员流程接纳 Bot 时，同步启用其公开互动身份并发布成员变化，使在线设备和群成员视图接上，不需等十分钟 Agent 同步或重启。群成员可看同群 Bot 的公开资料；移除、解绑、撤销仍按现有成员与访问控制执行。兼容已存在的显式撤销/关闭，不因周期同步重新打开。以 public_activated_at 区分首次激活与主动关闭；旧数据无法区分默认 false 和主动关闭时迁移保留原状态，已有主人可在本次明确授权下沿既有公开/分享入口一次激活自己的 Bot，不修改他人状态。公开不暴露私人 DM、main、记忆、工作目录、凭据或主机权限，不自动将名片草稿改成已发布。

### 群管理

沿既有 conversations/members 持久化角色 owner/admin/member，不另建管理权限系统；群创建者为唯一 owner，Bot/匿名访客不能成为 owner/admin。既有群缺少入群时间/创建者记录时，优先按该群最早真人发言确定 owner；完全没有真人发言时按真人账号创建时间与 id 作确定性兼容回填，不宣称这是历史入群顺序。无真人成员时明确记为待修复，不猜 Bot 为群主。

- 群主可改群名、任免管理员，并把群主身份移交给同群真人成员；移交在一个事务内将原群主降为 member，始终只保留一个群主。
- 管理员可改群名，不可任免管理员或移交群主；普通成员、Bot 与访客不能修改这些管理字段。
- 群名称沿既有创建名称的长度与非空校验；角色目标须是同群真人成员，不允许通过账号参数操作别的群。客户端可见入口与服务端校验使用同一事实，隐藏按钮不代替权限校验。
- 平台复用 PATCH /api/conversations/:id 的 title 更新和 PATCH /api/conversations/:id/members/:accountId 的 role 更新；角色仅 owner/admin/member。保留既有 memberIds，Conversation 可增 members[{accountId,role}]；Detail 的 Actor 成员对象仅增可选 role，不把 Actor[] 改成另一种数组。本人权限由真实账号角色计算，不增冗余 myRole/ownerId。
- 聊天详情页能查看群名/群主/管理员，按权限改名、任免与移交，成功后所有成员实时刷新，失败显示实际原因；修改群名或角色不删除消息历史、不改变 Bot 私人权限。

### 真实验收

以 IHG7CJ 的已存在真人群作为回归，并新建可识别的验收群验证无手工配名单的首次入群。分别记录单 Bot 点名、普通相关话题、明确点名多位、让话/暂停、无消息零空转、兄弟 Bot 可见及不重复；用真实模型和真实成功出站证据，不把入站记录当模型已回复。群名、管理员任免、群主移交/恢复及普通成员越权拒绝须走真实服务；无法取得已授权第二身份的场景明确未测，不借主人的会话冒充普通成员。首次分享与首次入群验证公开资料可用且私人资源仍隔离。保留原始失败/跳过、截图、消息/运行/投递 id 和真实调用用量；不为测试删除历史。
