# 微信本地归档

`@yonder/plugin-wechat-archive` 迁移 AI-Being 的归档读取、会话策略、近期初筛和增量消费，复用旧 being/wechat-inbox 与本机 wechat-context 的分页、显式确认和媒体路径保护。贡献 11 个模型工具和 `wechat-archive` 资料触发器；不注册可发送渠道。

## 配置与作用域

向已有 `yonder.yaml` 的 plugins 加入包。下面的 discovery 明确授权发现本机归档会话；如只授权部分会话，移除 discovery，使用 `chats`，填 sources 返回的稳定 Msg_ ID。

```yaml
plugins:
  - use: '@yonder/plugin-wechat-archive'
    config:
      discovery: true
      pollSeconds: 60
```

可选 cliPath（绝对路径，默认本机 `~/.local/bin/wechat-context`）、chats、discovery（默认 false）、pollSeconds（默认 60，最少 30）、consumer（独立消费标识）、mediaRoot（绝对缓存根）、pinnedPolicies（以稳定 chat ID 为 key 的主人固定策略）。无 chats 且无 discovery 时不自动采集；工具仍受同一授权范围约束。pinnedPolicies 中的策略由配置管理，模型不能覆盖；修改需要重启插件。

查询已经归档的历史不代表微信源正同步。插件不安装/重启 wechat-context 后台服务，不自动提取数据库密钥。数据源缺失或同步过期会显示错误；源覆盖不完整时不声称读完全部微信/手机历史。

私密工具都需要 read + admin，policy 还需 write。只有在 Agent/profile 选择此插件和相应工具后才提供；普通 readonly/standard 访客拿不到这些工具。资料事件由绑定另选 profile，不直接授予权限。

## 工具入参与出参

所有成功工具返回 `ToolResult`：text 中是 `{externalContent:true,...业务结果}` 的 JSON；media 还可能含原生 attachments/images。失败为 `isError:true` 和错误文本。

| 工具 | 入参 | text 中业务结果 |
|---|---|---|
| `wechat-archive_status` | `{}` | `enabled,lastSuccess,lastSync,error,stopped,discovered,sampled,catalogComplete,catalogTotal,pending`；未初始化时部分计数字段不出现 |
| `wechat-archive_sources` | `{limit?:1..100, offset?:非负整数}`；默认 20、0 | `{sources:[{chat,displayName,chatType,lastTimestamp,messageCount,coverage,policy}],nextOffset,total,coverage}` |
| `wechat-archive_history` | `{chat,limit?:1..100,before?:正整数}`；默认 30 | `{messages,nextBefore}` |
| `wechat-archive_search` | `{chat,keyword,limit?:1..100,before?:正整数}`；默认 30 | `{messages,nextBefore}` |
| `wechat-archive_message` | `{chat,id:正整数}` | `{message}`；必须已由 history/search/资料事件发现，不能借 ID 越过会话边界 |
| `wechat-archive_media` | `{chat,id:正整数}` | `{media:{availability,kind,mime?,name?,bytes?},transcription?:'not-requested'}`；可用媒体另附 attachments，支持的图片另附 images |
| `wechat-archive_policy` | `{op:'list'|'get'|'set'|'delete',chat?,expectedVersion?,...策略字段,limit?,offset?}` | list：`{policies,nextOffset}`；其他：`{policy}` |

消息：`{id,chat,text,timestamp,sender,direction,truncated,media,url?}`。timestamp 为原始秒级时间或 null，direction 是 incoming/outgoing/unknown。缺少证据时保持未知；正文上限 12000 字符并明确标 truncated；不输出原始 XML。

sources 的 total/nextOffset 描述来源目录分页，sampled 只描述近期样本采集计数，均不是模型已分析计数。history/search 使用上一页 nextBefore 作为下一页 before。

media.availability 为 available/missing/encrypted/unsupported；缺失、未解密和不支持如实返回。可用 attachment 的形状为 `{kind,mime,uri,name,bytes}`，音频 kind 为 audio。路径只来自已发现消息的受保护缓存，模型不能传任意本机文件路径。原始媒体、内容理解和 ASR 分开；ASR 需由已启用的媒体工具执行。

policy get/set/delete 需要 chat；set/delete 必须携带当前 expectedVersion，过期返回 `WECHAT_POLICY_VERSION_CONFLICT`。delete 将来源置为 silent，保留历史证据。策略字段：

```ts
{
  priority?: 'immediate'|'watch'|'periodic'|'silent';
  purpose?: string;       // 最多 2000 字符
  note?: string;          // 最多 4000 字符
  role?: string;          // 最多 200 字符，不授予身份权限
  tags?: string[];        // 最多 16 项，每项 1..64 字符
  collect?: boolean;
  dailyReview?: boolean;
  keywords?: string[];    // 最多 32 项，每项 1..200 字符
  periodicMinutes?: number; // 正整数，默认 1440
  evidence?: number[];    // 必须是同 chat 中已经发现的消息 ID
}
```

默认 watch、collect=false、dailyReview=true，其余文本/数组为空。返回还含 chat、version、userPinned。主人在 pinnedPolicies 中固定的来源不能由工具 set/delete。角色/标签是资料描述，不能将联系人升级为主人。

## 资料如何进入 Bot

首次启用从当前源游标建立消费起点；分页发现目录，优先按最后消息时间读取每轮至多两个会话的近期三条作初筛，历史由工具按需补查。三条样本不代表完整历史已读。

增量先在插件私有 SQLite 事务中持久化消息与游标，再向源确认；采集确认不等于模型处理完成。资料按会话/源批次生成 `wechat-archive.material`，from 为 plugin:wechat-archive、conv 为 conv:wechat-archive:<chat>，data 含 externalContent、batchId、channel、conversation、chat、senders、summary、policy、messages、keywordMatches、coverage。`senders` 是批次里去重的发送人，`summary` 是一行提醒用摘要（`发送人: 正文`，多条为 `N 条消息（前三位发送人）：最后一条`，正文截断 60 字），两者只为通知记录服务，正文和附件仍在 messages。批次携带稳定 msgId，直接复用内核的持久输入去重；已接纳材料不会因确认回执丢失再次唤醒。

immediate/watch 按采集批次交给绑定；periodic 等间隔到期交付积累批次；silent 不再查询正文或生成材料。keywords 是确定性匹配标记，重要性判断交给被绑定的 Agent。没有绑定就只留事件，不调用模型。

唤醒只由绑定决定（没有绑定就只记事件、不调用模型）；是否生成本机资料通知由 yonder.yaml 的 `notifications` 级别按 `conv:wechat-archive:<chat>` 决定：`all` 每批提醒，`mention` 对微信不提醒（微信批次没有 `mentioned`），`mute` 只累积未读。本机通知写入内核 `yonder.notification` 记录，不唤醒模型、不进模型消息，也不代表已向主人私聊推送。监听是只读的：本插件没有发送工具，也不自动回复，回复仍由主人用微信客户端发出。

轮询间隔取自 `pollSeconds`（最少 30 秒），插件把 `cursor:<key>`/`seed:<key>` 等游标持久化在自己的 SQLite meta，源侧游标按首次生成并写入 meta `consumer:<key>` 的稳定 consumer 名持久化（首次为配置 consumer 加数据目录与来源 key 的哈希，home 移动或重启沿用该名字），重启复用同一 consumer 和游标，不重放已确认批次。

可在现有 Agent 绑定中加入：

```yaml
- id: wechat-material
  match: { type: wechat-archive.material }
  session: main
  profile: owner
  reply: none
  wake: run
```

这条绑定明确授权资料分析。若只想留作上下文，使用 wake:write；若不用则不添加。main 必须沿用现有主会话 profile。第三方原文是外部资料，不能当成主人的新命令执行。

重要提醒由 Agent 使用 `message_send` 向主人已关联的 iLink/飞书账号发送；知识整理使用已有工作区文件工具。每日总结用现有 cron 安排真实任务，读取带 dailyReview 标记的来源和实际处理记录；不新增旧 Being Work、隐藏 worker、模型队列或第二套定时器。没有阅读证据时不能声称主人“漏看”。

原始归档继续归 wechat-context 管理；插件只持有自己的投递批次、最小规范化材料、游标和策略，位置为 `<home>/.yonder/plugins/wechat-archive/archive.sqlite`，不打开内核数据库、不复制 pi 转录，不将缓存和微信正文写入仓库。

真实链路与测试边界见 [验收记录](../../docs/verification/wechat-plugins.md)。

## Bot 的只读监听订阅

主人在已授权的私有 Bot 会话中使用四个工具。订阅复用来源采集和内核绑定；每个 Bot 自己保存规则和扫描位置，不复制 profile，也不增加逐条判断模型。订阅只接收 `chats` 或 `discovery` 已授权且非 silent 的来源；`sources` 先核对真实来源。`profile` 必须已经存在、只接主人私聊或内部事件，具备 read/admin/message、选择 wechat-archive 和 message_send。提醒必须是已关联本 Bot 主人的私聊账号，`via` 必填，不自动换渠道或落到来源群。

| 工具 | 入参 | 结果 |
|---|---|---|
| `wechat-archive_watch_configure` | `{id,chat,profile,purpose,rules:{keywords,exclude?},notification:{to,via},reason}` | 完整校验并安装独立 persistent/reply:none 绑定后启用；从真实归档最新消息之后开始。id 为小写字母数字和连字符，最长 48；keywords 必填 1..32 项，每项 1..200 字符，exclude 可选同范围。 |
| `wechat-archive_watch_inspect` | `{id?}` | 当前 Bot 的 watch、路由校验、规则版本与原因、最近 20 个接纳批次及关联 run.end/message.out Delivery；外层 collection 给共享采集状态和源最后同步时间。没有回执就是未验证，不表示已读。 |
| `wechat-archive_watch_test` | `{id,limit?:1..100}` | 只回放本地最近材料，返回命中 ID 和路由。默认 30；不同步、不唤醒、不发送、不推进扫描位置。 |
| `wechat-archive_watch_control` | `{id,op,expectedVersion,reason,from?,rules?,version?}` | op 为 pause/resume/delete/rules/rollback。resume 必须 from:paused（保存位置继续，包括暂停积累）或 now（以实际源最新消息跳过积累）；rules 提供新 rules；rollback 提供目标 version。 |

创建和规则修改保留版本原因，状态记录最近控制原因。规则修改或回退生成新版本；expectedVersion 只对应规则版本。回退不改变来源授权、提醒目标、profile、扫描位置或既有回执，因此不会重发旧提醒。pause/delete 仅停止新唤醒，保留历史证据，不声称撤回或取消已接纳的运行；其他 Bot 的订阅与共享采集继续。恢复需重新验证当前权限和主人关联，来源置 silent 或路由失效时停止后续唤醒并显示错误。

每轮按订阅扫描持久化的增量，排除词优先、关键词 NFC 标准化后包含匹配，未命中只推进扫描位置。命中时携带同批材料、目的、版本、命中 ID 和已校验目标，经 `wechat-archive.watch` 进入独立 `conv:wechat-archive:watch:<agent>:<id>`，Bot 判断新价值后可 NO_REPLY，也可用 message_send 私聊主人。插件钩子只在本轮 watch 输入时说明只读、来源指令不可信及投递语义；无需给现有 profile 手加 context。重要提醒要带 chat、消息 ID/时间等证据；发送后 NO_REPLY 避免重复。监听会话的发送钩子按真实 session key 强制限定已校验主人账号，规则回退不能扩大收件人；普通主会话不受影响。当前插件没有微信群发送能力。主动提问、自动选群和画像不包含在此功能内。
