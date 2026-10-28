# channel-feishu

部分真实场景已通过；完整矩阵未关闭，见[项目状态](../../docs/status.md#飞书)。官方飞书/Lark 消息渠道；一个配置实例对应一个应用，默认只使用官方 SDK 的 WebSocket，不需公网 webhook。setup 只注册，不联网；channel.start 才解析凭据、诊断机器人、建立连接。缺凭据/权限/连接在 status 中报告，其他渠道继续启动。

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

在飞书应用启用机器人，订阅 `im.message.receive_v1` 和 `card.action.trigger`，选择长连接，发布/安装到目标租户。根据实际用途申请 `im:message`、发送机器人消息、`im:resource` 与 `cardkit:card:write` 等权限。群免艾特接收、群历史和恢复还需tenant `im:message.group_msg`；只有@消息权限不能代替完整群历史读取。status 中的 scopes 是必要权限提示，不是平台已授权证明；REST 失败返回 HTTP/code 与平台实际提供的缺少权限 subject。

`acct:<实例>:<open_id>` 是发送者；`conv:<实例>:<chat_id>` 是会话。DM/group、mentioned、真实 msgId、parent/root/thread id 和附件保留在 message.in。身份映射、person 与绑定由内核处理。只接收 user 发送者，拒绝机器人自身和应用互刷。认证来源为本应用 SDK WebSocket，不提供未验证的公网回调入口。

## 调用

profile 必须明确选用本插件工具。`channelInstances` 未配置时保留旧版无限制兼容；配置为实际实例 id 名单后，status/history/message/card/task-card（含 rawSend）仅可访问名单内实例，`[]` 无实例，admin/bypass 不豁免。defaults/profile/preset 沿既有继承规则，bindings 不自动授予出站范围。省略 instance 的 status 只返回授权列表；仍保留 history 来源/admin 与 task-card 的真实输入、会话/Agent 归属检查。这是工具/API 作用域，不是 macOS 沙箱。工具名均在清单中：

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

真实验收矩阵与未测项见[项目状态](../../docs/status.md#飞书)。上游固定来源与许可见 NOTICE.md。

## 会话背景（D36）

需要飞书对话背景的agent/profile在既有contexts中加入`channel-feishu.conversation`（保留原有项）。此贡献为turn上下文；未选用不联网，不自动改变任何profile权限。例如：

```yaml
contexts: [agents-md, user-md, channel-feishu.conversation]
```

准备实际飞书输入时读取来源会话或来源线程截至当时的可见历史；用户、其他机器人、本机器人回复均为背景，保持时间顺序，不因此唤醒或获得权限。当前待处理项使用原生ID标识，模型结合后续对话决定回复或NO_REPLY。普通输入呈现原发送时间和接纳时间，不能把迟到消息显示成刚发的新请求。

背景64KiB UTF-8，保留最近对话并明确范围、截断或读取失败；原始待处理输入保留，历史工具可继续分页查询。背景媒体只保留描述和资源标识，不自动下载。使用原生pi上下文及压缩，没有单独转录、缓存或任务队列；恢复仅合并连续同发送者同线程输入，不重排跨参与者消息。

## 模型指定引用与艾特

`channel-feishu_message`已有replyTo参数，传上下文里的原生消息ID即可强制引用，优先于自动引用规则。状态工具返回renderMode：text/markdown模式可在text中使用飞书原生`<at user_id="ou_实际ID">称呼</at>`；卡片使用既有channel-feishu_card工具，在原生Markdown中使用`<at id=ou_实际ID></at>`。不同格式不要混用，post纯文本模式需要原生卡片工具实现艾特。发送权限、跨来源与实际投递回执仍沿用既有工具检查；主动发送答复后以NO_REPLY结束，避免自动final再发一次。

原生语法依据：[飞书消息内容结构](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json)与[卡片艾特说明](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。

## 单一任务状态卡（显式工具，未替换普通流式输出）

`channel-feishu_task_card` 是受管卡片工具，不是任意历史消息编辑器，不改变默认阶段/最终各自发送气泡的契约。Agent 应在用户最新交代后先 `create`，保留返回的 receipt `id`，以后只 `update` 同一卡；工具答复后 `NO_REPLY`，避免普通 final 再发气泡。新文字后必须以新的实际来源 `create` 新锚，不回到旧卡充当当前反馈。

准确参数（所有对象拒绝额外字段）：

| action | 必填（另加 instance、action） | 说明 |
| --- | --- | --- |
| create | sourceEvent、rows | sourceEvent 必须是本次运行 ctx.event/events 中实际飞书 message.in 的事件 ID；只接受该发起者最新 text/post 的来源。无任意 to/messageId 参数 |
| update | id、expectedRevision、rows | id 是工具创建的 receipt ID，不是原生消息 ID；expectedRevision 为正整数 CAS。只接受原 session/agent 的当前锚 |
| get | id | 读取持久 receipt；不发消息，不自动重试 |

`rows` 为 1..12 个短条目，必填 `{id,status,deliverable,acceptance}`：id 为既有任务索引引用（1..80 字符），deliverable、acceptance 各 1..160 字符。固定短标签为 `queued` → ⚪ 待开始、`working` → 🟡 实现中、`done` → 🟢 已完成、`blocked` → 🔴 已阻塞；兼容旧 `unverified` → ⚪ 未验收，明确非活动、非完成，不宣称验收正在进行。working 仅用于已核实的实时执行，done 仅用于整个交付已送达且通过验收；插件呈现调用者声明，不自行核实任务生命周期。分配任务和已结束的准备测试均不证明运行中或整体完成。

可选 `assignee`（1..80 字符）、`forwardedVerbatim`（boolean）分别显示负责人和是否原文程序转发；省略显示“未注明”，false 显示“否”。true 只能用于实际程序原文转发，手工复制或摘要必须为 false；这是展示声明，不是转发凭证，不实现转发，也不扩大授权。可选 `lists:{advancing?:string[],needsOwner?:string[]}` 每项 1..160 字符、每列 0..3 项，分别渲染“我在推进，无需您操作”与“需要您处理”，无项显示“无”。前者放无人值守推进事项，后者只写真实 owner gate 的精确解阻动作，不将自己的待办冒充用户阻塞。update 省略 lists 保留原列表，传空数组清空。

卡片用原生六分栏表格展示，不接受任意卡片 JSON、详情日志或新增任务执行定义；总 JSON 上限 30000 bytes（即使单字段符合上限，组合过大仍拒绝）。任务索引仍由原有任务所有者维护，卡片不复制任务调度系统。

返回 receipt：`{ok,id,messageId?,revision,state,retired,acknowledged,notifications,sourceMessageId}`。state 为 `pending/confirmed/unknown`。失败保留可取得的 receipt ID 与原生消息 ID；若已发出/更新而事件记录失败，也返回错误，不可据此重发。`get` 用于查看，**unknown/pending 不盲重试**；需要人工核对平台与事件记录。没有自动重放、自动回退新消息或第二套重试器。

协议更新是 [官方 PATCH /im/v1/messages/:message_id](https://open.feishu.cn/document/server-docs/im-v1/message-card/patch?lang=zh-CN)，不是创建替代消息；发送/更新前后 `config.update_multi:true`，共享卡、同应用身份、未撤回、14 天内（平台限制），本工具串行更新并至少间隔 250ms。普通 text/post 的 PUT 接口未在此工具开放。

原子保存的 `<plugin-data>/<instance>/task-cards.json` 仅含短展示投影和协议 receipt（来源/发起者/session/agent、原生消息 ID、revision、按钮消费状态）；不含详情日志或新任务队列。操作前持久 pending，重启后将 pending 视为 unknown，绝不自动重发。正常 receipt 跨重启可继续更新同消息。

合法原生新 text/post（含恢复消息）进入既有 receive/recovery 路径时，先同步使同会话同发起者旧卡服务端失效，再按原生 PATCH 移除其按钮。无模型轮询、无 cron。群内其他人的消息不会替发起者确认或撤销他的卡。迟到的更早原生时间不退休当前卡；相同毫秒、不同消息 ID 无法证明因果，保守退休而不假造排序。退役状态成功落盘后，视觉撤销失败/崩溃不复活服务端按钮；错误明确记录。实际边界：observe 在网络等待前同步内存失效，随后串行原子保存，再做视觉 PATCH；WebSocket receive 对 observe 异步记录错误，恢复路径则 await。若保存失败或进程在保存前崩溃，重启只能读上次落盘状态，不能保证旧按钮已退役，须等新文字由既有恢复路径再次 observe；start 不联网核对最新来源、不重放 PATCH。原子 rename 也不等于断电 fsync 保证。只有下一次真实用户文字才建立新的当前反馈来源，旧任务结果不能通过旧 receipt 覆盖新卡。

两个按钮仍走本应用鉴权 WebSocket，额外校验发起者 acct、chat、原消息 ID、当前 revision、期限与消费状态，拒绝伪造/过期/错人/重复操作。

- **了解任务详情**：只发既有 `channel-feishu.card-action` 插件事件，`data.action.value` 为 `{action:"details",taskIds,receipt}`；只引用现有任务索引，不把日志塞卡。
- **确认收到（仅通知）**：记录 `action:"acknowledge"` 同类事件并移除确认按钮。它只表示收到，**未安排下一任务**，不取消任务、不授予新权限、不调用任务执行器。acknowledged 仅表示按钮消费，不代表通知或任务成功。

回调在 emit 前持久消费及 revision，同时记 `notifications["revision:action"]="pending"`；emit 和确认落盘都成功才显示成功。emit 失败（包括事件可能已接纳但回执丢失）或确认保存失败返回“通知结果未知”，标记 unknown，不 PATCH、不重发通知。重启把 pending 通知读作 unknown；消费仍有效，不因再次点击、重启或 get 自动重发。若消费本身无法持久化，当前进程仍拒绝重复，但崩溃后无可靠磁盘凭证；须先人工核对原事件与存储故障，不能以未见成功提示推断未发生。通知 confirmed 仅指 emit 返回并已保存，不证明绑定唤醒、详情已交付或下一任务已安排。

部署者需用**现有绑定**接纳 `channel-feishu.card-action` 到负责该来源的 agent，才能按需解释 taskIds/提供详情。没有绑定就只记录事件，不会偷偷唤醒模型；工具不会创建绑定、提升操作者身份或更改 profile。绑定必须保持实际 from/conv 边界，事件始终带 `authorization:"none"`，详情/收到通知不得被当作执行新副作用的批准。此次代码不改变生产绑定；完整按钮→绑定→详情交付仍需部署后验收。

工具发送/更新另记 `channel-feishu.task-card-updated`，含 receipt、revision、原生 messageId/sourceMessageId，不写详细任务正文。工具转录保留输入/结果。部署前必须验收同消息实际更新、真实客户端表格、群错人点击、按钮事件绑定、服务重启恢复；离线协议测试不等于以上真实平台验收。若要由内核强制所有输出自动改单卡而不依赖显式工具/NO_REPLY，那是默认投递契约变更，需另行设计批准。

PR4 本轮修订基线 18d1abb：限定飞书插件/UI/文档；固定状态与协调展示、严格有界 schema、故障通知不报成功且不重发、明确 observe 落盘/重启边界为本轮代码验收点。单元/协议检查不等于真实飞书验收；未安装、未重启、未部署。

## 账本 TaskBoard 卡（2026-10-25）

这是 tasks_show 的只读看板，与显式 channel-feishu_task_card 的受管状态卡并存。每个 conversation 保留一个当前看板消息锚：首次请求创建，之后每两秒读取 tasks 发布的本机视图，仅文字变化时 PATCH 同一消息并增加 revision；用户再次请求时发送新的最新消息并切换锚。正文直接使用 tasks 的 renderText，因此分组和计数不在渠道重复实现。看板没有操作按钮、任务状态机或账本读取。

`<plugin-data>/<instance>/task-board.json`（0600）声明当前 pid 和 `application/vnd.yonder.task-board+json` Attachment 路由，停止删除。该附件 uri 为随机路径的 loopback TaskBoard URL，只在本机读取，不发送到飞书。原有 task-card.ts 的串行发送、限速 PATCH、原子 receipt 文件被复用；boards 展示 receipt 和原有 receipts 一起保存。发送失败返回现有 Delivery 错误，由 tasks 降级 PNG/文字；大小仍遵守既有 30000-byte 卡片限制。

### Questions for the maintainer

- 显式请求切换当前锚后旧消息保留原样，不再刷新；每个会话只更新最新一张。无需新增工具或 SDK 路由。
- 订阅范围由最近一次 tasks_show 决定，不自行跨 Agent 聚合。进程重启后私有 URL 失效，等待再次 show 重接；PATCH 失败记 unknown 并停止该卡的自动更新，显式请求可重新发送，不猜测失败副作用。
- 秒级时间会继续变化；卡片正文按原 renderText 的整分钟展示，仅实际正文变化时发 PATCH。

### 本轮验证（P3a renderers）

`npm run build`、`npm run typecheck`、`npm run lint` 最终 exit 0；lint 0 errors / 461 warnings / 14 infos。`YONDER_BOARD_SCREENSHOT=/tmp/yonder-task-board-detail.png npm test -- plugins/tasks/test plugins/interaction/test plugins/channel-feishu/test` 为 93 passed / 0 failed / 1 skipped（11 文件）；`npm test` 为 608 passed / 0 failed / 39 skipped（103 文件通过 / 19 跳过）。`node plugins/interaction/test/state.mjs` exit 0。真实 loader/kernel、本地协议服务、实际 Chrome 页面已验证；截图为 `/tmp/yonder-task-board-detail-overview.png` 和 `/tmp/yonder-task-board-detail.png`。

原始失败保留：build 首次 4 个类型错误；聚焦前两轮各 91 passed / 2 failed / 1 skipped（首轮另有 1 unhandled rejection）；两插件 contract 5/2/0 后 6/1/0；UI 单文件 3/1/0 后 4/0/0。均修正测试夹具/计时器类型/Chrome 启动标签页导航竞争，未放宽断言或超时。完整命令、原因和每轮计数见 [docs/status.md](../../docs/status.md) 的 P3a renderers 条目。

未测：真实飞书平台与客户端、已安装 macOS 浮球及焦点、多屏/全屏、生产环境、resvg 缺失的文字降级、干净 npm ci。没有调用模型，本轮没有相关模型行为变更；未读取生产 auth。未推送、发布、安装或操作已安装服务。
