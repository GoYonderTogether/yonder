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
- 添加 `qq-main` 实例与指定 Agent 的私聊、群 @ 绑定；私聊仅允许扫码账号，进入该 Agent 的 main 会话。
- 创建独立群配置档 `qq-main-group`：每群一个会话，没有工具、插件、上下文或 skill 权限。

然后由 Agent 重启目标 home 的 Yonder 服务并完成真实验证：已有托管服务用 `yonder --home <home> service restart`；手工运行则停止该 home 后重新 `yonder --home <home> start`。新增插件代码需要重启。不要重启其他 home，不自动替换正式安装。

可用参数：`--instance` 指定新实例；`--profile` 选择兼容 main 会话的既有私聊配置档；`--group-profile` 显式复用既有群配置档；扫码返回多个机器人时用 `--app-id` 选择。已有实例或凭据不会被覆盖。取消扫码不写渠道配置。

## 手工配置

凭据使用既有 auth.json 的 `api_key` 项，由本机授权程序写入；运行时只通过 `api.credentials.get` 读取。渠道配置包含 `type: qq`、`appId`、`credential`，可选 `allowedUsers`（仅单聊）与 `allowedGroups`。未提供名单表示不限，空数组表示拒绝所有。

来源引用：私聊 `conv:<instance>:c2c:<user_openid>`；群 `conv:<instance>:group:<group_openid>`；发送者 `acct:<instance>:<openid>`。OpenID 按机器人应用隔离，不把群成员 OpenID 当作同一个人的单聊 OpenID。

`channel-qq_status` 返回最近连接状态、实际接纳/发送计数和配置入口。Agent 需要在配置档的 `plugins` 中选择 `channel-qq` 才能调用该工具；渠道收发本身由 channels 和 bindings 启用。发送使用内核 `message_send`，不另设插件发送接口。

首版不支持媒体发送、流式、频道或 Webhook。接纳 QQ 官方 `GROUP_AT_MESSAGE_CREATE` 与 `GROUP_MESSAGE_CREATE`；后者需要在平台开启“接收所有消息”，见[官方群全量事件说明](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)。平台未开放时，代码无法取得普通消息。

默认群绑定仍为 `wake: mention`：普通消息只写入该群独立会话，不调用模型；下一条 @ 运行可以看到这些上下文。程序接收与模型回复是两件事；周期分桶、自主参与和共享只读记忆的设计见[群聊持续参与调研草案](../../docs/research/qq-group-participation.md)，目前没有启用。群 @ 的平台权限、测试成员/沙箱范围和机器人上线状态在 [QQ 管理端](https://q.qq.com/)设置。

被动回复使用本次输入的 sourceMessageId，不借用新消息的 ID；发送失败不自动转主动推送。未知送达返回 uncertain。QQ 平台仍控制回复时效、次数、消息类型与主动发送权限，成功以真实消息回执为准。

## 验证

`npm run build && npm run typecheck && npm test && npm run lint`。本插件测试验证官方 SDK 事件映射、目标隔离、配置与凭据保护；它们不替代真实 QQ / 模型验收。真实验收在独立 home 扫码并登录模型，依次在 QQ 私聊、群 @ 发消息，核对 message.in、run.end 和成功 message.out，并让用户确认客户端收到回复。

参考与依赖见 [NOTICE.md](NOTICE.md)。
