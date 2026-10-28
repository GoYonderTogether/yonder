# QQ 官方机器人

通过腾讯 QQ Bot SDK 接入官方机器人账号。支持文字私聊、群 @ 和平台已开放的普通群消息接收，沿 Yonder 事件、绑定、会话和投递；不使用个人号协议。

## 让 Agent 配置

告诉有本机执行权限的 Agent：为这个 Yonder home 配置 QQ，并指定接收消息的 Agent。安装插件后，`channel-qq_status` 返回配置命令的实际路径。

```sh
yonder-qq setup --home /absolute/path/to/home --agent main --open
```

源码运行使用 `node plugins/channel-qq/dist/setup.js setup ...`。配置命令随插件 npm 包发布，安装后也可用 `npx --package @yonder/plugin-channel-qq yonder-qq setup ...`；未发布版本使用本地已构建路径。

命令先输出 `awaiting-scan` JSON，包含官方绑定 URL；终端中同时显示二维码。`--open` 用系统浏览器打开官方页面。Agent 在命令等待期间读取进程输出，把链接立即交给用户；用户自行用手机 QQ 登录、选择或创建机器人并绑定。不要等待整个命令结束才展示链接，不要让用户把 AppSecret 发给 Agent。

绑定成功后自动完成：

- 保存 AppSecret 到 home 配置的 auth.json，权限 0600；yonder.yaml 只保存凭据名。
- 添加 `qq-main` 实例与指定 Agent 的私聊和群绑定；私聊仅允许扫码账号，进入该 Agent 的 main 会话。
- 创建群只读配置档 `qq-main-group`：每群独立持久会话，提供 read/grep、当前群定向发送与受限的 parent_ask。共享所属 Agent 工作区中的可读记忆，沿用其选中的 context-files；不授予写、执行或任意跨会话发送能力。
- 配置群原消息只写入会话、非空 60 秒批次运行、主会话接收协助请求。普通私聊和群批次使用 busy: steer；群分身决定是否公开回复，普通最终正文不自动发到群。

然后由 Agent 重启目标 home 的 Yonder 服务并完成真实验证：已有托管服务用 `yonder --home <home> service restart`；手工运行则停止该 home 后重新 `yonder --home <home> start`。新增插件代码需要重启。不要重启其他 home，不自动替换正式安装。

可用参数：`--instance` 指定新实例；`--profile` 选择兼容 main 会话的既有私聊配置档；`--group-profile` 显式复用既有群配置档；扫码返回多个机器人时用 `--app-id` 选择。已有实例或凭据不会被覆盖。取消扫码不写渠道配置。

## 手工配置

凭据使用既有 auth.json 的 `api_key` 项，由本机授权程序写入；运行时只通过 `api.credentials.get` 读取。渠道配置包含 `type: qq`、`appId`、`credential`，可选 `allowedUsers`（仅单聊）与 `allowedGroups`。未提供名单表示不限，空数组表示拒绝所有。

新扫码配置设置 `groupWindowSeconds: 60`。已有首版实例保留原行为，Agent 可在保留原凭据的前提下更新该字段、群原消息的 write/none 绑定、`channel-qq.group-batch` 的同群 run/none 绑定，以及 `parent-request` 到所属 main 的绑定；群配置档要选择上述只读工具和场景说明。先用 doctor 校验，再重启目标 home。不要仅把旧绑定改为 wake: run，那会让普通消息逐条调用模型。

来源引用：私聊 `conv:<instance>:c2c:<user_openid>`；群 `conv:<instance>:group:<group_openid>`；发送者 `acct:<instance>:<openid>`。OpenID 按机器人应用隔离，不把群成员 OpenID 当作同一个人的单聊 OpenID。

`channel-qq_status` 返回最近连接状态、实际接纳/发送计数和配置入口。Agent 需要在配置档的 `plugins` 中选择 `channel-qq` 才能调用该工具；渠道收发本身由 channels 和 bindings 启用。发送使用内核 `message_send`，不另设插件发送接口。

入站媒体映射为 `message.in` 的 `attachments`（`content_type` 决定 image/audio/video/file，只接纳 https URL），引用回复的原文取 `msg_elements[0]` 写入 `quote.text`；只有附件没有正文的消息同样接纳。出站媒体用 `message_send` 的附件，接受 https URL 或绝对本地路径，一次回复先发文字再逐条发媒体，音频按文件发送。所有请求按 `sendIntervalMs`（实例配置，默认 500 毫秒，0–60000）串行间隔发送，避免平台限流；平台限流或 5xx 仍是 uncertain，不盲重发。不支持流式、频道或 Webhook。接纳 QQ 官方 `GROUP_AT_MESSAGE_CREATE` 与 `GROUP_MESSAGE_CREATE`；后者需要在平台开启“接收所有消息”，见[官方群全量事件说明](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)。平台未开放时，代码无法取得普通消息。

## 群主必须在具体群聊内设置

**入口属于“这个群里的这个机器人”，不是机器人的全局管理页。** 请使用群主账号的最新版 iOS/Android QQ，在目标群聊中进入群内机器人管理，选择这个机器人，再设置 **“机器人可获取的群聊消息范围” → 全部消息**。每个群、每个机器人分别配置；直接打开机器人自己的资料页或开发者管理端，不能代替这一步。添加机器人入群时的提示也有“设置权限”入口。

“机器人主动在群聊内发言”是另一项权限，按持续参与需求开启。普通成员或管理员身份不能代替群主授权；全量接收不要求把机器人设为群管理员。群管理员身份对应撤回群成员消息等管理能力。

依据：[腾讯官方 FAQ](https://bot.q.qq.com/wiki/bot_FAQ/#q-在群里-机器人不回复-但私聊可以-机器人在群中主动发送消息失败)、[官方设置截图](https://qq-ai.cdn-go.cn/web/bot-docs/-/v1.38.0/assets/img/image66.f40b82c2.png)。群内入口已由本次真实测试的群主确认。官方 [bot_state 接口](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)可查询 recv_msg_setting（all/only_mention/mention_and_context）；该查询接口本身仅对白名单机器人开放，不能据此推断所有接收者都需要企业认证。

## 群持续参与

每条普通文字消息先写入本群的独立会话，不调用模型。非空窗口默认 60 秒，@ 提前结束等待；同群忙时合并待处理范围，不逐条积压模型运行。模型可保持安静，也可用 message_send 指定真实 replyTo 回复某条消息；replyTo 可直接使用原始消息头的 turn id 或原生 message ID，内核核实目标并转换。QQ 被动回复来源与显式引用分别传递，平台控制时效和额度。

插件保存的是账本中的批次与已覆盖范围，原文沿现有 conversation。单批最多 100 条，剩余消息继续保留未读；已经在会话里的背景不每轮重复注入。没有新消息不唤醒。批次失败显示在 status 中，留待新输入继续处理，不盲重发旧消息；重启通过既有批次身份接回原生运行。

分身可按需读取同一 Agent 的工作区记忆，没有写、exec 或私聊历史管理权限。复杂工作用 parent_ask 请求所属 main；请求自动带上真实群、发送者与来源事件，主会话依既有授权处理，不能把群成员要求自动升级为主人指令。实际结果返回后，由群分身决定是否公开。当前记忆仍是 context-files 与手工 memory 目录，不宣称已具备长期记忆引擎。

完整依据、职责和验收见[群聊持续参与方案](../../docs/research/qq-group-participation.md)。

被动回复使用本次输入的 sourceMessageId，不借用新消息的 ID；发送失败不自动转主动推送。未知送达返回 uncertain。QQ 平台仍控制回复时效、次数、消息类型与主动发送权限，成功以真实消息回执为准。

## 验证

`npm run build && npm run typecheck && npm test && npm run lint`。协议与配置测试不调用模型；participation-live.test 使用真实 Luna 与本机协议入口验证批次、权限、内部请求和恢复，不冒充 QQ 平台验收。真实 QQ 验收在独立 home 扫码并登录模型，依次验证私聊、群 @、群普通消息与定向回复，核对 message.in、run.end、group-read 和成功 message.out，并让用户确认客户端收到回复。

参考与依赖见 [NOTICE.md](NOTICE.md)。
