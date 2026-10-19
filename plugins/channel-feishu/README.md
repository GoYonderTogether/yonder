# channel-feishu

实现未验收。官方飞书/Lark 消息渠道；一个配置实例对应一个应用，默认只使用官方 SDK 的 WebSocket，不需公网 webhook。setup 只注册，不联网；channel.start 才解析凭据、诊断机器人、建立连接。缺凭据/权限/连接在 status 中报告，其他渠道继续启动。

安装/授权/真实消息/测试均留后轮；本包源码由 Codex 实现，不计为 Yonder 自主开发成果。根 workspace、锁文件和构建引用由主 agent 统一接线。

## 接入

在既有 `yonder.yaml` 的 plugins 加入本地包路径或已安装包名 `@yonder/plugin-channel-feishu`，在 channels 下创建 `type: feishu` 的实例；使用现有凭据存储引用（`secret` 不是密码正文）。

| 实例 config | 行为 |
| --- | --- |
| appId / secret | 飞书应用 ID / `api.credentials.get` 引用；secret 必须解析为 api_key，真实值不进入事件、日志或状态 |
| domain | feishu（默认）或 lark；每实例独立连接和 token |
| renderMode | text、markdown（默认，原生 post md）、post（post text）、card（原生 Markdown 卡片） |
| streaming | 默认 true，CardKit 卡片；false 收集最终文字后按 renderMode 发送 |
| replyInThread | 默认 false；有 replyTo 时使用 reply API，在 true 时回复线程；错误可见，不擅自降级到顶层消息 |
| templateId / templateVersion | 卡片工具默认模板；renderMode=card 时普通回复使用该模板，变量为 content；流式使用 CardKit 原生卡片 |
| textChunkBytes | 256..20000，默认 18000；按实际 JSON UTF-8 内容包络分块 |
| mediaMaxBytes | 1..30000000，默认 30000000；图片上限额外限制为 10000000 |
| updateIntervalMs | 160..5000，默认 200，合并累计流式更新；终结时刷新剩余内容 |
| allowedUsers / allowedChats | 可选传输准入的原生 open_id / chat_id 白名单，空数组拒绝所有。owner/known/stranger、群选择与是否 @ 唤醒仍由既有身份及绑定决定 |

在飞书应用启用机器人，订阅 `im.message.receive_v1` 和 `card.action.trigger`，选择长连接，发布/安装到目标租户。根据实际用途申请 `im:message`、发送机器人消息、`im:resource` 与 `cardkit:card:write` 等权限。status 中的 scopes 是必要权限提示，不是平台已授权证明；REST 失败返回 HTTP/code 与平台实际提供的缺少权限 subject。

`acct:<实例>:<open_id>` 是发送者；`conv:<实例>:<chat_id>` 是会话。DM/group、mentioned、真实 msgId、parent/root/thread id 和附件保留在 message.in。身份映射、person 与绑定由内核处理。只接收 user 发送者，拒绝机器人自身和应用互刷。认证来源为本应用 SDK WebSocket，不提供未验证的公网回调入口。

## 调用

profile 必须明确选用本插件工具。工具名均在清单中：

- `channel-feishu_status`：可选 instance，查询实际内存连接状态（connected/reconnecting/not-ready 等），不触发连接或发送。
- `channel-feishu_message`：instance、to、text、可选 attachments/replyTo；经 `api.messages.send`，由既有 message.out 记录。to 必须是同实例的 acct/conv 引用。普通回复也通过 Channel.send/stream。
- `channel-feishu_card`：instance、to、可选 replyTo；传 card 原生 JSON，或 templateId/templateVersion/variables（缺 templateId 时使用实例默认），互斥。成功保留真实消息 id，写 channel-feishu.card-sent 事件和工具转录。事件落盘失败返回已发送 id，禁止据此重发。

按钮事件为 `channel-feishu.card-action`：来自已认证 WebSocket，保留真实操作者 acct、原消息 id、原会话、action tag/value/formValue；msgId 为回调 token 的 SHA-256 协议去重标识，不保存原 token。按钮值是输入，不能当作额外授权。事件交内核绑定，不直接唤醒指定 agent。卡片来源只依赖原回调 context.open_message_id，拒绝临时 card-action ID 的错误关联。

## 附件与投递

入站 text/post/image/audio/media/video/file/interactive 分别解析；post 选择一个实际 locale，提取文字/链接/@/媒体/文件；不能识别的类型返回明确类型提示。资源以真实 message id/key 下载，保留 MIME、名称、实际大小和 file: URI。下载失败仍保留消息并给出可见失败提示。文件存于插件数据目录的实例 media 下，不覆盖主人文件，不删除历史。

输出附件使用已授权的本地 file: URI；实际读取字节后检查大小，上传 image/file API，再发送 image/file/audio/media 消息。音频明确要求 Ogg/Opus，视频要求 MP4；不把无法播放的文件宣称为音频/视频成功。其他格式需先通过既有工具生成正确格式产物，本包不引入转码依赖。拒绝任意 HTTP 附件 URL，避免携带应用凭据向其他站点下载。消息组中途失败返回最后已发送 id 与失败，不能盲重放整组。

CardKit 按创建→发送实体→累计更新→关闭 streaming_mode 顺序运行，sequence 严格递增。取消包含等待下一段输出期间的取消；finally 使用独立有界请求刷新/关闭，错误和取消同样收尾。关闭失败返回已可见 message id，不另发重复最终文本。平台拒绝更新/大小/权限均保留错误；不在失败后悄悄切供应商或降级另发。

官方 SDK 负责断线重连；实例自己的 receipts.json 只保存原消息/回调的内核事件回执，不保存会话转录、任务或模型状态。并发同消息合并等待；持久回执用于重启去重。emit 与 receipt 文件之间的崩溃窗口由内核按 type+渠道实例+data.msgId 幂等接纳收口，插件保留原生 message id。

## 证据边界

仅实现，未运行测试、模型、浏览器、桌面或真实飞书调用；未授权、安装、发送、push 或发布。多媒体可打开/播放、客户端展示、卡片回调、恢复和取消全部须按 N13 真实矩阵验收。上游固定来源与许可见 NOTICE.md。


## 会话背景（D36）

需要飞书对话背景的agent/profile在既有contexts中加入`channel-feishu.conversation`（保留原有项）。此贡献为turn上下文；未选用不联网，不自动改变任何profile权限。例如：

```yaml
contexts: [agents-md, user-md, channel-feishu.conversation]
```

准备实际飞书输入时读取来源会话或来源线程截至当时的可见历史；用户、其他机器人、本机器人回复均为背景，保持时间顺序，不因此唤醒或获得权限。当前待处理项使用原生ID标识，模型结合后续对话决定回复或NO_REPLY。普通输入呈现原发送时间和接纳时间，不能把迟到消息显示成刚发的新请求。

背景64KiB UTF-8，保留最近对话并明确范围、截断或读取失败；原始待处理输入保留，历史工具可继续分页查询。背景媒体只保留描述和资源标识，不自动下载。使用原生pi上下文及压缩，没有单独转录、缓存或任务队列；恢复仅合并连续同发送者同线程输入，不重排跨参与者消息。
