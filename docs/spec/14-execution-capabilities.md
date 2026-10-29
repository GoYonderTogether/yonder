# 14 执行能力

本规范覆盖旧条款相冲突部分；不包含记忆引擎、沙箱或人格预设（用户记忆库见 [15](15-memory.md)）。

## 1 内核异步执行与时间感知

工具运行超过15秒自动返回真实后台句柄，不取消原任务、不阻塞后续模型工作。后台句柄按调用session隔离；提供状态、增量日志、等待、输入和取消能力。完成与失败保留真实结果并以原生输入通知原session；仍在运行时在工具间隙steer，闲置时显式继续原任务，不伪装成用户发言。后台完成事件runtime.tool-result以(session, job)去重；msgId仅保留原渠道消息的来源引用，同一来源下不同job必须各自记录并进入模型上下文，重复同一job不得再执行。完成消息是原任务的内核续办，不是新增外部Agent请求；保留原输入来源/路由与固定requestId，避免重复执行。仅程序展示通知另走sessions.notify，不冒充模型已处理。结束结果落盘，内存不无限保存日志/已结束句柄；process的增量日志next为累计字符游标，offset是实际返回起点，truncated表示请求游标已超出保留窗口；省略offset返回当前保留尾部。取消仍保留已输出尾部并通知确定性等待者，不给模型提交取消续办；清理内存不删除会话、用户文件或持久结果。重启不能恢复的外部调用明确标记中断，不自动重放有副作用操作。主动 abort/close 取消所拥有的后台工作，不能遗留无主进程；服务关闭清理外部进程，内部委派按 10 §1.2 接回原等待。后台结果接纳失败持续补交，确认前不将临时父会话关闭。

task_continue({text}) 表示已有授权目标的一项具体后续步骤，使用稳定原生调用身份在同会话 followup 入队；接纳后可结束阶段汇报，后续无需用户追问。本会话仍有其他后台工作或未交接结果时拒绝 task_continue，沿现有自动结果续办；不重复安排等待。不得拿它循环询问模型是否完成、轮询后台句柄或制造新授权。task_run/agent_ask 重启按原调用关联继续等待，不把内部等待当作未知外部副作用。

bash增加background/yield、进程日志/输入/结束管理，保持命令、cwd、退出码和stderr语义。普通命令默认不保留可写stdin，避免非交互搜索等输入；需要进程输入时显式设置bash的stdin=true，使用process.write写入，可附eof=true结束输入（可不附text）。background只决定何时让出，不改变stdin语义。可交互进程使用原生管道；未提供PTY不得标称PTY。通用工具均走共享异步边界，不能只修bash而阻塞task_run或插件工具。权限校验和hook仍在原调用链，不增加另一层授权。

模型侧另有 pi 同名的四个后台工具，bash 与 process 仍为内核能力：`bg_run({command, name?, notify?})` 立即以 bash 原生后台任务启动并返回句柄，`name` 为展示名（缺省取命令前几词），`notify:false` 不投递完成通知；`bg_status({taskId?})` 省略时列出本会话已转后台的任务，`bg_logs({taskId, maxBytes?, tail?})` 从完整日志文件按字节读取，`maxBytes` 默认且上限 50KB，`tail` 默认 true，截断时给出完整日志路径；`bg_kill({taskId})` 停止运行中的任务，已结束或未知则报错，停止后状态为 killed。taskId 接受完整 id 或无歧义前缀，只解析本会话句柄。完成通知按 pi `<background-task-notification>` 结构（task-id/task-name/status/exit-code/error/output-file/summary/guidance）只带终态元数据；有日志文件的任务不内联输出，无日志文件的结果（如 task_run）在 `<result>` 中保留结果尾部。

CLI、console 和渠道的 `/bg` 列出当前会话的后台任务，`/bg logs <id>` 查看保留日志，`/bg kill <id>` 停止任务；不得访问其他会话的句柄。console 通过 session-scoped views 在 rail 和 floating 位置展示后台状态，状态变化时刷新。重启后按持久记录展示真实状态，不声称已中断的外部任务仍在运行。

原limits.maxMinutes/maxTurns改为软提醒阈值，可增加maxTokens提醒；超阈值记录运行事实，提醒本session，子任务同时告知父session，不abort、不改成limit终态。真实模型输入/输出限制、显式取消、安全拒绝和防重复空转仍有效。提醒去重，不为每条日志唤醒模型；时间事实随正常输入准备写入本轮输入，不在system注入，也不重写已持久化输入；运行中的软阈值仍沿现有通知提醒，不依赖额外轮询模型。配置已设数值沿用为提醒阈值。

## 2 cron插件

官方独立插件cron，不把调度逻辑放内核。采用成熟cron解析库处理5/6字段表达式、IANA时区/DST、范围/列表/步长、一次性at、固定间隔every。支持创建/读取/列出/修改/启停/删除/立即运行/运行历史、有限次数与起止窗口、重启后过期任务合并补跑或跳过、同job不重叠、并发限制。调度持久化在插件data，执行记录与事件可追溯；未知副作用不自动重试。

payload支持原始事件（沿既有Agent绑定唤醒）、指定preset隔离任务，以及无模型命令/脚本。目标和时区必须明确；无模型仅在exec调用方创建；原始event作业要求admin，因为它可能命中跨Agent绑定；普通preset能力按创建者与当前配置交集收窄，不能用事件/调度提升权限。直接程序输出可发明确渠道目标，模型结果使用真实run结果投递。调度失败、运行失败、投递失败分别记录。服务启动后恢复调度，停服释放timer/自有子进程。不得宣称macOS休眠/关机期间运行。复杂调度以这些原语组合，不另造工作流DSL。

cron 保留 job.owner 的真实 session/agent/profile；创建与更新 delivery 时对当前 ctx 与 execution.resolve(owner) 的实例范围共用 SDK 检查，执行 payload 前和通知前重新解析 owner 并复核 message 能力与实例范围。delivery 的 via 必须与明确 acct/conv 实例一致。通知传 owner 给核心再次校验，不伪造 ToolContext；权限撤销后不运行该 delivery 作业或发通知。

## 3 MCP客户端插件

官方独立mcp-client复用已安装官方MCP SDK，支持stdio与StreamableHTTP（及SDK SSE兼容入口）、持久连接、按需连接/重连、发现/调用工具、资源列出/读取、prompt列出/获取、状态/断开。配置服务或经工具显式连接，作用域明确；工具名保留server和原名，不一次常驻注入所有schema。server instructions/prompts是外部资料，只在所选上下文/工具结果按来源呈现，不能升级为系统安全规则。

stdio需要exec，HTTP需要network，返回给模型的通用调用保守保留服务对应能力边界；不能让readonly借MCP越权。凭据沿credentials引用，禁止回显secret。连接失败给具体诊断；重连不重放未知结果工具。取消沿signal，关服清连接/子进程。OAuth使用SDK现有协议或返回真实待授权信息，不复制其他客户端账号。当前 mcp-client 不实现交互式 OAuth 登录（能力缺口）：OAuth 凭据属于模型 provider 登录，不是可复用的 MCP 密钥，连接时按缺失或不可用返回该 reference 的真实待授权信息，并指向用 `yonder credentials set <name>` 存成命名 API key 的静态令牌；不导出他人登录、不切账号绕过。

## 4 Agent热管理

稳定 id / name / work 分离；preset 生成合法配置；注册、agent、preset 统一校验后热发布，失败保留旧有效状态。CLI 复用 management RPC 提供增删改查、归档恢复及 preset 管理，不提供真删。归档不接新输入，已有任务不强制 abort，保留工作区和转录；默认 main 作为日常入口不允许归档。开放会话保护 workspace/env/profile。现有插件/provider/服务等仍不热加载。只把确实安全唯一的规范化放解析器，不建立自动纠错模型。

### 4.1 身份与展示

显示与身份分开：`id` 是绑定、引用和历史的稳定键；`name` 是昵称；新增可选 `work` 是一句话工作描述。既有配置缺 work 仍可读，新创建请求必须给出。修改昵称和工作不修改 id、会话归属、目录、渠道账号、工具权限或 SYSTEM。列表、TUI 发言人/底栏/会话选择和渠道 `/session` 优先显示昵称与工作，按需显示内部 ID；不把机器用的 JSON 标识替换成昵称。

“其他对话有名称”先通过所属 Agent 昵称和现有首条消息摘要表达；一个 Agent 可以有多段会话，不能把每段会话当成另一个 Agent。不新增独立的会话命名数据库；如需要手动为每段历史起标题，应单独说明并设计元数据位置。

### 4.2 管理对象

常驻 Agent：列出、查看、从 preset 创建、修改、归档、恢复。CLI 的删除操作等价归档，不提供 purge/force-delete；程序不递归删工作区、附件、事件或会话。人工真删在服务外明确处理，不开发真删入口。归档对象保留原 id，不能被新 Agent 占用。

Preset：沿用现有配置格式和热加载；补齐管理面中的列出、查看、创建、修改、校验，仍落到 home/presets，不增加角色模板仓库。删除被开放会话引用的 preset 继续拒绝，不自动替换配置档。

CLI 复用现有 management RPC；有 exec 且获授权的 Agent 使用同一 CLI，不新增一套模型专用配置生成规则。当前 standard 含本机 exec，不宣称命令入口是沙箱。若未来需要给无 exec 的 Agent 开管理工具，再按真实调用方和能力设计，不提前扩 SDK。

### 4.3 从模板生成

1. 输入现有 preset ID、稳定 Agent ID、昵称、工作、已有 owner 和所需绑定；可以显式覆盖既有 Profile 字段。
2. 程序复用 preset 的 Profile 解析和默认值，生成完整合法的 agent.yaml；description 不冒充 Agent 身份。未指定的权限使用现行只读默认，不复制主 Agent 的 bypass。模板不会自动装插件或改其他 Agent。
3. 绑定需要明确来源、目标会话及配置档，不为了能聊天自动开放所有渠道/陌生人。没有绑定时报告“无消息入口”，不声称已能接收任务。
4. SYSTEM 沿用现有标题/身份/职责/边界空段模板，不增加人格或灵魂文本；work 用于展示，不伪装成工具权限或新的系统指令。
5. 校验整个候选，包括已有开放会话引用；按既有 ExecutionEnv 完成新目录、SYSTEM 及选中上下文文件的创建，然后登记并发布。不覆盖既有目录或用户文件；失败保留诊断，不把半成品注册为可用 Agent。
6. 返回稳定 ID、真实 workspace、有效 name/work、校验结果及是否已被运行服务接纳。磁盘写入、结构通过、加载成功和实际模型执行是四件不同的事。

### 4.4 注册热加载

保留 yonder.yaml.agents 为唯一注册来源，增加归档时间字段；不通过遍历任意目录自动认领 Agent。不新增数据库或与 YAML 并存的注册表。

watcher 读取注册候选，加载对应 agent.yaml，与 preset 一起走共享校验后，原位更新供路由、会话、技能和工作区读取的有效配置及 Map。管理命令完成写入后等待这次校验/发布结果；自动 watcher 也走相同入口，不用固定 sleep 当作成功。

只有 agents 登记及 agent/preset 配置热更新；yonder.yaml 的插件、渠道实例、provider、services 等其他部分仍需重启。一次修改两类字段时明确告知哪部分已生效、哪部分待重启，不能将未加载的新插件当作有效引用。配置文件无效时保留整份有效旧状态并报告文件、字段和原因。

新 Agent 使用已有执行环境；不增加远程部署/供应机器能力。新建对象先完成生成和验证，再让路由可见。修改 workspace/env 涉及已有文件及执行位置：有开放会话时拒绝此两项修改，不能靠热加载把历史和排队任务搬到另一个目录；先明确处理会话后再改，不做后台数据迁移。

### 4.5 归档与正在执行的任务

归档保留注册项和文件，设置归档时间；活动列表、渠道目标与新输入路由不再选择它。历史仍可查询，内部 ID 不回收。恢复先重新校验，再清除归档标记。

存在原生运行、未终结已接纳输入时拒绝归档，返回原会话定位；等待结束或由调用方明确中止后再归档，不悄悄取消或丢掉已接纳工作。只有空闲的开放主会话不阻止归档。归档态的历史读取与活跃执行分开；既有模型、插件的历史引用不使归档对象重新运行。恢复时按当前已安装能力校验，失败继续归档。

活动运行继续使用原快照；新一轮使用已接纳配置。不做运行中改权限、替换 profile 或迁移 conversation。所有取消、排队、转录继续归 pi，不建第二套任务状态。

### 4.6 自动检查与“纠错”

自动检查贯穿生成前、保存前、发布前和 doctor：结构、ID/owner/defaultProfile、绑定和会话档一致性、模型/插件/上下文/环境引用、目录冲突、现有会话引用。复用相同规则与错误格式；模型目录命中不等于凭据或真实推理有效。

程序可自动补齐规范已有默认值、固定 schema 和 SYSTEM/上下文模板；这些是确定的生成行为。拼错模型、未知插件、owner 不存在、能力冲突、缺少必要值等返回字段级错误，保留旧有效状态；由 Agent 根据具体错误修改请求再提交。

不加后台纠错 Agent、不循环尝试模型/供应商、不自动提权/改 owner/扩大绑定，不把错误输入悄悄改成另一个有效意思。校验可以拦截配置问题，不能保证模型和外部 API 永无 bug；实际执行失败保留事实。

## 5 浏览器和桌面替代插件

保留BrowserSkill与Codex桥接。另提供独立browser/desktop工具，不要求这两项安装；优先直接采用Hermes/OpenClaw可复用原生方案和许可。自动探测本机原生浏览器/OS能力，能自动启动即启动。浏览器需要的浏览器引擎/驱动应随依赖或由显式安装流程准备，不宣称无任何依赖；macOS桌面仍须系统屏幕录制/辅助功能授权，不能绕过。无宿主凭据可完成本地网页操作/截图/键鼠即为替代闭环。原始实现和版权注明来源，不引入另一Agent运行核心。

### 5.1 macOS 权限 helper（D55）

维护者在 Track C phase 2 批准可观测事实 + 请求历史：`unknown | not-granted | requested | granted | needs-restart | revoked-detected | unobservable`。boolean false 不区分未请求与拒绝；`requested` 仅表示 helper 曾发请求，带 lastRequestedAt，不代表 pending/denied。FDA、Files & Folders 不作全局猜测，返回 unobservable 与人工下一步。Automation 限定 System Events target，未运行/探测失败为 unknown。needs-restart 用于同路径代码身份变化且旧身份曾 granted，或 Screen Recording 当前进程 false 而同签名新进程 true 的情况，明确表示旧授权可能失效，不能承诺重启修复。

单一 `Yonder Helper.app`（dev.yonder.harness.helper）在稳定目录 `~/.local/share/yonder/helper/`；状态文件在 bundle 外，更新只在 cdhash 变化时替换 bundle。Apple Development/Developer ID 签名优先；无证书时 ad-hoc，并报告 hash 变化与重新授权风险。通过 LaunchServices 后台独立启动，stdin/stdout JSON、无网络。截图、鼠标、Unicode 输入、物理按键与窗口 AX 快照均在 helper 自身执行。 本 app 需要 TCC 资源的实际操作须走同一稳定签名原生权限宿主，不能只统一申请 UI；当前覆盖截图、输入与文件访问，不代表全部功能已迁移。外部 Node/Python 不自动继承其授权，文件与权限种类仍由 OS 分别授权。

owner 已授权任务可用 native-automation_desktop 的 file-list / file-export（path 为绝对路径），复用上述可信 owner/续办来源及现有能力与取消。实际读文件在同一 Helper，不自动申请权限，不把 requested 当授权。file-list 只列一层 name/type/size/creationDate/modificationDate，符号链接标识且不跟随；file-export 只复制单个普通文件，拒绝目录与源符号链接，保留字节、大小、源 metadata，不修改原件。导出目标只能由插件生成唯一私有 artifacts 路径，不接受模型目的地或覆盖，返回真实 path 与 file attachment，不内嵌大文件。非法/相对路径、取消及 OS 错误（含 EPERM）须明确返回。

AI 的 native-automation_desktop `permissions` / `status` 只执行非提示式探针，返回 kind/state/lastCheckedAt/lastRequestedAt/responsibleIdentity/nextStep/raw；不得弹窗、开 Settings 或授予权限。负责身份字段指实际执行代码的 bundle/path/cdhash，不将 PPID 当成系统 TCC 审计证明。人用 `yonder-permissions request|guide|watch <kind>`；owner 来源也可在现有工具能力范围内，通过 native-automation_desktop 显式发起单项 `request|guide|watch <kind>`，非 owner 来源不得发起。实际运行的所有输入都须为直接 owner 账号输入，或由内核生成的 runtime.tool-result/runtime.continuation 沿真实 parent 回溯至该输入。回溯仅用持久事件的精确 ID 查询，逐跳核验 ID、同 conv、当前 agent/session 路由和内部事件 data.session；拒绝外部 from、内部 agent 账号、跨会话、缺失、循环、取消或超过 64 跳，不使用 data.sources、正文或模型参数证明身份。直接 owner 仍经 identity.relation 核验，身份查询失败即拒绝。只有 request/guide 记录发起历史并交互，watch 只观察；系统权限批准仍由真人完成（2026-10-24 主人明确授权的设计修正）。guide 固定 PermissionFlow SHA 并保留小型 API 补丁，关闭自动 AX 提示；按实际 Settings 窗口/列表下沿定位，不覆盖列表开关。guide/watch 共享约每秒只读轮询，默认 600 秒（可用 --timeout <seconds> 缩短），granted 持久保存 grantedAt，guide 显示一秒确认再关闭，成功退出 0。关闭/超时退出 1，返回包含最后观测与请求时间的 JSON；已有请求历史时超时/关闭记录 requested（撤销事实仍为 revoked-detected；从未请求或 unobservable 的种类保留真实状态）。运行中屏幕授权缓存以同签名新进程非提示式探针比较；仅证据不一致时提示单按钮重启 Helper，watch 自动重启并重新验证。AI 不点击 Allow、不访问 TCC.db、不调用 tccutil。真实授权、撤销、UI 跟随与更新保留须主人完成后验收。

## 6 手工memory目录

这是 agent 自己的手记，不是用户记忆库；用户记忆库由 memory 插件提供（[15](15-memory.md)），二者互不读写。

Agent workspace允许普通文件工具创建memory目录、按日期/条目保存及索引资料；初始化提供memory/README.md说明用途、来源、日期与事实/假设区分。仅按需读取，不新增上下文贡献、不自动注入、不自动总结/删除/清理。说明必须指出这只是临时记录约定，需结合真实场景参考成熟方法迭代，不能将简单目录当作长期记忆引擎。不得覆盖现有用户目录或文件。

## 5 按次 effort

`agent_ask` 与 `task_run` 可选 `effort`（pi 思考等级之一：off、minimal、low、medium、high、xhigh、max）。它只作用于由这条委派启动的那一次运行，不改配置档、Agent 或会话的长期设置；下一次运行恢复配置档默认。

- **权限**：设置 `effort` 需要 `admin` 能力（05 §1）；没有则工具返回错误，不创建委派，也不当作“无效等级”回退。agent 名称或配置档名称不赋予任何权限。
- **来源**：只有内核写入的委派携带 `effort` 才生效——内部 agent 渠道的 `message.in`（`from=acct:agent:*`、`conv=conv:agent:*`）和 `task_run` 创建的任务输入。渠道与插件写入的事件即使带该字段也被忽略。
- **解析**：按目标配置档实际模型的支持等级。无效字符串回退到配置档默认；模型不支持的等级按 pi 的确定性规则取相邻可用等级（不是字符串距离）；模型完全没有思考等级时保持原值。
- **合并**：同一次运行接纳多条输入（steer、最终边界一并并入）时取其中最高的有效请求，因此调用方不会得到比请求更低的等级，代价是并入的无关输入可能随之使用更高等级；运行开始后并入的输入不改变当前运行。需要独占一次运行的调用应使用 `task_run`（独立子会话）。
- **记录**：解析结果随运行快照持久，崩溃恢复沿用，不重新解析。`run.end.data.thinking` 为该运行实际使用的等级；有委派请求时 `run.end.data.effort = { requested, effective, reason?, inputs }`，`reason` 取 `invalid-level`、`unsupported-level`、`unsupported-default`、`model-without-effort`。
- **不做**：用户在聊天里直接指定等级的语法（自然语言不是授权来源）；按任务难度或成本自动选择等级与模型（可作为独立插件，见 D52）。


## 共享权限工具

核心 `permissions` 工具支持 `action=list`，或指定 `provider`、`kind` 的 `status/request/guide/watch`，可选 `timeout`（秒）。
进入统一 registry，不因内置工具身份绕过 profile 插件选择；provider 仍检查既有能力、实际执行环境与可信 owner 来源。
工具由标准 catalog/spec 路径发现。查询不会申请，取消传到 provider 与原生驱动。

`native-automation` 注册同名 provider，scope 为 macOS Yonder Helper（不代表 Node、独立浏览器、远程环境或外部账号）。
实际支持 accessibility、screen-recording、input-monitoring、camera、microphone、notifications、automation、full-disk-access、files-and-folders 的已有状态/申请/引导/观察契约；后两项不可全局探测时维持原生 unobservable/unknown，不声称已授权。
这里的 camera/microphone 是已有授权探针，不是摄像头或麦克风采集器。返回 Helper 原始身份和状态，不回传凭据。
原 desktop 的 status/permissions/permission-request/permission-guide/permission-watch 为兼容入口，共用 provider 底层实现与校验。
request/guide/watch 保留 `requireOwnerOrigin` 与可信续办来源规则；均要求 exec/read/write/message 及 node:local。
guide/watch 支持 `0 < timeout <= 600`（默认 600 秒），status/request 不接受 timeout。
仅 macOS 有实际原生 driver；其他平台返回实际平台与 unsupported 原因，不伪造签名或 grant。SDK 门面允许其他平台注册真实 provider。

共同原生提示词要求主动查询、申请/引导、检查后继续已授权任务，不让主人重复授权或代跑命令搬文件；只把 OS 必须本人完成的密码、生物识别或批准交给真人。安装和 owner 意图不是 OS grant 的证据，既有凭据、来源与隔离边界不变。

## subagent 工具（O51 IMP-24，只增不改）

`subagent` 是内核工具，与 `task_run`、`task_control` 同条件提供，把既有委派与后台管理收成一个入口：参数 `{ action: "run"|"list"|"status"|"stop", options?: object }`，除 `action` 外的参数一律放进 `options`。

- `run` 等价 `task_run`（`options` 即其参数，支持 `effort` 等既有字段）；`status`、`stop` 需要 `options.id`（数字后台 id），分别等价 `task_control` 的 status 与 kill；`list` 只列本会话由 `task_run` 建的后台任务。
- 委派规则与 `task_run` 完全一致：预设、`credentialSlots`、附件、两层嵌套上限与 admin 校验都沿用，不新增授权路径，也不放宽任何限额。
- 工具 schema 进 `packages/core/src/tools/delegation.golden.json`；description 与 `promptGuidelines` 文案由提示词流程另写，本节不定。
