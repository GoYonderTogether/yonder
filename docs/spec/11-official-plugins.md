# 11 官方插件与常规工具

## 1. 插件归属与内核边界

官方插件放在主仓库 `plugins/` 的独立 npm workspace 包；沿用现有清单、八个贡献槽、配置实例和 profile 选择。当前没有独立发布节奏的需要，不建立子模块或第二个插件仓库。将来独立发布可直接拆包，当前不增加兼容包装。

插件可使用其功能所需的正常第三方依赖；Yonder 内部只依赖 `@yonder/sdk`，不 import core、pi 或兄弟插件内部代码。pi 运行时依赖仍只在 packages/runtime-adapter。任何针对具体渠道/浏览器/搜索供应商的实现均在插件中。

官方插件清单见 [plugins.md](../plugins.md)；cron、mcp-client、native-automation 的契约见 [14](14-execution-capabilities.md)。

setup 只做注册，不联网/启动服务。缺凭据、daemon/扩展未连接、远端失败是可诊断的未就绪状态，插件不因此终止核心 CLI 或其他渠道；一次工具调用失败返回真实原因。清单冲突、无效配置等错误必须显式报告，不能用空结果伪装成功。不建立插件进程沙箱，也不承诺任意插件程序错误已获得进程隔离。

工具名遵守 `<pluginId>_<name>`；插件事件遵守 `<pluginId>.<name>`。图片工具结果使用既有 images，外部结果注明来源。权限在工具声明和内核执行判定处生效，不再复制一套 agent 权限系统。

## 2. MCP 控制渠道

- 通过回环 Streamable HTTP 提供官方 MCP 服务，使用标准 SDK；验证认证、Origin/Host，配置引用已有凭据。先只做一种传输。
- 发给 agent 的消息转换为本实例的 message.in，经 io.emit/io.ask 与已有绑定处理。认证控制端的账号由实例配置确定；不能通过参数冒充其他渠道或绕过绑定指定常驻 agent 会话。
- 映射原生业务 API：事件 emit/ask/query；会话 list/get/open/submit/abort/close/transcript；身份 account/person/relation/lookup/createPerson/link/unlink；messages.send。只有渠道自己的 message.in 与合法插件自定义事件可发出，内核事实不能伪造。
- open/submit 仍只用于预设；常驻 agent 初次创建沿用工作区文件与配置方式，不为此增加配置 CRUD 数据库。
- 凭据读取、含密钥的服务解析与模型登录不映射成模型可见工具；模型可用性可返回不含秘密的信息。
- 异步接收返回原生事件/会话身份，查询真实事件、转录和结果；同步 ask 返回原生 AskResult。不创建 MCP 自有任务状态机。取消、断连和恢复遵守 10 §1。

## 3. 本机 Codex 工具与 Computer Use

一个 `codex-tools` 插件优先复用同一 Codex app-server 的本机连接，用于 Computer Use 与 hosted web search；桌面采用下述替代后端时只接一种桌面实现。它不替代 Yonder 的 pi 模型循环。

### 3.1 桌面能力

- 优先复用本机已安装的 ChatGPT/Codex Computer Use 运行程序与官方插件，通过文档化 app-server MCP 发现/调用能力连接。按本机可用配置发现路径，不把某个缓存版本号硬编码成唯一入口，不复制专有实现进仓库。
- 若该路径实际不可用，选用指定的 open-computer-use MCP。只接一种桌面实现，不同时开发两套桌面驱动，不在用户拒绝权限后切换后端绕过限制。
- 暴露实际可用的应用发现、界面/辅助功能树、截图、点击、输入、按键和滚动，保留上游交互语义、图片结果与错误。只提供说明文档不算实现。
- 状态能区分程序缺失、服务未启动、权限未授权、调用失败。缺权限时引导系统授权，授权后再次真实读取确认。
- 默认保持焦点；任务明确要求打开浏览器、授权和飞书真实操作时才执行对应前台动作。一次桌面操作后按实际界面确定下一步，不盲重放副作用。

### 3.2 OpenAI 登录态搜索

- 复用 Codex app-server 的既有账号与 native hosted web_search，不导出、复制或把 OAuth token 交给 Yonder 模型。
- 使用有界搜索任务，限制其用途为搜索；结果包含实际来源链接、所用模型和可确认的 native webSearch 调用。不能只返回一段无搜索记录的模型回答。
- 无登录、权限或可用工具时报告具体未就绪；Tavily 是同轮明确支持的另一搜索入口，不把失败悄悄变成另一个供应商的成功。
- hosted search 的账号访问需要真实测试；不能因为 pi 能使用某个 OpenAI 模型，就推断它也能直接调用 hosted web_search。

## 4. BrowserSkill 默认浏览器能力

- `browser-skill` 插件复用本机 bsk CLI、daemon、Chrome/Edge 扩展和上游 skill；移植上游适配所需的会话、观察、动作与截图功能，保留完整操作说明，不复制其浏览器引擎。
- 默认浏览器任务选择 BrowserSkill。能力覆盖会话开始/停止、浏览器选择、导航、观察/快照、点击/填写/选择/按键/滚动、标签页、截图、网页读取与文件传输（仅上游实际支持的连接模式）。
- 提供 readiness/setup：区分 CLI 缺失、daemon 不可达、扩展未连接、已连接。先探测、复用已有 daemon；确认缺失后才启动自己的服务。不可凭空新设 BSK_HOME 或重启共享服务。
- 扩展未连接不等于没安装。引导先检查连接；确需安装时，用 macOS 打开 URL 或已获准 Computer Use 打开官方安装页，让用户完成商店安装/连接。这个引导不能依赖尚未就绪的 BrowserSkill 自己点击页面。
- 引导保留实际使用的浏览器/配置实例，说明本地连接配置；用户完成后重新诊断、创建 Agent Window、真实导航观察，再记就绪。daemon 已启动不代表扩展已连通。
- 自动化期间沿用 Agent Window、会话与借用规则，不改变扩展权限设置绕过提示。结束时释放本任务会话。

## 5. 文件检索、Bash 与 Web

### 5.1 grep 与 Bash

- Bash 沿用 pi 原生工具，验证 cwd、取消、退出码、长输出与超时；只在真实不足处修适配，不另造终端执行器。
- 新增真正可供模型调用的 grep：基于 ripgrep，支持模式/字面量、路径、文件过滤、大小写与结果数量，返回文件/行号/匹配文本及明确截断。使用固定程序与 argv，不把搜索文本拼成 shell。
- grep 需要 read，作用域沿用文件工具真实路径规则；不能用只读 grep 调任意 shell，不能跟随符号链接绕过边界。缺 rg 时给出具体依赖诊断，不实现第二个递归搜索引擎。
- 采用 OpenCode/Hermes 的成熟功能语义，在本项目 runtime 中适配已有 ExecutionEnv；这项基础工具允许进入 runtime-adapter，但不把插件供应商实现放进去。

### 5.2 Web 搜索（供应商回退）

- `web-tools` 通过已有 credentials 接口读取各供应商的凭据引用，独立接通 Search 与 Extract；不读取或复制 AI-Being 的登录/密钥文件。
- 搜索按配置 `providers` 的顺序逐家尝试（tavily / brave / serper），第一家成功即返回；失败过的供应商及其错误写在该 query 的 `failed` 里，全部失败报 `SEARCH_FAILED`。未配置 `providers` 时只走 Tavily，行为不变。显式 Extract 仍只走 Tavily。
- 搜索支持 query、结果数、general/news、时间范围、包含/排除域、basic/advanced；返回标题、URL、摘要、供应商、时间/相关性等供应商实际提供字段。网络错误与无结果区分，输出不含密钥。
- 参考 AI-Being 的现有功能，与 OpenClaw/Hermes/OpenCode 对比后移植所需单元；不迁移旧的 Being 配置系统。

### 5.3 Web Fetch

- 公开 HTTP GET，返回最终 URL、正文和来源；支持 HTML 正文、纯文本、JSON/Markdown 文本，输出可选 Markdown/text/html。HTML 正文使用成熟提取库；不支持的二进制类型明确返回 MIME 与下载入口，不谎称已解析正文。
- 正文有界读取、输出明确截断；支持明确取消、必要重定向与真实 HTTP 错误。登录页、401/403 和 JS 外壳给出可用下一步；登录态页面交 BrowserSkill，JS 正文可显式使用 Tavily Extract。
- 简单公开网页先直接读取；不为每个失败堆叠自动供应商回退、模型重试或浏览器接管。供应商和渲染路径须可见，不能把提取失败记为成功空文本。

## 6. GitHub issue、PR 与发布消息

- 一个 `channel-github` 插件承担本项目 issues/comments 与 releases；使用现有 gh 的浏览器授权和安全凭据存储。授权时打开浏览器由用户确认；插件不调用 auth token 输出秘密。
- 仓库、接纳账号与任务标签显式配置，默认只接本项目的授权任务。issue/评论转 message.in，按 issue 建 persistent 会话；release 转独立的合法插件事件，由程序按配置的策略处理，不默认绑定模型。正文是外部数据。
- 本机先用 REST 轮询，不要求公网 webhook；分页、水位与原生对象 id 持久化，重启能继续，同一输入不重复触发；自己的状态评论、PR 伪装的 issue 不制造自循环。跨接收/入库的重复问题由 10 的统一接纳契约解决，不另造插件任务队列。
- 工具支持读取 issue/评论、回报方案与进度、分支/提交所需信息、创建 PR、查看 diff 与检查结果。源码分支和提交复用 git。
- release/update 按 10 §3，不增加一个重复 GitHub 客户端的发布插件。

### 6.1 首次 Release 基线

首次成功读取 Release 列表时，先将当时已有原生 release id 保存为接收基线，不逐个唤醒 Agent 应用历史版本；历史仍可用 read_release 查询。基线持久化成功后才接纳后续首次出现且获准的正式 Release。notify/apply 和显式 update --to 的既有权限不变；不新增版本策略平台。GitHub 普通评论与飞书普通消息工具通过共同 messages.send(request, ctx)，副作用结果不确定返回 uncertain。

### 6.2 程序更新与通知

沿用 approvedAuthors、policy、updater 与 notifyTarget。新增 releases.notifyUpdates?:boolean，默认 false，只有显式 true 才程序订阅内核 release.update-result 并直接向 notifyTarget 发消息。按实际仓库/install/home过滤，按updateId与实例记录一次通知尝试及Delivery，未知不自动重发；不扫描历史重发。apply由精确release订阅器重读真实Release再调用原scheduleUpdate，不构造ToolContext；notify只保留事实。原模型工具继续供用户显式请求使用，但默认移除同时自动执行的run绑定。
贡献 channel-github.release-availability（placement:turn），使用最近成功轮询核实的最高获准正式版本与宿主version比较；仅显示严格更新版本，首次基线也核实。正文不含Release body，聊天不联网，选用贡献才展示，不改system。旧job回执/历史保留，但新程序通知只消费统一core事件，不对旧channel-github.update-result再通知。

## 7. 飞书消息渠道

设计依据：固定 commit 的 OpenClaw 和 Hermes 飞书调用链，并对照飞书官方接口。

完整范围指下列渠道消息能力；不把上游所有办公应用 API 当作消息插件的前置依赖。

### 7.1 连接、配置与入站

- 飞书/Lark 域、应用/机器人、多个配置实例；appId 与 secret 引用；连接状态与必要权限诊断。默认 WebSocket 长连接，本机无需暴露公网；webhook 模式如用于上游已支持卡片回调，必须有真实需求与完整验证。
- 私聊/群聊、发送者、@、引用/回复、线程标识；text/post、图片、音频、视频、文件与卡片内容按实际类型转换成文字/附件或明确类型提示，不静默丢消息。
- 下载消息资源并保留 MIME/名称/大小，身份使用 acct/conv 引用；接收去重、重连恢复和租户/实例隔离正确。
- owner/known/stranger、群/会话选择、mention 唤醒复用绑定；传输身份校验与机器人自身/互刷事件处理留在渠道，避免复制两套 agent 路由规则。

### 7.2 普通消息与多媒体输出

- 文本、Markdown/post、图片、文件、音频、视频、回复/线程消息；使用正确上传与发送接口、消息类型、文件元数据，返回真实消息 id 与发送结果。
- 支持渲染模式选择、文本分块与媒体大小的上游必要配置；错误、平台限制、权限不足必须可见。
- 用户附件进入本轮模型/工具路径，模型产物能由消息工具发送回去；不以“附件 URL 已生成”代替实际可打开/可播放。

### 7.3 卡片与流式

- 普通卡片与模板内容、自定义卡片发送工具、支持的按钮/交互回调。沿用 04 §8 的渠道自带工具，不为卡片发明一个跨所有渠道的任意消息 DSL。
- 默认可选 CardKit 流式：创建卡片、发送实体、累计内容更新、严格递增 sequence、合并必要更新；每条 assistant 消息说完立即关闭 streaming_mode，后台任务继续执行不保持旧气泡生成。阶段汇报和最终结果分别新建气泡，正常、取消与错误都收尾。
- 使用上游成熟的消息 id、更新与错误语义；已可见卡片最终关闭失败不得触发一条无依据的重复最终消息。
- 自定义卡片操作记录插件事件与 pi 工具转录；普通发送仍由既有 message.out 记录。回调有来源、操作者与原消息关联，经合法插件事件进入绑定。
- 卡片模板、是否流式、回复目标及必要的大小/分块参数可配置；不复制上游与本阶段无关的历史兼容字段。

### 7.4 恢复与交互

- 飞书随harness统一启停；WS创建不受bot/info瞬时失败阻断，使用官方SDK唯一重连循环，stop取消连接/初始化/历史请求。状态区分连接、身份和补齐，永久配置/鉴权错误明确可见。
- 启动/重连按安装基线和每会话持久水位查询固定截止时间的历史；全新安装无账本时不自动执行此前消息；已有安装首次启用补齐时，从各已知会话账本最后已完成消息时间续接，不以升级后的当前时间跳过安装间隙。已知私聊及机器人获准群逐页补齐，群列表不能枚举未知私聊。群线程旧根的新回复需单独取线程历史、本地过滤时间；权限不足或分页失败标未补齐，不推进失败会话水位。
- 实时和补齐共用消息转换/资源/原生ID去重；恢复事件data.originals保留原始ID/时间/发送者/引用/附件，仅合并时间顺序中连续同会话同发送者同线程的输入，不跨其他发送者重排；正文逐条显示实际原发送时间/消息ID/引用并明确为恢复历史；元数据及分隔计入64KiB UTF-8文字一批，超出拆批，成功接纳后推进水位。用事件账本恢复去重事实，覆盖事件成功而receipts未保存的窗口；不创建模型队列。
- 可运行飞书绑定默认steer；主人私聊用该agent的main和同一owner配置档，与CLI主会话连续。其他私聊/群默认wake=write旁观，不运行命令、不获得owner能力。owner必须关联已核实账号，保留旧受限会话。
- 历史工具支持会话/线程、分页和时间；read/network为必要能力，非admin仅本轮来源，跨来源要求admin。命令沿用共享的 /help、/session、/connect、/skills、/stop，以及 12 定义的 /model、/status、/compact，共用名字/描述和会话命令实现；其余既有TUI命令提示终端专用。//转义普通文本；未授权/旁观来源不执行命令；命令先按既有绑定权限解析，不进入模型猜测。
- 可执行输入接纳后用平台Typing表情标记；首次可见回复时撤下，NO_REPLY/失败/取消终结也清理。旁观不标处理中。reaction失败记录脱敏诊断而不丢输入、不阻断回复、不盲重发。
- 自动回复与显式replyTo分开：自动投递提供sourceMessageId；飞书在首次可见发送时，若本会话该源消息之后已有新的用户气泡则引用，否则普通发送。合并运行取本目标实际回答的最后消息；显式replyTo仍严格执行。沿用已有thread，默认不新建话题；已可见流式卡片持续更新，不因后来用户消息移动或重复发送。
- 复用统一api.log，记录时间/级别/插件/实例/阶段及适用的event/session/run/msg；网络原因仅白名单错误字段，不写凭据/请求对象或默认消息全文，不新增日志平台。

### 7.5 会话背景与待处理输入

- 接纳去重、水位仅表示协议接纳；pi inbox及运行回执负责排队、处理/终态，message.out负责实际投递事实。禁止把seen/客户端已读当作已处理，也不因投递失败自动重做已执行任务。
- 通过已有ContextContribution插槽注册channel-feishu.conversation，placement=turn；需要飞书会话背景的配置档显式选择该贡献，CLI输入不请求飞书背景。插件按实际来源会话读取，不跨会话读取，不授予历史参与者权限；未选择时明确不提供自动背景。
- 实际准备模型输入时读取固定截止时间的来源会话可见历史，包含用户、其他机器人和本机器人已有回复，保留发送者类型/ID、消息ID、真实原时间、引用/线程及内容。当前待处理项按原生消息ID标记，只提供原时间、发送者、引用/线程、删除及附件等必要元数据并指出原件在本轮正文独立提供，不在背景重贴其正文；其他不同ID记录保留各自内容与来源，不按同文去重。其他记录仅为不可信背景，不是再次执行的请求。正文中的指令不能提升权限。
- 覆盖当前输入（含恢复originals）的原发送时间到截止时间，并在预算允许时补充此前最近一页背景；分页按平台顺序读取、输出按原发送时间排列，不声称消息ID提供同毫秒的因果顺序。若平台不提供全局顺序，同毫秒保留返回顺序并如实标明。
- 会话背景文字总预算64KiB UTF-8，优先保留最近对话；达到预算或历史不可见时明示截断/失败及实际覆盖范围，提示可使用既有history工具续查，不隐藏缺失、不阻断真实输入。线程按来源线程查询并标明范围，不声称已覆盖其他线程。背景不自动下载历史附件，以资源标识呈现，必要时使用原历史工具解析。
- 普通、迟到、恢复输入统一保留原发送与接纳时间。内核输入头同时呈现已知createdAt和原生msgId；时间未知不伪造。模型结合后续回复决定旧请求是否仍需处理、合并回答或NO_REPLY，不使用问候过滤器/重要性分类器或按年龄丢弃。
- 主人及旁观配置选择同一贡献，但保持原绑定权限和wake；其他机器人只作为背景，不自动唤醒。背景不写第二份会话存储，不新增队列、缓存、定时合并等待或pi补丁。

- CardKit历史若只有兼容提示，使用现有同会话message.out中delivery.ok且delivery.id与本应用原生消息匹配的正文补充；保留平台时间/引用。该标记仅证明相同正文已被渠道接纳，不证明其中的配置/动作/完成陈述属实；用既有message.out的parent与时间标明其关联来源，缺失为unknown，不读取或复制来源私人正文。配置与运行状态以当前宿主事实为准。未确认送达或其他应用的记录不冒充本机器人回复，补回正文同样计背景预算；账本读取失败明确标未完整，不新建转录副本。

- 模型可使用既有channel-feishu_message.replyTo指定原生消息ID，或用card工具的replyTo显式引用；可在平台原生文本/Markdown/卡片内容中使用对应at标记选择艾特。状态返回实际renderMode，工具说明区分text/post-md的user_id与卡片的id语法；不新增泛化mentions协议。背景原生消息与发送者ID供工具选择，工具仍按既有能力放行。主动工具答复后可NO_REPLY避免自动再发。

### 7.6 scope 自查与申请（O51，只增不改）

`channel-feishu_scopes`（按 `<pluginId>_<name>` 命名）参数为 `{ instance, action: "status"|"apply", scopes?: string[] }`（`scopes` 最多 50 项），能力 `read` 与 `network`，`apply` 另需 admin（否则报 `Applying Feishu scopes requires admin`），不放宽任何既有工具。

- `status` 读飞书 `GET /application/v6/scopes`，返回 `{granted, pending, notConfigured, consoleUrl, applyAttempts}`：`granted` 是 `grant_status` 为 1 的项，其余已加入应用的项为待授权，`consoleUrl` 指向开发者后台该应用的权限页。
- `apply` 只提交已经加到应用里的待授权 scope（`POST /application/v6/scopes/apply`）；没有待授权项时跳过，申请次数达上限后不再申请（当前上限 8，飞书官方每个版本上限 10 之内），次数记在插件私有 `scope-apply.json`。
- 默认 scope 集为 `im:message`、`im:message:send_as_bot`、`im:resource`、`cardkit:card:write`；补齐权限本身仍在开发者后台由主人完成并发版，工具只做自查与申请。
- 结果为 `{ok:true,…}` 或 `{ok:false, uncertain?, error}` 并置 `isError`；结果不确定时不宣称已授权。
- 鉴权错误 `99991672`、`99991679` 的既有诊断在脱敏后追加一行提示，指向本工具与开发者后台，不把应用凭据或 token 写进诊断。
### 7.7 按真实群名发现目标

提供只读 `channel-feishu_chats`，沿已选实例与既有飞书客户端列举机器人实际可见的群名、原生chat ID和conv引用，支持有界分页及可选名称筛选。能力要求read/network/admin，跨会话目录不对受限群档或访客开放；沿channelInstances检查，不扩大应用权限，不枚举未知私聊，不读消息或成员正文。实例、分页、名称与目标引用只来自真实平台响应，截断/hasMore/权限缺失如实说明。

飞书Channel的可选describeConversation复用既有飞书客户端，对属于本实例的已知群conv精确读取，只返回真实name及可确定的kind；失败、无名或非群保持unknown，不返回成员/凭据。平台可能向非成员返回群名，因此成功标签不作为入群、准入、全量接收或发送权限依据。QQ无已实现的同类平台描述时保持unknown，不从room index、配置profile名或model生成session title伪造平台群名。

主人仅给群名时，由该工具把自然目标定位到可核验引用；重名或结果不完整不能自动选第一个，必要时仅问目标歧义。缺scope沿已有scopes工具和平台授权入口诊断，不把用户知道chat ID作为前置条件。工具只发现，不接入、不改绑定、不发送消息；后续仍由既有配置管理、独立群上下文和原授权执行。

## 8. 上游复用

允许直接移植成熟功能模块并保留必要来源/许可记录，适配为本项目 SDK。选择以覆盖本规范契约、状态所有权清楚、依赖少、可维护为依据；不复制整套 OpenClaw/Hermes/OpenCode 内核，也不删除其实现中本任务真实需要的取消、输入边界或协议行为。

参考仓库可以更新；每项实现开始时固定实际使用的 commit 与模块。参考项目之后更新不自动改变本规范。

## 9. 原生媒体工具：硅基流动

- 新增同仓官方SDK插件media-tools，首段只实现已核实免费的图片生成；不增加指导型skill，不修改pi运行循环、Models或SDK。ASR/TTS先核实价格与协议，明确免费后可在同一服务接入任务中补记并实施；视频只调研，无免费API证据不调用付费生成，不用网页体验或赠送额度冒充永久免费API。
- 注册media-tools_image_generate；参数为非空prompt、可选model和image_size。通过api.services.resolve('image')读取首个端点；protocol=siliconflow、baseUrl=https://api.siliconflow.cn/v1，模型只能从该端点声明清单选择，未指定取首项。凭据沿既有credential引用解析，不复制OAuth。缺配置、密钥或模型时返回真实错误，不自动选其他服务/收费模型。
- 请求直接使用硅基POST /images/generations，保留平台默认水印；响应按images[].url解析，立即下载实际图片（不向下载URL转发API鉴权），经ctx.env在当前cwd的artifacts/下保存唯一文件，返回真实本地附件URI/MIME及模型和产物事实。不创建产物数据库、后台任务、缓存或重试。
- 工具声明network/write，响应ctx.signal；不允许模型指定任意覆写路径，不通过Node文件API绕过执行环境。模型/尺寸只支持实际协议声明的首段参数，错误保留请求阶段/状态，不打印密钥、鉴权头或请求对象。
- 本次配置与真实验收仅用控制台已核实¥0/图片的Kwai-Kolors/Kolors，保存价格日期/证据；免费配额仍可能限流，429如实返回。源码契约检查、真实免费API调用与渠道客户端验收分别记录，不以其中一个代替其余。不得为通过而更换成收费模型。
- 新插件及共享打包接线按独立任务执行；正式安装/发版沿已有流程，当前接入批准不自动发布。

免费音频补记：控制台已核实FunAudioLLM/SenseVoiceSmall在线推理¥0，GET /v1/models也列出该模型。追加media-tools_audio_transcribe，参数file和可选model，经services.resolve('asr')读取同协议服务，multipart file+model调用/audio/transcriptions并返回真实text。声明read/network、响应ctx.signal；文件经ctx.env读取，无exec时只允许cwd内真实路径或本轮来源明确附件，沿平台50MB输入上限，不上传任意猜测的工作区外文件。

付费TTS补记（主人2026-10-30授权，2026-10-31改为阿里百炼）：主人要求补齐语音合成工具并实测，付费调用已获授权。追加media-tools_audio_speak，参数为非空text（上限2000字符）、可选model、voice和speed（0.5–2），经services.resolve('tts')读取协议为dashscope的端点；其他协议在建立连接前即拒绝，不静默降级为HTTP。请求走百炼双工协议，合成音频按真实文件头判定容器后经ctx.env存到当前cwd的artifacts/并返回audio附件。声明network/write、响应ctx.signal与时间上限；只接收属于本任务的服务端帧，失败与超时都报明确错误，不当作空结果。模型和音色只能从该端点声明清单选择，未指定取首项；缺配置、密钥、模型、音色分别返回明确错误，不自动切换供应商或收费模型。费用由提供方按字符计（cosyvoice-v3-flash 1元/万字符），工具说明如实告知，不隐藏价格；不重试、不缓存、不建产物数据库。视频仍不调用。

## 微信双插件

wechat-archive 提供本机 wechat-context 归档的 sources/history/search/message/media/policy/status 工具及同名触发器；它不注册可发送渠道。工具需要 read + admin，策略修改另外需要 write；私密归档不因普通访客有 read 就开放。配置 cliPath（绝对路径）、chats 或 discovery、pollSeconds（最少 30 秒）、可选 consumer/mediaRoot/pinnedPolicies；主人在 pinnedPolicies 固定的策略禁止模型覆盖。增量在插件私有 SQLite 先持久化，再确认源游标；按原消息 id 去重，事件成功接纳后标记已发。批次携带稳定 msgId，重启复用内核已有持久去重核对接纳，采集确认不代表模型处理完成。首次从启用时刻建立游标，历史由工具按需查询；未知初始化结果保留并恢复，不能重新从现在开始跳过消息。轮询间隔取自 pollSeconds，插件把 `cursor:<key>`/`seed:<key>` 等游标持久化在自己的 SQLite meta，源侧游标按首次生成并写入 meta `consumer:<key>` 的稳定 consumer 名持久化（首次为配置 consumer 加数据目录与来源 key 的哈希，之后 home 移动或重启沿用）；重启复用同一 consumer 与游标，不重放已确认批次。监听是只读的：插件没有发送工具，也不自动回复，主人的回复仍由本人用微信客户端发出。

归档事件为 wechat-archive.material，conv:wechat-archive:<chat>，from:plugin:wechat-archive。data 包含来源消息、策略、原时间和 externalContent:true，另带 `channel: "wechat-archive"`、`conversation`、批次去重后的 `senders` 和一行 `summary`（单条为 `发送人: 正文`，多条为 `N 条消息（前三位发送人）：最后一条正文`，正文截断 60 字，纯媒体消息记 `[<kind>]`，无正文记 `[无正文]`）；`summary` 只用于内核通知记录，正文与附件仍只在 `messages`。不冒充 message.in 或主人。绑定显式选择是否运行/旁观及 profile。策略保留 immediate/watch/periodic/silent、角色/标签、collect/dailyReview、关键词、证据与版本；角色标签不授予身份权限，dailyReview 是供现有 cron 任务选择的资料标记，不自动增加调度器。沉默来源不查询正文、不发后续材料；周期策略按 periodicMinutes 合批，其他策略按轮询批次交付，由绑定决定模型是否运行。唤醒仍只由绑定与 `wake` 决定；是否生成本机资料通知由 yonder.yaml 的 `notifications` 级别（all/mention/mute）按 `conv:wechat-archive:<chat>` 决定，mute 只累积记录。微信批次没有 `mentioned`，所以 mention 级别对微信不提醒，需要提醒时用 all。

只读监听以同插件四工具形成闭环：`wechat-archive_watch_configure/inspect/control/test`。configure 仅为调用 Bot 建立订阅，要求已经授权且非 silent 的来源、已有私有 profile、关注目的和确定性关键词/排除词规则、已关联本 Bot 主人的私聊账号与明确渠道实例；复用内核绑定管理预检并安装独立 `conv:wechat-archive:watch:<agent>:<id>` 的 persistent 绑定（wechat-archive.watch、wake:run、reply:none）。所有验证通过才启用，不扩大来源 allowlist，不复制 profile，不给群聊/访客 profile 归档权限。首次及显式从 now 恢复以真实归档最新消息建立起点；采集由原共享 consumer 完成，每订阅有独立扫描位置、启停和规则版本。

每轮从已持久化的增量筛选规则并合批，未命中不唤醒模型；命中后通过绑定交给本 Bot，携带来源证据、关注目的、规则版本和主人私聊目标。群原文是 externalContent，不授予指令权限。Bot 可选择 NO_REPLY，值得提醒时只用已有 message_send 向已验证主人目标发送，监听会话的既有 beforeSend 钩子按真实 session key 强制限定该收件人并复核当前授权，其他会话不受影响；本插件不回复微信群，也不增加逐条判断模型。inspect 区分源同步、扫描、命中、路由接纳、run.end 和实际 message.out 的 Delivery；发送成功不是已读，未知结果不自动重发。test 只回放最近已归档材料，返回命中和计划路由，不唤醒、不发送、不推进游标。

control 的 pause/delete 只停当前订阅并保留证据；resume 必须指定 paused（从保存扫描位置继续积累材料）或 now（跳过暂停积累，以真实源最新消息为起点）。规则更新必须带当前版本和原因，rollback 创建一个新版本，只恢复指定旧版本的关注规则，不改变来源授权、主人目标、profile、扫描位置或投递证据。共享来源 silent、失去绑定/权限或主人关联时停止该订阅的新唤醒并报告原因。主动提问、自动选群、画像和新调度框架不在此能力内。

channel-wechat-ilink 注册 wechat-ilink 渠道，独立实例，私聊 kind=dm。插件配置 owner:person:<id> 明确默认主人（应与目标 agent.owner 一致），第一个配置实例在首次扫码时默认将扫码联系人关联该 person；第一次注册的实例 id 在插件私有状态持久化，后续增加、重排或移除实例不转移这一资格。后续实例不继承主人：实例 person 可显式指定其他已存在 person，null 明确不关联；省略时也不关联。首次扫码及恢复未完成的绑定时保留既有身份关联，冲突须由管理面处理；主动重新扫码确认时，新扫码账号沿用该实例原 person，复用 identity.link 更新关联；原账号历史关联保留。可选 allowedUsers 添加可接收的其他私聊账号，只有扫码联系人按上述规则关联；其他账号不会自动成为主人。每个实例保存自己的 bot id、扫码 peer、接收游标和按 peer 隔离的 context token。

提供 status/read、login/admin+network、message/read+message+network 工具。login start/poll 只返回二维码 URL、状态和非秘密身份；token 由插件保存于私有目录的 0600 文件，目录 0700，不进入工具结果/事件/配置。可选 credential 从 SDK 凭据接口读取已有 api_key，需搭配实例 peerId/botId，不能借外部 token 自动建立主人关联。扫码流程由已授权管理面调用；不添加通用凭据写接口。首次扫码结果明确绑定人；用户主动重新扫码确认即覆盖该实例的连接与身份关联，不再比较旧 bot 或扫码账号，也不需要额外确认。

所有入站均通过 ChannelIO.emit(message.in)，账号和会话分别为 acct:<instance>:<peer>、conv:<instance>:<peer>；关系由现有 identity 与 agent.owner 求值。主人绑定可进 main；其他人按 from:known/stranger 进入 per:conv persistent 与受限 profile，不默认与主人共享上下文或私密工具。实例的连接先后不参与运行时权限判定。

出站复用 message_send/api.messages.send，支持文本及 image/audio/video/file（音频作为文件，不声称原生语音气泡）。过程流按 message_end/final 每条气泡发送，不逐 token 发消息；原生引用 replyTo 保留。发送必须有该 peer 的 context token；缺失明确失败，不能拿主人 token 替代。已部分发送或网络结果不明返回 uncertain，不自动重发。入站媒体下载解密，SILK 转 WAV、其余支持编码保留音频，不默认 ASR，不声称客户端送达或内容理解已验收。普通微信群不在可声明能力内。


### BrowserSkill 可选本地 profile 能力（D54）

`browser-skill_bookmarks` 提供 tree/move/create-folder/remove-empty-folder，配置 `bookmarksEnabled:true` 且主人手动授予可选 bookmarks 权限才可执行。禁止 URL 删除、非空文件夹删除、根/受管理节点写入与远端连接。`browser-skill_extensions` 提供 list/enable/disable，配置 `extensionsEnabled:true` 且主人授予可选 management 权限才可执行；目标须为明确的扩展 ID，禁止自身/受管理项目。两者均只能使用当前 Yonder 会话创建的本地浏览器会话，写入沿既有串行队列和 interrupt gate；权限逐次由扩展核验。扩展管理影响整个 profile；卸载真实测试被 Chrome 要求手势阻止，不提供工具动作，交主人执行。不能安装或授予权限。Chrome 的手势/确认错误原样返回并交主人，不静默换后端。商店与 chrome:// 页面保持原有限制；独立测试浏览器不继承主人登录态。

## 15. QQ 官方机器人渠道

- `channel-qq` 是独立 SDK 插件，优先复用腾讯 `@tencent-connect/qqbot-nodejs`；通过官方 WebSocket 接收 C2C、群 @ 与平台已开放的群普通消息，REST 发送文字与 image/audio/video/file 媒体（SDK 上传后发送，音频按文件发送，不声称原生语音气泡）。平台连接会话与 Agent 会话分开，模型唤醒、权限和转录仍归内核。不声明 Webhook 与流式输出。
- 实例配置为 `appId`、`credential`，以及可选的 `allowedUsers`（单聊用户 OpenID）、`allowedGroups`（群 OpenID）和 `sendIntervalMs`（出站请求最小间隔，默认 500，0–60000 毫秒）；未列名单表示不限，空名单拒绝。入站生成 `message.in`，保留原生 msgId/createdAt；账号为 `acct:<instance>:<openid>`，单聊会话为 `conv:<instance>:c2c:<openid>`，群为 `conv:<instance>:group:<openid>`。接纳 GROUP_AT_MESSAGE_CREATE 与 GROUP_MESSAGE_CREATE；在清理正文前复用腾讯 mentionGate 的识别结果呈现 mentioned，passthrough 不过滤普通消息。平台须开启“接收所有消息”才能推送全量事件；Yonder 的接纳能力不代表平台已授权。新配置用 wake: write 旁观，交由 `social` 的 `social.batch-ready` 决定是否运行（见本节“群聊独立参与与共享协调”）；旧配置的 wake: mention 仍只在 @ 时运行，需显式升级，不能通过逐条 wake: run 冒充。
- QQ 可选插件元数据 `data.qq.msgIdx/refMsgIdx` 保留官方 SDK 提供的消息/引用索引。显式引用优先使用同群账本可证实的引用索引；官方当前字段说明与示例冲突，旧原生消息 ID 路径兼容保留，平台拒绝如实反馈，不把回执成功当客户端引用已验收。
- 入站媒体映射为 `attachments`：`content_type` 决定 image/audio/video/file，只接纳 https URL，其他 URI 丢弃而不猜测（丢弃数量记一条 warn 日志，消息本身仍接纳）；引用回复的原文取 `msg_elements[0]` 写入 `quote.text`，参考索引本身不含正文。只有附件没有正文的消息同样接纳。出站媒体接受 https URL 或绝对本地路径，一次回复可先发文字再逐条发媒体；同一被动回复的多条消息共用 msg_seq 计数。所有请求经插件内串行间隔器发送，`sendIntervalMs` 为最小间隔；平台限流与 5xx 仍按 uncertain 处理，不盲重发。
- 群模型自行选择普通发送、respondTo 语义回应、replyTo 可见引用、mentions 艾特；群提示禁止强制逐句引用。同一真实群在各渠道实例里是不同的 conv；插件维护一个只读的群房间索引（`social_group_index`），按配置登记或「发送者、平台发送时间、正文」一致的同一条消息合并，绝不按显示名或时间接近推断，并在群对话的请求上下文里给出本机已知的兄弟 Bot 与发言人；平台不提供成员列表，未发言的人不在其中。新建和已安装的官方群配置采用同一契约，更新只迁移可识别的旧官方指令和工具选择，保留用户定制。QQ @ 仅按官方 SDK/协议可验证身份发送，不支持则明确报错；客户端实际提醒独立验收。
- 普通回复使用 OutMessage.sourceMessageId（显式 replyTo 优先用作被动回复目标），不借用另一次输入的消息 ID。SDK 管协议序号与恢复，内核事件账本管输入去重。发送不明返回 uncertain，不自动改成主动消息或盲重发。
- 插件附带本机配置命令 `yonder-qq setup --home <home> --agent <id> [--open]`，仅在用户授权的目标 home 操作；它不是运行中 PluginAPI 的凭据写接口。命令调用腾讯公开发布的扫码连接器，输出官方绑定链接与终端二维码，可显式打开系统浏览器；用户自行登录、扫码、选取或创建机器人，凭据不进入模型输出。取消/失败不修改配置。
- 扫码完成后命令将密钥保存到既有 auth.json 的独立 api_key 项（0600，沿用原文件锁），在 yonder.yaml 写凭据引用和渠道实例，给指定本机 Agent 加绑定，保留原配置和其他凭据。只绑定扫码用户的私聊；群默认新建只读的独立配置档，选择必要共享上下文，可显式选择既有群配置档。无扫码用户 OpenID 时不自动开放私聊；有歧义的多机器人结果要求明确选择。
- 新插件代码通过重启加载，不冒充热加载；配置工具返回明确下一步。`channel-qq_status` 报真实连接状态与计数，连接成功不等于真实模型收发验收。
- 必须验证真实用户扫码、官方入站、内核绑定、真实模型与官方回复回执；私聊和群 @ 分别记录，未收到对应场景的真实消息就保留未测。
- 群持续参与：新扫码配置默认群分身 capabilities: [read]，提供 read/grep、conversation_read、conversation_members、conversation_attachment_read、message_send、parent_ask，复用所属 Agent 的 workspace 与所选 context-files，不给跨群历史管理、写、exec 或通用 message 权限。群原消息绑定 `wake: write`（`persistent/per: conv`，`reply: none`），模型显式选择发送；**参与机会由 `social.batch-ready` 提供**，`channel-qq` 只做接收、规范化与发送，不产生自己的群批次运行。批次候选沿本节“群聊独立参与与共享协调”的免费筛选和每 Bot 策略产生，person 关联不再作为立即触发条件。普通消息观察窗口默认 3 秒（既有显式配置沿用），发言静默窗口另见下文，@ 提前结束等待；插件只保存账本游标与批次身份，原文只在账本和原生 conversation，不建第二转录/模型队列。忙时合并待处理范围，空桶不调用模型；已接纳批次沿原生恢复重接，失败保留可见状态，不盲目重放发送。QQ 入站未提供可可靠识别的 @主人 信息时保持未知；通用群策略和轻量判断按下文契约实施，源码检查不代替真实渠道验收。
- 旧群配置的 `channel-qq.group-batch` 事件类型与字段保持可读：`groupParticipation` 的 `all`/`mention`/`record` 继续被解析，供尚未迁移的 home 按原语义工作，但不再新增使用它的运行绑定。按 20 §3 弃用，至少保留 0.3、0.4，最早 0.5 移除；使用旧链时运行时 warn 指向 `social.batch-ready`，并在 `CHANGELOG.md` 记录。迁移走 `yonder-qq upgrade-groups`：只识别可确认的官方群绑定与官方配置档，可预览、逐字段校验、写备份、可重复执行，自定义绑定与自定义配置档不覆盖；迁移后官方群由 08“官方 QQ 群的默认参与范围”接管，旧「观察窗口非空就运行」的 60 秒语义不得保留。未迁移的 home 仍按旧链运行并看到弃用警告，不能声称迁移已完成。
- 官方全量权限由最新版手机 QQ 的群主在具体群聊的机器人管理中选择该机器人，再在“设置权限 → 机器人可获取的群聊消息范围”选择；接收全量与允许主动发言是两个设置。官方 bot_state 可查询 recv_msg_setting（all/only_mention/mention_and_context），查询接口本身仅对白名单机器人开放；不能把这个接口白名单误当成全量接收必须企业认证的证据。

## UI Companion 交互窗口

`interaction` 提供结构化卡片工具及 `interaction.card` 视图。`interaction_present` 返回交互 id；`interaction_result` 按发起会话、agent 和配置档读取结果，等待可取消而不取消卡片，session.close 取消该会话的待处理卡片。卡片与答案持久化在插件私有数据目录。视图通过控制接口展示和接收答案，按修订号及步骤序号拒绝过期回答；卡片回答不构成其他工具的权限放行。插件不再提供独立 HTTP 服务。

### code-intel（可选）

`code-intel_project_report` 通过执行环境内的共享 pi-lens MCP 返回项目结构报告，接受可选 limit、focus 和 view；冷缓存返回 unavailable 并在后台构建，后续调用可读取热报告。需要 read、exec，仅选中插件时提供，输出沿用运行时截断与缓存。

`code-intel_symbol_search` 在选定执行环境通过共享 pi-lens MCP 连接搜索标识符，接受 query 和可选 limit、paths、lang；冷索引构建中返回后端状态供重试。需要 read、exec，仅选中插件时提供，输出沿用运行时截断与缓存。

`code-intel_effective_config` 在选定执行环境调用 pi-lens 4.4.6 MCP，接受可选 file（须解析到 cwd 内），返回脱敏的配置来源、工具开关及该文件的语言、server 和 runner 选择理由；上游不返回全部配置值。环境变量值和命令参数不得输出，home 内路径使用相对 home 表示；越界返回错误。需要 read、exec，仅选中插件时提供，运行时截断与缓存只能保存已脱敏的后端结果。

`code-intel_lsp_navigation` 在所选执行环境调用 pi-lens 4.4.6 MCP，提供其 19 种 LSP operation 和 capabilities 发现；位置参数为 path、line、character，其他参数沿用后端 schema。仅选中插件且具备 read、write、exec 时提供。当前一次性 MCP 连接无法保证跨文件写入及取消，rename、rename_file、executeCommand 的 apply:true 返回明确错误；预览和其他操作依后端能力返回结果或错误。长输出使用现有运行时截断和缓存，缓存不补全后端已截断的内容。

`code-intel_ast_grep_search` 在当前执行环境调用 pi-lens 4.4.6 MCP 的 `pilens_ast_grep_search`，需要 read、exec，仅选中插件时提供。接受 lang，pattern、rule 或 nodeKind，以及 paths、selector、context、insideKind、hasKind、hasDescendantKind、follows、precedes、strictness、skip、maxMatches、groupByFile、validateOnly、dump；沿用上游互斥和校验，rule 是数据而非 shell。maxMatches 默认 50、上限 200；validateOnly 只校验不扫描工作区。返回文本中的命中位置和零结果 dump 提示；pi-lens MCP 不返回结构化 readSlice 或 suggestedDump。输出沿用运行时截断与缓存。

`code-intel_lens_diagnostic_mark` 接受 `filePath`、1-based `line`、诊断 `message`、`disposition`（`false-positive`、`suppress`、`defer`、`flagged`），以及可选 `rule`、`tool`、`reason`；`suppress` 必须提供 rule。采用 pi-lens 4.4.6 的内容锚定：false-positive 严格绑定规则、消息、来源和规范化目标行；其余标记弱绑定规则、消息和来源。false-positive 与 flagged 持久，defer 按 Yonder session 隔离；suppress 在目标行上方写 `pi-lens-ignore` 并持久记录。每次标记记录日志，返回处理结果与作用域；需要 read、write、exec，重新探测实际诊断并拒绝找不到或等距歧义的目标；仅选中插件时提供，使用执行环境与现有运行时输出截断及缓存。本适配不声称存在 pi 的诊断事件总线或 Yonder 原生诊断总线。

`code-intel_lens_diagnostics` 通过 pi-lens MCP 获取诊断，支持 path、paths、source、scope、mode、severity、waitMs、serverScope，以及原样透传给后端的 concurrency、refreshRunners（布尔或 cached/cheap/all/none）、maxProjectFiles、maxLspFiles、includeGenerated、analysisRoot；需要 read、exec。默认单 path 分析消费项目持久标记和本会话 defer，显式 source=lsp 走后端原始探测（不消费会话标记），source=session 因 MCP 进程无会话缓存而返回不可用；其他后端路径不声称消费会话标记。分析禁用自动格式化、自动修复和测试。标记存于执行环境 cwd 的 `.pi-lens/cache/diagnostic-dispositions.json`，日志为 `.pi-lens/dispositions.log`。

`code-intel_read_enclosing` 在当前执行环境通过 pi-lens 4.4.6 MCP 按 path 和 1-based line 读取最小包含符号或回调，支持 kinds、maxLines、onOversize（error 默认仅元数据、slice、outline）和 aroundLine；需要 read 与 exec。仅选中插件时提供，使用运行时输出缓存；pi-lens 内部读取记录不等于 Yonder edit 的读取检查。

`code-intel_codegraph_explore` 在当前执行环境通过 CodeGraph CLI 读取已建索引，接受 query、可选 maxFiles（默认 12）及 projectPath（默认工作区）；先检查索引状态，缺失或过期时给出初始化或刷新动作。仅选中插件时提供工具；不自动初始化、启动 watcher 或注入项目图。输出沿用运行时工具截断与缓存。工具需要 read 和 exec 能力。

`code-intel_module_report` 在当前执行环境调用 pi-lens 4.4.6 的 MCP，接受 path 与可选 focus、view、blastRadius、maxRefsPerSymbol、blastRadiusDepth、callGraph、maxCallGraphEntries，view 缺省由后端决定（default）；冷图只提供语法大纲并注明缓存状态，跨文件引用保留自己的路径。依赖执行环境安装 pi-lens-mcp，需 read、exec；仅选中插件时提供工具，输出走运行时截断与缓存。

`code-intel_read_symbol` 在当前执行环境调用 pi-lens 4.4.6 MCP，接受 path、symbol 及可选 kind，旧参数 file 保留为 path 的别名；symbol 可为 module_report 的 callback handle。返回后端提供的源码和行范围；重名或失效时返回后端的候选或错误，不静默选择。需要 read、exec，仅选中插件时提供，长输出沿用运行时截断与缓存。pi-lens 的 read-guard 不构成 Yonder 的编辑前置条件。

`code-intel_ast_grep_outline` 在当前执行环境调用 ast-grep 0.51.0 的 outline，接收文件或目录、语言和 items/view/type/match/pubMembers/globs，返回语法条目、嵌套成员与读取位置；不依赖 LSP 或索引。仅选中插件时按需提供，需要 read 和 exec 能力；长输出沿用运行时截断与缓存。

`code-intel_ast_grep_replace` 通过 pi-lens MCP 在临时副本预览结构替换，最小版本只接受一个工作区内常规文件。可选结构过滤 insideKind、hasKind、hasDescendantKind（与 hasKind 互斥）、follows、precedes 合成 ast-grep 规则；先预览再应用，过滤条件属于预览快照的一部分；应用前检查文件内容未变，并通过运行时写入保护检查。它需要 read、write、exec；应用检查和写入不构成跨进程原子操作。

code-intel 工具结果统一限制在 40 KiB 内，超出时保留首尾并插入截断标记；结果末尾附 `usage tokens=<n> elapsed-ms=<n> bytes=<n> truncated=<true|false>`（tokens 为 bytes/4 向上取整），后端已带同格式页脚且未超限时不重复追加。

`codex-companion_review` 是可选原生 Codex 审查工具，需 read、exec 和显式授权的 Codex home，在当前执行环境只读审查工作树或 base 分支；`scope` 支持 auto、working-tree、branch。`adversarial` 与 `focus` 用于挑战审查。选中工具时提供 `/codex:review` 和 `/codex:adversarial-review` 模板。

`codex-companion_task` 接受授权的 `codexHome`、`task`、可选 `write`、外部线程 ID `resume`、`model` 和 `effort`。写入默认关闭，须插件配置 `writeEnabled: true` 且调用方具备 write 能力。写入由 Codex workspace-write 沙箱约束，不经过 Yonder 文件工具的受保护路径策略；未指定模型和思考档位时沿用 Codex 默认值。`codex-companion_candidates` 列出当前 Yonder 会话最近的外部线程，`/codex:rescue` 可选择续接或新建。输出使用现有工具缓存。

上述工具可用 `executionMode` 选择 `wait` 或 `background`；后台复用共享后台任务和完成通知。未指定时沿用现有自动转后台行为。

### advisor（可选）

`advisor_ask_advisor`（对应 pi 的 `ask_advisor`，按 20 的工具名前缀 `<pluginId>_` 命名）接收 `draft`、`followUp` 和 `question`（均可省略，空对象即上下文评审），通过 SDK 委派入口执行一次显式咨询，成功返回咨询文本和 adviceId；咨询所用 preset 由插件配置 `preset` 指定，默认 `default`。`followUp` 只接受本会话尚未记录的 adviceId 且必须带非空 `question`，不得与 `draft` 同用；缓存 payload 复用尚未实现。旧名 `advisor_consult` 保留 `preset` 和 `task` 契约作为别名。长输出使用现有工具输出缓存。`advisor_record_advisor_outcome` 接收 adviceId、adoption（followed、not-followed、unknown）和 validationStatus（passed、failed、not-run、unknown），返回 recorded 及原因。仅选中插件的会话可调用；`outcomeLogging` 默认 false，关闭时不写记录。开启后只接受当前会话、当前进程签发且尚未记录的 ID；并发记录先预留，成功后提交，写失败释放并允许重试。重启后旧 ID 失效。插件私有状态仅保存加盐 advice HMAC、时间、采纳及验证状态，记录带版本号 `v: 1`，不保存咨询全文或转录。

官方只读群配置显式使用已有内核 `peer-workspace` context（仅本Agent的SOUL.md与AGENTS.md），并显式重置plugins/skills，避免继承私人记忆或插件；已有自定义contexts保留。QQ精确旧官方配置升级补此context，card仅新建官方profile时设置；自定义配置不覆盖。

### 群聊独立参与与共享协调（2026-10-30，维护者批准）

QQ 与系统内群聊（Card/Web）共用本节契约。官方 `social` 插件封装旁观、点名回复、自然参与与发言协调，复用现有 channels、triggers、contexts、tools、hooks 和 presets，不新增插件槽、第二套会话、转录或模型队列。群可以选择多个工具/上下文等不同用途的插件；每个 Bot 在每个群只选择一个参与策略提供者，安装不等于启用，选择与准入见 04、08。

**一个入口、一个参与权威。** `channel-qq` 只负责原生消息规范化、事件与发送；同一 home 只有一个 `social` 程序实例，为多 Bot 做确定性组批、触发与瞬时发言协调。这个实例不是驻场大模型、不是总路由，不替其他 Bot 判断、生成或分配答案，也不持有其他 Bot 的会话、权限或游标。原始事件与每个 Bot 的绑定、会话、权限、游标保持独立；协调只横向管理公开发言机会。需要“一个驻场 Bot、其他被动”时用现有策略组合表达：驻场 Bot 启用自主候选，其他 Bot 只靠 @/名字/引用/关注；每个 Bot 仍按自己的规则唤醒，不需要等驻场 Bot 分配。

**接收与自主发言的功能语义。** 已入账只证明程序保存了消息，不等于Agent实际看过。主人要求普通群消息进入Agent并由模型决定是否回复时，需在已授权范围内配置真实参与路径（包含已选插件、目标scope与可用consumer/所需batch.run），不能以wake:write和发送权限代替。模型处理后仍可沉默，默认未授权的自主批次不因此自动启用。明确配置batch.run=true时，普通输入的模型处理与公开发言机会分开：通过既有准入、暂停、quiet、显式过滤和批次限制的来源进入自身原生批次，即使消息明确发给其他人或兄弟 Bot 已回答，也不能因此在模型前推进为已消费。指向别人只约束接单和发言，不授予或移交权限；模型结合最新公开回复决定沉默。未显式启用batch.run的旧参与机会过滤与旁观游标语义保留。

配置入口复用social.update与agents.show/validate/update，不新增目标DSL或另一个配置事务。当本次patch明确启用普通批次处理（本次设置mode=batch或batch.run=true，合并后两者均生效）时，social.update在写入前复用候选的真实顺序匹配/operability检查完整处理依赖：精确目标授权与source、独立群profile、已选参与插件、实际scope和当前群consumer。可确定缺件时一次列出具体Agent/conv/profile/字段及既有修复入口，预览也报告相同缺件，不把policy保存或工具成功当成处理链完整。unknown与确定缺失分开；不得据unknown要求用户重配平台权限。补scope、profile插件或bindings由模型依据原主人目标，通过已有完整Agent候选事务明确执行；social.update不暗改共享profile或扩大权限。新处理输入、主动发送与配置接纳继续分别核验。

**硬规则触发与自主复盘。** 官方策略不按消息或批次调用判断模型。**硬触发**是确定的程序事实：可信原生 @、可核验的回复/引用、配置的名字元素与 keywords、成功回复后的 300 秒关注。被 @ 是必看而非必发——模型看到后仍可沉默，不因漏答惩罚。明确只指向另一个已知 Bot 的点名不构成本 Bot 的候选，多位点名各保留机会。**自主候选**沿用每 Bot/真实群的 keywords、可选 triggers（regex、字面 exclude、minLength/maxLength）、batch.count、quiet、minIntervalSeconds、冷却和低频复盘，命中才唤醒正常群会话并注入近期公开上下文。count 只是兜底，先按触发原因计量再调参数；不为每个自主候选新增逐消息判断模型。规则不改变准入、绑定、权限、群主策略或主人设置。正则使用标准 JS Unicode 语法，最多16项、每项256字符，匹配文本最多2048字符；固定 vm.Script 仅以pattern/text数据运行正则，每条10ms预算，语法非法或复盘回放超时整次拒绝、旧版不变。运行超时只跳过该条并记录异常，不执行模型提供的代码。groupJudge.initialRules[agent] 是可自治调整的初始规则；仅既有主人显式设置的基础排除词、长度范围、最小计数以及权限/范围/quiet等硬边界不被自调规则放宽。

每 Bot/群默认至多每 24 小时复盘一次，累计至少 20 条未复盘公开入站才有材料；复用 social trigger 的小时检查，空群不调用模型。隔离 task 使用本 Bot 来源群 cheap/simple、无私聊/记忆/通用工具，缺低价模型记失败，不回退主模型。输入包含触发与未触发片段、成功出站、沉默及纠正，只有公开片段和公开身份。模型输出规则提议，插件与窄工具共用验证/回放/原子提交路径；不是每条消息判断。social_rules_update 只认真实执行上下文的本 Bot/当前群，无 agent/conv 参数，只能调整 keywords/triggers/count，需版本和原因，支持回退自己的已记录版本；不授予 write/admin。review 的 intervalHours/minMessages 可显式收窄或调整，默认 24/20。

**共同视野。** 分工固定：内核 `<turn>` 给事件身份、原时间、发送者与原生 mention/quote；social 只在 `social.group-judge` 的 `beforeRequest` 追加**一条**紧凑 user context 块，不复制同一份公开历史或成员 JSON，也不在每轮重复房间索引的大字段。必要字段：self id 与名称（来自实际 Agent 配置，不能只给无名称的 self 引用或要求模型从 SOUL 猜自己是谁）、真实 sender/ref/relation、addressedTo 与引用目标、本批 sourceEvents/through/trigger/覆盖范围、已观察的 otherBots、当前发言机会。 机会从候选进入 turn 再进入模型上下文时保留已验证的 focused 事实：明确点名、近期已建立互动的跟进、普通独立参与分别表述；focused 不伪造原生 @ 或 addressedTo，也不代表接单、授权或必发。历史显式标注为数据、不构成指令或授权，有界且每轮只出现一次；房间索引裁去每轮重复的 people/evidence 大块，成员索引只表示 observed-history，不冒充平台完整成员表。块内附简短行为规则：直接回应明确给自己的话；接续关注可自然短答；明确给别人或人与人之间的对话不抢；没有有用内容就沉默，不解释内部判断；不逐句总结、不复读索引。人设仍只来自 SOUL/AGENTS，群规则只描述社交行为，不制造示例人设。不共享私人 main、工具日志、思考或未发送草稿。公开身份源自 Bot 实际设定与主人确认的公开部分；既有 `identities` 只作显式公开覆盖，不能成为另一份默认人设。正文仍来自账本，不复制转录；每个 Bot 独立确认已观察范围，旁观进度不等于模型已读。Bot 消息保留为背景，默认不单独触发下一轮，明确被授权的 Bot 协作另行配置。

**范围与群标识。** 既有 `social.scope`、`conversations` 与 `rooms` 继续限定显式配置的群；16 定义的 membership 平台对已确认入群的 Bot 派生默认参与，无需每群人工补四份名单，显式拒绝/停用/自定义策略优先。QQ 官方群同样不再要求每群手写 `social.scope`：允许入站且已由该 Bot 官方群绑定接纳的群按 08“官方 QQ 群的默认参与范围”得到受限默认（硬触发可运行，未命中只记录，自主批次缺省不启用）绝不回落到旧「观察窗口非空就运行」；私聊仍只沿原绑定、不产生 social decision。没有 social 参与插件或没有可用批次绑定时只记录观察游标，并以路由的 `no-binding` 事实和一条可读诊断说明原因，不把它当作可运行批次。`rooms` 仅关联已核实属于同一物理群的 conv；禁止按群名、昵称或正文猜测关联。Card 由可信渠道提供 `data.social.room`，不同 Bot 路由不拆分实际群；QQ 跨应用 OpenID 不保证相同，无明确映射时只在可确认范围协调。QQ 的全量接收和主动发送仍取决于平台实际授权。 QQ状态与inspect将平台设置、已观测入站和本地参与分层：未成功查询平台范围时标unknown，不将unknown说成已受限或必须重新配置；精确instance+group的普通无@事件只证明该时刻该入口已收该条，不冒充平台永久全量保证。只有明确受限的官方状态或相关平台错误才要求修改外部设置；平台只对白名单开放的能力不当作所有 Bot 可用。本地 allowedGroups、批次参与与权限约束保持原样。

**省 token 与节奏。** 收消息、合并与硬规则执行均不调用模型。明确点名沿自身绑定立即调度，仍检查暂停和限流，person 关联不等于点名。直接通道（明确点名与点名后的连续追问）使用约 1–1.5 秒的短合并，把同一段连续 @/追问收进一次运行，不做长 digest。自主候选保留首条起固定 3 秒观察窗口，后续消息更新快照不重置窗口；规则命中后等待 5–15 秒静默，连续消息自首条起最长等待 120 秒，之后必须运行或记录沉默，不无限推迟。静默取值在同一批的各候选之间一致，不按候选或时间戳抽随机数；候选顺序按 Bot 现有 `lastSent` 与该批首个事件 id 确定性排序。最终阈值以规范为准并用假时钟锁定，不靠实际观察反复改。未命中仅记录程序旁观游标，不宣称模型已读。无消息不轮询模型，Bot 提问后结束本轮等待后续输入。合批键仍是 `(agent, conv)`，房间只协调机会、不跨 Bot 合并会话；游标、sourceEvents、through、policyRevision、暂停与配额都确定性记录。

**五分钟关注与任务归属。** 成功对外回复后，同一 Bot/真实群对本次回复的可核验参与者保持 300 秒关注；来源以实际 respondTo/replyTo 或运行来源消息确定，不从模型自述猜测。新的成功回复刷新期限，旁观入站、失败发送、工具内部结果不刷新；重启仅从成功出站及其真实来源恢复尚未过期的关注。关注期间该参与者的后续普通文字可绕过关键词/累计条数及普通新话题冷却，仍合批、等待静默、遵守暂停、准入和发言协调；无人说话不调用模型，到期自动退回普通规则，不建定时模型运行。

关注不是接单。可信 @、引用和明确指向另一已知 Bot 的称呼优先于关键词和关注；明确发给其他 Bot 的输入不能成为本 Bot 接单/转交依据。未知或歧义的“你/干活”仍由正常群会话结合上下文判断对象，不能靠无限扩展任务正则猜授权。群提示词必须区分接话、意见与交办：主人明确给本 Bot 的任务且在既有授权内直接办理/交接，不重复确认；指定别人的任务不认领、不转派、不承诺；对象不清且影响执行时只澄清缺失部分。关注不扩大任何执行权限，QQ 与 Card/Web 使用同一流程。

**发言协调。** 各 Bot 的规则先产生自己的参与机会，协调只管理机会与顺序：明确点名优先，其次正在被追问者，普通开放话题默认先放行一位；没有永久主导 Bot，也不设替其他 Bot 分配机会的协调者角色——协调器只按上一段的排序放行下一个已就绪机会。未显式启用batch.run的其他普通候选看到成功回答后结束该批机会；明确batch.run=true的候选保留模型处理，仍按原有房间串行顺序运行，不强制公开发言。已由本 Bot 成功回复建立关注的候选保留其 focused 事实，不属于普通开放候选。上述保留的候选均不能因兄弟 Bot 发言而清除尚未处理的来源或推进为本 Bot 已消费。关注仍不等于接单或新增权限，明确发给其他 Bot 的输入仍按原对象规则排除；获准运行和公开发送继续分别核验。后续新输入重新匹配，避免同一普通话题全部依次抢答。明确点名多位保留各自机会。明确要求多位时可依次参与，获准机会不强制 Bot 发言。同节点复用 social 的群状态与发送钩子；内部群跨节点的原子发言占位是后续能力，尚未实现不得宣称全局互斥。QQ 无法控制的外部 Bot 只能观察并让话。

**新消息、停止与恢复。** 新消息要求复核，不自动废弃所有旧答案或中止全部运行。命中本 Bot 规则的相关补充沿原生 `busy: steer` 把真实新增消息与其来源一起并入当前运行，不发送没有来源的「请复核」提醒；工具运行中等待边界，生成中可重答，不重放已执行工具。普通新消息不自动取消运行；只有显式停止或有效群控制走 abort，已发送与已发生的工具副作用不回滚。发送前用 `beforeSend` 再核权限、当前暂停状态、发言机会和最新公开事实，目标已被可靠回应或机会失效时丢弃未发草稿并记录原因，不重放工具、不自动换目标重发。拒绝区分暂停、当前会话无发言机会及目标已可靠回应；仅无发言机会且原任务交付仍未完成时，错误须说明可按实际可用parent_ask把已核验原请求和原群交付交给同Agent main继续，仍由内核校验来源、目标及既有权限，缺工具/绑定/权限明确未完成；不能只要求等待下一次群输入而取消已授权任务。暂停和已可靠回应不提供绕过路径，不新增lease或队列，不凭owner身份、respondTo或模型自述取得群发言机会。普通成员要求“不用回答我”应退出该段互动；持久群级暂停/恢复按该群管理与 Bot 主人授权处理，不把任意群消息升级为管理权限。暂停事实持久记录来源、对象、范围与恢复条件，不依赖最近消息是否仍含原文。判断和协调结果只收窄参与，不授予权限。

**兼容与证据。** 继续复用每 Bot 的 persistent/per:conv、批次准入、reply:none、显式发送、原生 steer/abort 与事件恢复。旧 `channel-qq.group-batch` 事件类型与字段按 20 §3 弃用（至少保留 0.3、0.4，最早 0.5 移除，使用时有运行时 warn 与 CHANGELOG 条目），迁移由 `yonder-qq upgrade-groups` 完成，自定义绑定不覆盖；迁移前旧链保持原语义。沉默提交实际已观察游标；失败不伪装已读，已接纳运行沿原生恢复，发送结果未知不自动重发。既有 `groupJudge` 配置作为官方插件受管群/公开身份/低频复盘预设的兼容入口保留；旧 judge 历史可读但该受管路径不再发起逐轮判断，不静默扩大作用域或覆盖自定义策略。证据按 `routing.social-decision`、`social.rule-match`、`social.group-turn`、`social.batch-read`、`run.end` 的 usage 与 `message.out` 记录；按 `(agent, conv, trigger)` 汇总运行数、实际发言、沉默、tokens、首响延迟与重启重复，不记录重复正文，不拿总消息数或总运行数当触发率。

**参与判定的归属（2026-10-31）。** 点名、关键词、授权名单、quiet、模式这类参与策略由所选参与策略插件通过 04 §3.6 的 `participation` 提供，内核不再内置策略计算；内核保留平台事实、绑定安全、批次复核、额度与发送前强制，并在策略插件不可用时失败关闭。官方 `social` 是默认实现。

首轮交付 QQ 与 Card/Web 的同节点完整闭环及第三方替换所需的最小作用域/准入契约。通用群插件安装界面、插件市场与系统内跨节点发言占位后续单独实施；本契约不代表这些能力已运行。验收覆盖兄弟 Bot 互见且不重复插话、单独/多人点名、人与人对话让话、停止拦截未发回答、相关补充不无故取消、独立规则与复盘频率、群外不受影响、沉默游标、无新消息零调用和重启不重复发送。真实模型按 Bot 分开记录复盘与正式生成的调用、tokens、耗时及未测项。
