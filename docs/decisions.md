# 决策记录

**2026-10-28 O49 P156r3 项目报告（主 Agent 代批）。** 可选 code-intel 复用共享 pi-lens MCP 的项目报告及冷缓存后台构建，不建立第二套索引。

**2026-10-28 O49 P159 符号搜索（主 Agent 代批）。** 可选 code-intel 复用执行环境中的共享 pi-lens MCP 连接与上游索引，冷索引返回构建状态供重试，不另建索引。

**2026-10-28 O49 PT-P129 挑战式审查首片（主 Agent 代批）。** 在现有只读 review 工具增加可选 adversarial 与 focus，复用目标选择和执行环境；插件模板仅随所选工具发现，增加 `$RAW_ARGUMENTS` 保留参数原文。等待和后台选择沿用共享执行模式。

**2026-10-28 O49 Codex 可选插件（主 Agent 代批）。** 复用执行环境的 Codex CLI、工具输出缓存与共享后台任务；审查只读，任务写入默认关闭且需配置启用和 write 能力；写入由 Codex 沙箱约束，不经过 Yonder 文件工具的受保护路径策略。外部线程引用按 Yonder 会话保存并提供选择，不复制会话转录。等待与后台作为可选执行模式，未指定保留原自动转后台行为。

**2026-10-28 O49 PT-P151 有效语言配置（主 Agent 代批）。** 可选 code-intel 通过执行环境的 pi-lens 4.4.6 MCP 解释配置来源及选择理由，保持上游脱敏；上游返回来源和选择而非全部配置值。

**2026-10-28 O49 PT-P154 LSP 导航（主 Agent 代批）。** 可选 code-intel 复用执行环境中的 pi-lens MCP，静态要求 read、write、exec；当前连接无法保障跨文件写入及取消，相关 apply 操作明确拒绝，待共享连接和写入安全边界具备后补齐。

**2026-10-28 O49 T14r2 投递幂等键（主 Agent 代批）。** OutMessage 增加可选 deliveryId，复用持久 attempt ID，飞书按分片派生 UUID；旧插件可忽略。代价是平台去重受其有效期限制，未知结果仍不自动重发。

**2026-10-28 O49 PT-P157 包含符号（主人授权）。** 可选 code-intel 在执行环境内调用 pi-lens 4.4.6 MCP，按位置读取最小包含符号；超长默认仅返回元数据。

**2026-10-28 O49 PT-P155 模块报告（主人授权）。** 可选 code-intel 通过执行环境内 pi-lens MCP 提供文件符号报告；默认 compact，focus 仅重排，跨文件结果保留来源路径。

**2026-10-28 O49 PT-P148 语法大纲（主人授权）。** 可选 code-intel 调用执行环境的 ast-grep outline，沿用 pi-lens 的参数与读取位置；不依赖索引或 LSP。

**2026-10-28 O49 PT-P001 CodeGraph（主人授权）。** 使用可选插件调用执行环境内 CodeGraph，SDK 提供取消上下文桥接；索引由用户显式初始化或刷新，避免在未选工作区启动进程。代价是未安装或过期时需先执行命令。

**2026-10-28 O49 T16 QQ 群止血（主人授权）。** 默认仅 @Bot 或关键词触发群批次，明确授权群保留原行为，支持按群配置；其他渠道、@主人识别和轻量判断模型留待通用群策略。代价是未命中的群消息仅记录，不即时参与。

**2026-10-28 O49 PT-02 选中工具指南（主人授权）。** SDK 工具可贡献可选指南，仅随实际提供给模型的 schema 注入，按工具名排序并逐条去重；延迟发现后随下一请求更新。代价是工具集变化会更新该提示段。

**2026-10-28 O49 T07 会话分叉（主人授权）。** 先复用 pi-durable 的跨 conversation 分叉，独立 task 的父子关系以 durable 元数据为准，不复用子任务的 `parent` 字段；副作用不回滚。首步与 pi 的同会话 tree 和 user 消息 fork 交互不同，后续差异见 02。

**2026-10-28 O49 T05 工具截断原文（主人授权）。** 本地 SDK 文本和 Web 输出截断前写入会话缓存，提供 `read` / `grep` 取回，保留天数通过 `tool-output.json` 的 `keepDays` 配置。当前未覆盖 durable 原生流截断和 Web 超过 2 MiB 的原文；缓存占用磁盘，清理仅在写入时执行。见 07 §4。

**2026-10-28 模型回退按错误类别决策（O49）。** 保留已有链配置和事件的兼容语义；鉴权、模型缺失和额度耗尽立即切换并长时间 hold，429 依据可用的 reset 时间 hold，超时与 5xx 达到重试阈值才切换，内容或参数错误不切换。回退与恢复各通知一次，健康状态供 doctor 查看；具体目标见 03 §3.1，实施和验证另行记录。

**2026-10-28 O49 T03 默认插话（主人授权）。** 沿用 D49：渠道、console 与 CLI 普通输入默认 steer，同会话待处理输入按原生 all 消费，显式策略可选择 followup 或 interrupt；不同会话不合并。理由是接纳新引导并保留当前工作；代价是工具执行时不能保证立即响应，审批和后台等场景仍需实测。

**2026-10-28 tasks 入口退役。** tasks 看板经控制面视图提供，渠道保留图片和文字，移除独立 HTTP 服务及旧 desktop/web 路由；代价是旧飞书自动刷新卡片不再提供。

**2026-10-28 交互入口退役。** interaction 卡片经控制面视图展示与回答，保留插件私有状态，移除独立 HTTP 服务；代价是旧回环页面 URL 不再提供。

**D57 完整主程序的跨平台安装入口（2026-10-26）。** 在原有版本目录和 home 分离的发行链上，Linux 用 systemd 用户单元，Windows 用当前用户登录计划任务、目录 junction 和本机命名管道。Windows 不借 `sc.exe` 把普通 Node 进程冒充 SCM 服务；需要注销后常驻或异常自动重启时另做真正的 Windows 服务宿主。每个平台的运行结论必须有对应系统与架构的实测证据。

**D59 默认管家与清单式首次引导（2026-10-28，统一客户端 design §5.2/§5.3 第一片；维护者已批准（10-28 主 Agent 代批，主人授权合并））。** `init` 的 default 发行包加载 `@yonder/plugin-onboarding`，管家沿用现名 `main`（Jarvis），不写模型、用 `defaultModel`，选入 `tasks` 与 `onboarding`，并有一条 `onboarding.start` 绑定（`--isolated` 不写，因 peer 的保守检查拒绝不限渠道的绑定，由主人主动要求继续）。插件启动时在未完成、未关闭（`enabled: false` 或 `{dismissed:true}`）、默认模型有凭据（`api.host.modelReady`）且距上次满 24 小时、累计不到 5 次时写 `onboarding.start`（conv `conv:onboarding:<agent>`）唤醒管家，避免模型失败时每次启动都重试；只读工具 `onboarding_probe` 经新的内核接口 `api.host.status`（仅 admin，只给凭据槽是否已配置，不给值）列出模型、渠道（含随包未启用）、网关、凭据、插件五项；工具只服务配置的 agent；`onboarding_record` 把每项对应的任务引用（todo 或账本）、完成/关闭时间与唤醒计数存在插件数据目录 `agents/<agent>.json`，读改写串行，因此可恢复、不重复建任务；会话 todo 里已删除的任务按 `todo.updated` 事件重新列入，`{done:true}` 写 `onboarding.done` 后不再唤醒。任务列表优先用内核会话 `todo` 工具，否则用 tasks 账本。design §2 要的跨会话只读工具已由 `session_list`/`session_read`（admin，读他人另需跨 agent 权限）提供，本片不新增；spec 05 的“读取他人会话转录”独立能力级别留待后续。`api.host` 写进 04 §4。代价：新增插件接口面；账本任务是否仍存在只能由管家用 `tasks_get` 核对。

每条：决定、理由、代价。改决策先改这里。被后续决定取代的部分标“已被 Dxx 取代”。文中的 T/N/U/C/R/F/P/E/X 编号是实现批次，批次记录保存在维护者的私有归档，不影响理解各决定。

**D1 运行时用 pi-durable，模型用 pi-ai。** 会话持久化与恢复、模型循环、工具执行、压缩、子会话、按需工具、用量统计、执行环境都已由 pi 实现并在生产中使用；自己写最容易出错。代价：pi-durable 标为实验性，接口可能变——用精确版本锁定和单一适配目录（07 §1）控制影响面。

**D2 不接入完整 pi coding-agent 运行系统，直接复用其原生界面。** 模型与会话仍由 Yonder 的 pi-ai/pi-durable 适配层负责，不接入 coding-agent 的运行循环、SessionManager 或配置/会话存储。2026-10-18 用户明确要求界面与操作照搬成熟产品，不能只复用通用组件再自行设计。CLI 因此允许使用同一固定版本 pi-tui 及 coding-agent 的 UI、主题、键位导出，必要时按 MIT 许可提取 UI 模块并仅改后端接线。布局、组件和操作以 pi v1.3.0 为唯一基准；差异只在 Yonder 命令、功能、对话对象和任务归属。具体方案见 12。

**D3 删除验收与审批。** 完成由模型的最终回复（或 `NO_REPLY`）定义；安全只有能力 + 级别一层。审批将来以钩子插件实现。代价：没有"做成没做成"的自动判定，需要时由插件补。

**D4 绑定是声明式表，不是规则语言。** 只有五个匹配维度和四种会话方式。更细的划分由渠道插件体现为不同的 `kind` 或渠道实例。代价：个别复杂筛选要在渠道插件里做。

**D5 身份映射进内核，记忆不进。** 账号、人、关联是跨插件共享的事实，必须统一；记忆策略差异大，是插件。所有插件用引用标注实体，从而可以互相串起来。

**D6 上下文文件全部插件化。** 内核只规定 `agent.yaml`。`SOUL.md`、`AGENTS.md`、`USER.md`、`MEMORY.md` 是上下文插件的贡献，不选就不存在（D45 起不再有 `SYSTEM.md`）。

**D7 运行上限内置，智能防护插件化。** "运行一定会结束"是框架的承诺，不能依赖可选插件；默认值宽松，以免限制正常使用。

**D8 配置用 YAML；模型配置与 pi 的 models.json 同构；凭据与 pi 的 auth.json 同格式。** 便于直接沿用 AI-Being 的现有配置。

**D58 Harness 默认中文 locale 与北京时间（2026-10-23 用户明确要求）。** `yonder.yaml` 的全局 `locale`、`timezone` 默认分别为 `zh-CN` 与 `Asia/Shanghai`，并在解析时验证 Intl locale/IANA 时区；用户可显式覆盖。提示词日历固定按配置时区格式化，展示 UTC 与本地时间/星期，不读取宿主本地时区；PluginAPI 暴露这两项有效设置供 UI 等插件格式化显示。cron 仍要求每个作业明确配置时区，插件不得从 Harness 默认值继承，避免调度意图隐式变化。代价：运行环境 Intl 数据库负责名称/格式本地化，Harness 显示时区不替代 memory 或 cron 专属时区。

**D9 不写假数据。** 产品代码与模板不含模拟模型或虚构内容；需要模型的测试使用真实模型（默认 `openai/gpt-6-luna`），没有凭据时跳过并明确报告"未测"。

**D10 许可证 Apache-2.0。** 含专利授权，并明确不授予商标使用权。

**D11 ChatGPT 订阅走 pi-ai 内置 `openai` 供应商，每个 home 单独登录。** 内置供应商直接引用（`openai/gpt-6-luna`），配置里同 id 的条目只做叠加，沿用 pi `models.json` 的语义，不另起别名。OAuth 刷新会轮换 refresh token，复制别处的登录会让双方互相失效；AI-Being 的登录键名（`chatgpt`）与格式（codex）也对不上。代价：多一次浏览器登录。

**D12 一个 SQLite 文件、一个连接。** pi 的表用 `pi_` 前缀，Yonder 的 `y_` 表走同一个连接对象，由它排队，避免两个连接互相锁住；文件只有一个，备份与迁移都简单。

**D13 工具名只用下划线。** OpenAI、Anthropic 的工具名只接受 `^[a-zA-Z0-9_-]+$`，带点的名字被拒（已用 `gpt-6-luna` 验证）。内置工具写作 `message_send`、`task_run`，插件工具写作 `<pluginId>_<名字>`；事件类型不发给模型，继续用点。插件 id 不含下划线，所以 `qq_*` 这样的通配不会误配其他插件。

**D14 插件只依赖 `@yonder/sdk`，SDK 自己定义 `Tool`。** pi-durable 标为实验性；插件若直接写 pi 的工具定义，pi 一变所有插件都要改。SDK 定义稳定的小接口，runtime 负责转换（07 §3）；只有执行环境、消息、模型集合这类大接口以纯类型从 pi 重新导出。代价：多一层转换，pi 的部分工具能力（嵌套调用、结构化输出）暂不对插件开放。

**D15 给 agent 的输入一律是事件、走绑定。** 外部调用、agent 之间对话也不例外：需要返回值的调用方用 `events.ask`（渠道是 `io.ask`），回复交给调用方而不发回渠道；`agent_ask` 就是内部渠道 `agent` 上的一次 `ask`，回复成为工具结果，所以不会互相来回。会话接口只驱动预设会话，每次提交写 `session.input` 事件。代价：外部调用方不能直接指定 agent 的会话，由目标 agent 的绑定决定。

**D16 回复目标跟着输入走，不跟着会话走。** 主会话跨渠道，若记"会话最近的来源"，排队中的另一渠道消息会把前一个回答引到错误的渠道。每次运行回答哪些输入由 pi 的回答关系确定（`run.end.inputs`），回复发回这些输入的来源。

**D17 会话的配置档在创建时确定。** 同一会话被不同配置档的绑定命中会让权限随来源翻转、也让提示缓存反复失效；加载时静态检查，运行时兜底丢弃（`profile-mismatch`）。

**D18 skill 由内核按 Agent Skills 标准发现、索引、读取。** 与 pi、Claude Code、Codex、OpenClaw、Hermes 同一格式，社区 skill 直接可用；system 里只放按名字排序的索引，全文用 `skill_view` 按需读取，readonly 分身也能用。agent 可以在自己工作区写 skill；自动生成、整理、淘汰这类策略（Hermes 式积累）留给插件，避免内核替 agent 制造上下文膨胀。否决的方案：skill 完全插件化——插件贡献的 skill、预设会话、远程工作区、能力控制都要跨插件约定，最后仍需内核定格式。

**D19 渠道与执行环境都是"提供者 + 配置出的实例"。** 一个插件可接多个账号或多台机器；实例配置由内核校验后交给提供者，密钥只放凭据文件，经 `api.credentials.get` 只读取得。

**D20 插件能观察事件、能发消息，但不能拦截路由。** 记忆、审批、工作流插件都需要 `events.on` 与 `messages.send`；拦截会让"谁处理了这条消息"不可追溯，所以不提供。

**D21 安装与更新：按 git 标签在本机构建，`current` 符号链接切换，launchd 拉起。** 不依赖发布到 npm 的流程，私有仓库也能用；回滚就是切回旧目录。更新后每个会话在下一次输入的 `<turn>` 里收到一行内部通知，agent 用 `yonder changelog` 了解变化。代价：每台机器都要有 node、npm 与 git 凭据。

**D22 工序 0 补齐接口后冻结设计。** 渠道注册 ChannelProvider；send 接受 conv/acct 目标并由渠道处理私聊；全局插件发送必须指定 person/acct/conv，不猜 owner；services.resolve 异步读取当前凭据。agent_ask 用内部消息的 data.target 限定目标，仍走绑定；不加第二套路由规则。流式目标只通过 final 完成最终投递，其他目标用 send；NO_REPLY 起始增量暂存。理由：消除会造成各实现者自行发明协议的空白。代价：0.1 发布前修订 SDK 草案，无旧版兼容层。

**D23 默认能启动，并兑现已有文件作用域。** 默认模型 openai/gpt-6-luna；03 §3 明列默认值，init 显式使用 bypass 和全部可用工具。预设 cwd/env 继承父会话，无父会话使用 home/local；不生成预设人设。无 exec 的文件工具按真实路径限制 cwd 与本轮附件；有 exec 不宣称文件隔离。setup 无网络/定时器是插件契约，只拒绝 PluginAPI 的 setup 副作用，不引入沙箱。理由：完整现有承诺，不另加安全层。

**D24 安装入口与服务闭环。** 创建/查询安装的命令不要求已有 home；start/chat 的 JSON 是逐行输出，login 只在 stderr 交互。service start/restart 在未加载时 bootstrap；wrapper 与服务保存最小 PATH，使后台 agent 能找到 yonder/node/npm/git。理由：无 home 首次安装和 stop→start 必须可执行，不增加新命令或安装器。

**D25 两轮完成 0.1（2026-10-18 用户批准，已完成）。** 第一轮连续实现全部任务到 T14，仅做构建、类型和必要最小检查，问题记录不扩围；任务标已实现待验收。第二轮经用户审核后再讨论设计修订、补齐所有原验收与修 bug、执行 T12。原功能范围和架构不变量不变；不把缺凭据、未测或已知问题算作通过。主 agent 统一提交和共享文件，最多三个实现 agent 分目录并行；第一轮不发布或覆盖日用环境。

**D26 本机自维护与官方插件路线获准开工（2026-10-18）。** 用户在审核对话明确要求“你来补齐，然后你来发起让其开始任务”。设计方补齐 spec/10、11 的事件呈现、阶段安装与正式发布责任，任务区分硬依赖和建议顺序并前置外部能力试通；原功能目标全部保留。Codex 做基础、架构审查和 PR 合并，大多数实现经 MCP 交给安装版 Yonder；官方插件为同仓库独立 SDK 包。N00 先统一受影响旧条款并记录冻结 commit，随后连续实施，不重新请求整轮批准。代价：发布链接通前需 Codex 执行阶段安装，实际不可用的外部能力保留阻塞，不把独立任务一并停住。未受影响的旧契约、原失败记录与验收继续有效。

**D27 N00 对齐并冻结（2026-10-18）。** 01–09 已与 10/11 对齐：通用事件正文、真实调用方/附件、运行配置、取消、终止/恢复、来源/等待者、阶段安装/正式 Release；删除冲突的第五次副作用后终止、重启重新计数、只有 CLI 可实现等旧条款。SDK 仅新增可选取消参数/渲染信号，保留消息与安全单层结构。冻结提交见 N00 结果；任务记录继续变化，功能文档不随实现修改。代价：原实现尚未兑现的新条款必须由 N01/N05 等验证，不能引用 T00 为已通过。

**D28 固定 pi 版本的最小原生边界补丁（2026-10-18 用户批准）。** 用户明确批准“允许最小原生回调，先更新对应设计记录”，并要求继续设计执行。真实复现显示排队输入可把正在运行的 Luna 改为 Sol；1.3.0 公开钩子位于模型选择后，不能兑现 10 §2。保留 1.3.0 包名版本与 MIT 版权，在 GoYonderTogether/pi 的 yonder/1.3 源码分支增加调度器解析 agent 前的宿主回调，并让单运行 abort 使用原生 final 边界接续队列；runtime 的配置/预算快照仍存在 pi 扩展文档。packages/pi-durable workspace 同步固定 fork commit，构建先于 core，无 postinstall 补丁；不引入新依赖、自建队列、模型别名或运行时猴补丁。代价：升级 pi 时必须重新审核 fork 边界改动及真实配置/取消检查；上游原生覆盖后删除 fork 改动。

**D29 与原生终结同事务的最小运行回执（2026-10-18 用户批准）。** 用户审核具体方案后批准“最小原生回执”。N05 真实 Luna 证明中止后 A/B 同组已无共同 answer，LiveDoc 的旧 run 被清除；异步 run_end 观察不持久，successor 可在同一事务启动，晚读 UsageDoc 会串轮。扩展 pi-durable 1.3.0 的 fork 源码，在共同原生终结点按 conversation/首个实际 submission 保存一份实际 inputs、settlement、结束 usage 回执，与 submission 终结原子提交。使用原生 doc family 和公开读取，不引入存储拦截器、第二队列、重试或对话副本；Yonder RunDoc 继续负责开始配置/预算。旧历史无充分事实时报告不可确定，不伪造补齐。升级或上游覆盖时审核/删除该 fork 改动，回执与正常/中止/失败/successor 的真实检查同时维护。功能目标与公共 Yonder SDK 不扩大。

**D30 基础 TUI 沿用成熟产品的完整界面与交互（2026-10-18 设计修订；呈现与键位部分已被 D31、D32 取代）。** 用户要求基础 TUI、Tab、中英文提示、斜杠补全和列表选择，随后明确纠正“我们的所有的交互 所有的显示 所有的框架都照搬现有现成的东西”。因此删除上一版自定线框、布局、键位、同义菜单名和运行中禁止发送的限制，以 pi v1.3.0 原生界面为单一基准；同义入口沿用 /new、/resume、/session、/hotkeys，实际命令内容、agent/任务归属与当前对话对象由 Yonder 提供。既有管理命令继续非交互并保持 JSON/退出码；独立可续聊任务仍需 manual 关闭策略与控制面观察，常驻 agent 继续渠道绑定。UI 需要的真实工具/消息数据和原生输入动作由 Core 接通，不能用另造交互绕过。代价：coding-agent 部分 UI 与 AgentSession 耦合，需核验公开导出或按许可提取 UI 并保留来源，同时验证与原生 pi 的视觉/操作一致。12 与关联修订是已批准的设计。


**D31 原生 pi 组件内精简展示并对齐常用键位（2026-10-18 用户追加要求）。** 用户提供 Claude Code 截图，要求用户/AI 明确区分、主要信息放固定底部、默认折叠和微提示。原 D30 的“显示和按键均不调整”不能满足这次明确要求，现由 spec/12 §6 取代：保留 pi 渲染/编辑/消息/工具/列表，顶部只品牌，用户与 AI 显式角色标记，底部默认一行、详情按需展开；Ctrl+C 运行时中止、Ctrl+L 重绘、Ctrl+P/N 历史，Ctrl+O 统一详情，`?`/hotkeys 底部微提示。依据截图和 Claude 官方文档，未接线的权限/后台任务等不伪装实现。后端和日用安装边界不变。


**D32 按源码修正消息密度（2026-10-18 用户连续反馈）。** 用户指出标签独占行和间隔过大，要求灰色用户背景、灰色身份紧贴正文、AI 首行左侧标记、过程折叠，明确要求先调研网上源码。主 agent 先实际运行本机 Codex 0.160.1 Luna，再核对相同 tag messages.rs/style.rs/exec_cell/render.rs 与 pi 1.3.0 assistant-message.ts：后者已有顶部 Spacer，额外标签/Spacer 导致重复留白。现删除独占行角色标签，限定一层呈现适配：原生 Markdown/消息保留，仅修外层 padding/行首前缀，用户只给文字行灰背景，消息间一空行；工具默认一行真实调用/状态，展开沿用完整原生组件。参考 Codex 的信息层级而不引入 Rust 框架或第二 runtime。原始转录和输入不变，终端字体配置仍归用户。


**D33 Hermes 对比收敛与能力补齐实现轮（2026-10-18 用户批准）。** 用户明确批准 C0–C6，要求 U05 交接后执行，三个 gpt-6.1-sol 子 agent 并行，核心及共享文件由主 agent 负责，不写/不跑测试，完整实现功能体和接线、记录问题，整轮后审核。U05 以 3d31601 交接；13 冻结全部 H01–H13、H20/H21/H24/H25/H26 目标和有限本地管理入口，旧规范统一引用，其他 Hermes 生态仍在范围外。继承 D28/D29，不重建队列/运行时/审批层。Codex 本轮直接补框架，下一轮安装验收后再由真实 Yonder 执行自维护与测试；原作者、失败、测试与真实验收义务保留。build/typecheck 只证明组装，不代表功能完成；本轮不自动安装、推送、发布或外部发送。


**D34 R0–R6 修复验收与最小 macOS 状态栏（2026-10-18 用户批准）。** 用户批准审查 D1–D4 推荐方向先改文档、三个 Sol 并行、核心共享单写、补测试与真实安装验收。02/03/04/06/11 明确 InputReceipt、显式子任务附件与产物、可信 ToolContext 共同发送及 Delivery.uncertain、Release 首次基线；不增加队列/审批/outbox。09 §6.1 固定新增本机状态栏的最小原生 UI、检查更新只读、退出停服务且保留登录自启定义、日期 patch 版本。原 0.1.4 与历史保留，不冒充已安装/验收通过。运行前输入准备若需要额外原生补丁，仍先确认精确边界，不临场建立第二套调度。


**D35 飞书恢复与跨渠道交互（用户批准F0–F5）。** 用户批准恢复/命令/日志/验收计划并授权Sol/Luna实施，追加要求CLI命令一致、同agent跨渠道main、接收表情及条件引用。复用官方SDK重连、事件账本去重、pi inbox/steer和既有能力/身份；历史按时间顺序中连续同会话同发送者同线程分批（D36修订），保留原生来源，64KiB文字预算，不承诺平台不可见历史或未知离线新私聊。自动sourceMessageId与显式replyTo分开，只有新用户气泡隔断时自动引用；Typing在可见回复或终结清理，不引入第二消息队列、守护进程、审批层或通用办公框架。CLI四条现有命令在飞书提供，其余TUI专用。事实验收独立于实现；状态栏用户确认通过，注销/登录等待用户方便时操作。


**D36 区分待处理输入与来源会话背景（2026-10-19 用户批准设计并修复）。** 现场旧问候迟到65分钟后按新请求呈现；seen只有接纳事实，恢复按发送者全局分组且缺失其他参与者及已回复消息。复用现有turn上下文贡献channel-feishu.conversation，按实际来源及原时间读取有界、按时序的全参与者背景；输入正文及身份仍由原事件/绑定提供。core只增加可选createdAt/msgId呈现，不新增渠道上下文API；pi保留排队/终态所有权。恢复仅合并连续同发送者同线程，不重排其他人消息。预算/权限/线程范围不足明示，模型决定旧任务是否还需回复，禁止靠年龄或关键词丢弃。代价：选择该贡献的飞书输入准备会读取平台历史；网络失败保留输入并明确背景缺失，历史附件按需经原工具读取，无第二存储/队列或自动重试。


**D37 全局日用CLI与可选开发技能（2026-10-19 用户批准）。** 用户实际裸yonder报home not found，要求单一正式服务、主会话和普通用户安装更新。复用已安装服务的原生home读取，补默认全局home；裸入口连现有CLI渠道并观察已存在main，显式chat继续独立任务，不绕过绑定。内置skills作为既有发现器最后一个来源，发行完整skill-creator和可选开发技能，保留用户覆盖/选择，正文按需加载。开发默认独立源码Git与隔离home，正式update/current机制保留，不新增更新器、开发平台或强制约束。当前CardKit背景验收发现平台兼容摘要不含正文，D36同时补充按同conv成功message.out.delivery.id还原本机器人回复，预算仍含补回正文，无新转录副本。

D36现场补充：原事件正文紧随其来源头，补充会话背景放其后，避免先展示完整后续对话后又把旧问候裸放在输入末尾，造成新的请求语义；不新增消息角色、提示词引擎或第二转录。真实模型对是否回复仍需独立记录，不能把信息接线通过等同语义决策保证。


**D38 硅基原生媒体工具，先接明确免费能力（2026-10-19 用户指定）。** 用户要求由Sol接入硅基流动并复用成熟协议，视频成本过高则找免费API。Chrome真实控制台已核实Kwai-Kolors/Kolors在线推理¥0/图片，当前L0为2 IPM/400 IPD；首段采用现有services.resolve与SDK工具/附件，native fetch按官方images[]/image_size契约请求并立即转存。OpenClaw通用OpenAI图片data[]/size和Hermes FAL路径不适配，不能为了照搬引入错误协议或整套provider框架。免费音频经实际核价后补入；未核实免费的视频不生成。代价：免费配额和供应商可用性仍受平台约束；本轮不承诺所有生成模型/服务可选，不建第二模型目录或任务系统。

D38同次核价补充：SenseVoiceSmall实际控制台¥0，追加同插件ASR工具；CosyVoice2为¥0.05/千UTF-8字符，保持未启用。免费API真实验收仅Kolors与SenseVoiceSmall；不会用付费TTS生成验收素材。


**D39 更新职责归日常 Agent，不另设更新 Agent（2026-10-19；更新通知的模型中转已被 D40 取代）。** 版本关注、获准更新及通知归常驻的日常 Agent，用同一身份内受限的 release-updater 配置档和独立 persistent 会话，不增加第三个 Agent；项目维护另由维护 Agent 承担。既有 channel-github 轮询、发布接收基线、五个工具白名单、仓库/作者/通知目标与服务外 launchd 作业保留，原独立 operator 归档并保留历史。该决定描述的是一个具体部署的职责划分，不要求每个安装采用同样的 Agent 名字与分工。Agent 热管理由 D41 实现，人格与灵魂提示词后置。


**D40 事件的程序消费与无模型通知（2026-10-19 用户批准 E0–E4）。** 复用events.on/messages.send/write绑定，确定性执行不经模型；默认模型仅处理显式run输入。GitHub apply直接调用现有升级函数，程序通知单独notifyUpdates选择。core共用updateRelease写release.update-result，直接CLI与插件job同源，不建新outbox；旧plugin事件仅保留历史。可升级上下文使用已核实缓存和宿主version。内部通知经原生pi app-only write及原生requestId去重，SDK sessions.notify与TUI程序消息展示，不伪造角色、不进入模型上下文、不patch pi。三位Sol分路，主路独占核心共享接线；只做相关检查，整合提交，不自动发版覆盖日用安装。


## D41 执行能力补齐与软阈值（2026-10-19）

用户直接批准实现和发布。内核统一15秒长工具后台化、进程生命周期与软时间/轮数/tokens提醒；取消仍显式，不追加完成判断循环。cron、通用MCP客户端、独立浏览器/桌面作为SDK插件；Agent管理沿YAML/preset和既有校验热发布；memory仅手工目录，不引入记忆引擎或自动注入。采用成熟库和参考工程，不复制其运行内核。功能见 spec/14。


## D42 非插件内置提示词落地（2026-10-19）

用户明确批准当前v4中文稿落地源码并提交，sub-agent对准确commit验证真实装配与Luna。共同/常驻/运行/exec导航分段以英文静态常量编译（正文与中文审阅源已由 D45 取代）。framework短导航约束不截断底座，常驻身份不进入task，CLI只给exec，用户身份与配置顺序保持。version/home/env/cwd与宿主prepared时刻/时区/platform写入turn，不破坏system确定性，不新增插件、模型循环、配置项、存储或资源复制机制。无需改正式安装；初始化磨合与官方角色仍为后续设计。与D41并行的能力以真实当前工具和运行事实为准，底座不写死cron/远程/后台工具已可用或旧硬时限数值。


## D43 消息与任务的生命周期分离（2026-10-20 用户批准）

用户指出飞书开头一句话后气泡长时间生成，追问时结果突然出现，授权先对齐规范、修内核和飞书、补长任务验证并正式发版。原06将整轮流式收敛到一个final的行为取消：复用pi原生message_start/end，每条assistant消息单独开闭渠道流和保存发送回执；工具等待不延长旧消息，阶段与最终独立。按原生消息生成时间标识细化发送去重，最终answer及恢复采用相同标识，未知结果不重发；取消和错误仍单独说明，模型终结不等渠道。后台结果已自动唤醒，保留该路径并验无新用户输入也能交付。飞书明确完整引用与file URI的工具契约，修正现场两类参数误用的引导。发布授权不自动覆盖日用安装。


## D44 中断恢复复用原生 generation retry（2026-10-20 用户批准）

用户批准将 durable 内化为 GoYonderTogether/pi 的 yonder/1.3 源码 fork，workspace 同步固定 commit；只有 durable 被修改，其余 pi 依赖继续使用上游 npm。D28/D29 的边界与回执及 shouldRetry 钩子以源码提交维护，不再 patch node_modules。沿原 conversation/run/inputs 与原生持久化 retry checkpoint 恢复，不增加队列或重提交流程。yonder.yaml.retry 提供 maxRetries/baseDelayMs/maxDelayMs，默认 10/2000/300000；pi-ai 1.3.0 已有 maxAgentDelayMs 上限，runtime 直接映射，无需 fork pi-ai。指数退避不加抖动；重启保留次数与当前截止时间，后续退避读取新配置。

runtime 提供瞬时错误分类，鉴权/API key/权限、上下文/token 上限、配额/账单、schema、显式 abort 与 repeatStop 不重试；网络、5xx、429/过载可重试。首次瞬时失败原子写短 user-style 提示及运行去重状态；连续失败及其间重启共用一条，成功后新中断可再提示。重启提示以原 run 为稳定身份，已终结运行不再提示；恢复请求补入 inbox 中未越过旧 cutoff 的提示。耗尽以正常 error 和明确最后错误终结；退避可立即取消，close 释放计时器。保留逐消息投递身份；provider prompt cache 不可持久化。真实检查和未测项另记 status，不操作正式安装或运行中的服务。


## D45 Agent 提示词只有 SOUL.md 与 AGENTS.md，内置正文只有一个来源（2026-10-21 用户批准）

内核不再规定 `SYSTEM.md`，只规定 `agent.yaml`；Agent 自己的提示词只有 `SOUL.md`（风格、扮演的角色、品味）与 `AGENTS.md`（工作方式、范围、执行风格）。context-files 的 `soul-md`、`agents-md` 保持通用读取，未编辑的空模板不注入。两份同一种语言，默认英文，明确的中文角色才用中文，按主人的语言回话。不设 USER.md 作为默认；用户个人资料库见 D50。

内置底座继续以 `content.ts` 为唯一英文正文，不另维护译文审阅源；用 Yonder 平实的嗓子，具体人格属于各 Agent 的 SOUL.md。原来的长度目标与 init 空模板选择已由下方 2026-10-23 分层决定取代：默认完整保留共同规则和来源表达案例，可配置删减，init 选择插件内 Jarvis 正文。已有 Agent 的 SYSTEM.md 不自动删除或迁移，由主人按需并入 SOUL.md/AGENTS.md。



## D46 任务责任、委派恢复与通知补达（2026-10-21 用户批准）

用户明确授权先对齐生命周期规范，修复所有已查根因与恢复风险，补真实模型、父子任务跨重启、断网与通知补达回归，验证通过直接正式发版。消息闭合、运行终结与交办目标完成分离；目标是否完成仍由模型判断，后续必须已有后台等待或显式 task_continue 进入原生 followup，不猜测自然语言、不加心跳模型或第二调度器。内部委派使用稳定调用身份重接原输入；外部副作用未知不重放。后台结果以持久接纳为交接确认，失败自动补交且未交接时不关闭父会话。保留具体错误，OAuth 网络故障不冒充鉴权拒绝。投递沿原事件账本补达确定未发送的瞬时故障；未知/部分成功保持保守，不重复发送。

## 2026-10-21 微信迁移与身份边界

按维护者的微信双插件方案实施指令：迁移 AI-Being/旧 being 的归档读取和 iLink 协议能力，复用 Yonder SDK、身份、绑定、投递，不迁移旧 Work/Brain/队列。归档是只读资料触发器，不扩展 Channel 的发送能力；扫码 token 由协议插件私有保存，不新增通用凭据 setter。首个配置实例的扫码联系人默认关联显式配置的主人，后续实例必须独立指定人或保持未关联；实例顺序不等于身份权限。

## 2026-10-21 微信真实接入与默认扫码入口

维护者要求将主人 iLink 接到当前 Bot，并用第二微信号验收隔离；授权本机候选安装、服务重启及测试收发。工具默认申请首实例并返回扫码链接，扫码确认由渠道程序轮询，不让模型反复轮询。增加 Channel 可选 login 与 CLI channels login、来源受权的 /connect，三者复用同一实例登录方法；默认返回链接，只有显式 --open 才打开本机网页。


**D49 连续输入默认合并与最终回复中断（2026-10-21 用户明确批准）。** 所有渠道与显式 task 输入缺省 busy=steer，原生两类队列消费模式均 all；显式 followup 保留，增加 interrupt 取消生成及当前工具。默认 steer 不取消正在执行的工具，但生成回复时取消旧生成、把全部 steer 插话并入原运行，阶段性已发气泡保留。新输入与最终提交的竞争由原生事务处理；不建第二队列，不重放已执行副作用，不把跨会话/不同权限输入合并。原生修改在 pi fork 源码测试提交后同步。真实微信三条输入形成三个 run.end 是原缺陷证据，代码/模型/安装/真人验收分别记录。

**D50 命名凭据由人在本机隐藏录入（2026-10-21 维护者授权先落地后补记）。** 独立飞书 Bot 等新渠道需要新密钥名，而公共接口只有只读 `credentials.get`，曾导致“Agent 无法安全接入新密钥”。增加 `credentials set <name> --home <dir>`：只在本机交互 TTY 隐藏读取，不接受 argv/管道/环境变量/`--json`，不新增控制 RPC 或模型工具；只创建 `api_key`，同名（含 OAuth）一概拒绝，不做读取/轮换/删除；与 OAuth 刷新共用路径锁，严格检查路径与权限，临时文件加 fsync 后原子 rename。拒绝的方案：让 Agent 从浏览器读取 Secret 后写盘（明文经模型）、直接改 `auth.json`（与 OAuth 刷新竞争）。通用的“浏览器/文件采集进密钥库”中枢另议，不阻塞此入口。

**D51 委派可由程序逐字引用来源消息（2026-10-21 维护者授权先落地后补记）。** 主 Agent 把用户的话转给子 Agent 时，模型复述会丢失原意，而完整的“消息转派插件”（四个工具、工作单、取消与进度回传）需要新的 SDK 与绑定契约，收益不抵成本。先在现有 `agent_ask`/`task_run` 上增加可选 `sources`：内核按事件 id 或原生 msgId 从账本取出本次运行来源会话里的入站消息，原样追加 `<source-messages>` 块（带 id、发送者、时间与精确字符数）。不新增工具、插件、事件类型或队列；不跨会话读取（仍走 `session_read`），不转交附件，不截断；引用不构成新授权。拒绝的方案：模型传入正文字段（仍由模型改写）、指定目标 session、跨渠道回传（缺少单输入取消与归属输出，原方案三项待决点仍未解决，转派插件暂不实现）。

**D52 委派可指定按次 effort；智能路由不进内核（2026-10-21 维护者授权先落地后补记）。** 重要任务应能用更高思考等级委派。核心只做最小一步：`agent_ask`/`task_run` 的可选 `effort`，要求 `admin`，仅内核写入的委派有效，在运行启动时解析进该次运行的快照，不改长期配置，记入 `run.end`（14 §5）。原提案要求的“独占队列隔离”需要改内化的 pi-durable，且默认 steer/全量队列下无法保证单条独占；改为合并取最高有效请求并写明代价，独占需求用 `task_run`。拒绝的方案：聊天文本里解析等级（自然语言不是授权）、按次切换模型、在核心里估计难度/成本。自适应决策模型路由（8177df1 的建议库）没有可挂接的输入钩子，作为未注册库不合入；真正的路由插件要先有被批准的 SDK 钩子，另议。


**D54 BrowserSkill 继续使用 MIT 上游，最小 fork 提供可选书签与扩展管理。** 基线为 Tencent/BrowserSkill main `6214e3d`（最新发布仍为 0.3.3），保留独立 fork，Yonder 只调用 CLI、不内化浏览器运行时。沿用书签四动作，扩展管理复用 Chrome `management` API，仅 list/enable/disable；插件 `bookmarksEnabled`、`extensionsEnabled` 默认关闭，Chrome 可选权限只能由主人在 popup 授予，本地 owned session、取消和原有受限页面规则保留，拒绝修改自身与受管理扩展。不让网页授权扩展修改，不自动重试未知写入。安装采用真人 Chrome 的手动 Load unpacked / 商店确认；无人值守仅在独立 Chrome for Testing profile 使用 `--load-extension`，不冒充真人已登录浏览器。CWS API 可自动更新已有条目并送审，但首次开发者账号/费用、unlisted 配置及审核不能跳过，未提供凭据则停止该支线。编译 `BSK_FORK_BUILD=1` 固定关闭本 fork 的自动及显式上游更新，避免书签补丁被覆盖；升级通过重新同步 fork。取舍、七级路线及 OWNER STEP 见 [调研](research/chrome-extension-install.md)，实际测试见 [验收](verification/browser-skill-fork.md)。PR #434 原书签分支不重写：本轮 rebase 改写了本地提交且增加 Yonder 专用管理行为，另推 fork 分支，不向 Tencent 推送。

## D55 macOS 权限由稳定 helper 执行与引导（Track C phases 2–3，2026-10-22）

维护者代表主人明确批准 unknown 语义，撤销 phase 1 的完整可观测性 gate；不再要求 OS 区分未请求与拒绝。采用 spec/14 §5.1 的状态模型，持久保存自身请求时间、最近探针、代码身份与曾 granted 的证据。false 是 not-granted；requested 仅是请求历史；同代码身份后续 false 可记录 revoked-detected（探针证据，非拒绝原因判定）；代码 hash 变化而旧 grant 存在时标 needs-restart / grant likely invalid，须重新检查或授权。FDA/Files & Folders 为 unobservable；API 不适用/失败为 unknown。

复用 PermissionFlow v2.11.3 / `cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2`，MIT LICENSE + NOTICE，仅显式 guide 初始化浮窗，promptForAccessibilityTrust=false；不使用其 FDA provider。原生 API 组合提供 AX/Screen/Input/AV/UN/按目标 Automation 探针；最小自有 Swift helper 补齐持久历史与 CoreGraphics/AX 桌面执行。候选实测表沿用[调研](research/mac-permission-guidance.md)，不再增加候选或依赖。

ONE Yonder Helper.app 是桌面操作的签名代码主体，通过 LaunchServices 后台启动，以本地 stdin/stdout JSON 交换；不让 Node/JXA 代执行截图或输入。稳定路径与外置状态跨 harness 更新保留，bundle 仅 cdhash 改变才重装。本机发现 Apple Development 身份，构建优先采用；CI 无身份时 ad-hoc，显式披露不能承诺 grant retention。签名本身和父进程链不构成已授权证明，真实 TCC 归属与授权矩阵保留主人验收。

AI permissions/status 不发起请求，保持非提示式。2026-10-24 主人明确授权修正：除独立人用 CLI 外，owner 来源也可在现有工具能力范围内显式发起单项 request/guide/watch；非 owner 来源不得发起，系统权限批准仍由真人完成。watch 只观察、限时、可取消。不动生产 home/service/launchd/TCC。Phase 3 按主人一次性授权短时打开 accessibility / screen-recording guide 测量几何，不点击授权。guide/watch 共享每秒非提示式观察，默认 600 秒；granted 保存 grantedAt，显示一秒确认后结束。关闭/超时返回 requested 历史与失败 JSON；撤销保留 revoked-detected。Screen Recording 当前进程 false 而同签名新进程 true 才标 needs-restart，guide 由单按钮重启、watch 自动重启，再验证 granted。PermissionFlow 保持原 SHA，以可审阅的小补丁开放 frame provider / 状态文本 / 关闭回调；按真实 Settings CG 边界与可用 AX 列表帧定位，屏幕无下方空间时隐藏而不覆盖列表，输出上移 Settings 的下一步。实际验证、全部失败与 OWNER STEP 见[验收记录](verification/mac-permissions.md)。


**D56 Bash 普通输入与交互输入显式区分，后台终态统一收口（2026-10-22 维护者授权筛选修复）。** 生产四个无路径rg因始终打开的stdin等待数小时，不能通过延长timeout或重复命令解决。普通Bash默认stdin结束，只有显式stdin=true保留管道；process.write沿原入口可附eof=true关闭输入，background仅决定让出时机。取消仍完成既有settled/idle责任交接并保存有界日志尾部，但不触发模型续办；日志游标使用累计字符数，超出窗口明确截断。保留pi任务/文档、能力与session边界，不新增队列、存储、硬超时或完成判定层。代价：依赖原来隐式开放stdin的交互调用须显式传stdin=true，旧日志缺累计游标时仅能按已保留长度解释。

## D47 QQ 官方渠道与扫码配置（2026-10-21 用户授权）

用户要求按调研方案接入 QQ，优先腾讯 SDK、私聊与群 @ 完整闭环，并授权其他层按最佳实践设计。渠道沿既有 PluginAPI，不新增模型循环、队列或通用配置框架。运行时只读凭据；插件附带显式本机配置命令承接扫码、凭据和 YAML 配置，保持用户登录与授权在官方页面。默认私聊只允许扫码用户，群使用独立无工具配置档；现有群配置档须显式选择。首版只做 WebSocket 与文字发送，连接恢复交 SDK，入站去重和投递事实交内核。真实测试使用独立 home，不覆盖日用安装。腾讯扫码连接器通过其公开 npm API 使用，不复制或改许可其分发源码；保留上游元数据与使用说明。

## D48 QQ 群普通消息接纳（2026-10-21 用户追加要求）

用户确认私聊与群 @ 收发后要求开放群全量接收，并调研分桶、自主参与和只读分身。先复用现有 GROUP_AND_C2C_EVENT intent 与腾讯 mentionGate passthrough 接纳 GROUP_MESSAGE_CREATE，沿 wake: mention 写入群独立 persistent 会话，普通消息不逐条调用模型；平台开关与真实普通消息验收单独记录。周期调度、按消息 ID 选择回复、只读分身向本 Agent 主会话请求工作的契约另见调研草案，未审核前不把草案接口当成已实现能力。

## D57 群分桶参与与受限主会话请求（2026-10-21 用户明确批准草案）

用户选择“按这套契约继续实现”，批准每群独立只读分身、非空 60 秒分桶、模型显式定向回复及只请求所属 Agent main 的 parent_ask。继续使用 write/persistent、事件绑定、原生 inbox/后台等待和既有投递；群分身不授予通用 message/exec/admin。主会话请求携带真实来源，不把群成员请求升级为主人授权。共享 message_send 增加已有 SDK 的 replyTo 并验证目标会话。平台全量权限实际由手机 QQ 群主设置，已核对官方 FAQ 与 bot_state；日用安装保持不动，隔离 home 验收。

## D58 会话模型链与跨渠道运行命令（2026-10-23）

维护者要求 RightAPI Sonnet 默认、GPT-6.1-Sol 回退，支持 Agent/profile 与会话配置多模型，默认连续失败三次。模型切换、失败计数与重试 checkpoint 归 pi 原生循环；Yonder 只映射配置及会话覆盖。复用原生上下文估计、压缩、任务图与渠道命令层提供 /model、/status、/compact，不另建队列或任务存储。

## UI Companion 由已确认原型接入插件（2026-10-22 用户批准）

用户确认菜单栏小窗、共享 Logo、同锚点收起和渐进卡片后要求直接接入插件。源码从 proposals/ui-companion 迁入 plugins/ui-companion，删除原型固定设计任务，沿用 SDK tools/triggers，不改内核或增加 UI 槽。present 提交并返回真实请求 id，result 在原会话可取消地等待实际输入；采用插件自有回环服务和主仓库状态栏非激活宿主，复用同一 Web 渲染。插件私有文件保存交互历史，不复制模型转录。唯一状态栏同时承载交互与服务管理。结构化卡片、独立窗/提醒/内嵌为本期边界；生成 HTML 执行、图片渠道及语音另议。

2026-10-22 用户进一步确认：完成的交互默认同时隐藏浮窗与悬浮入口；仅待处理任务保留浮球，下一任务自动重现，菜单栏保留历史入口。autoClose:false 仍可保留完成窗口，内嵌结果仍保留。

## 2026-10-23 合并状态栏与 UI Companion（用户要求直接合入当前仓库）

状态栏留在 packages/macos，继续归安装/服务客户端；交互数据、工具和回环 Web 保留在 ui-companion 插件。移除插件独立 App 和 NSStatusItem，通过插件私有 desktop.json 把当前回环页面交给同 home 的唯一状态栏。左键当前交互/历史，右键交互入口、服务状态、检查更新与停止服务并退出；任务默认完成后仍同时隐藏浮窗与浮球。现有未提交的 channel-card 工作必须完整保留。

## 2026-10-23 桌面入口默认就绪修复（用户反馈已更新却提示插件未就绪）

0.2.26102302 只随发行提供 UI 插件，旧 home 未配置时没有端点，状态栏因此不可用。默认加载桌面服务与授予 Agent 工具是不同职责：init 全局加载 ui-companion；CLI start 按已注册插件 id 为旧 home 补齐，复用现有管理入口做原子校验写入。已有来源与 desktop:false 保留，不改 Agent/预设的插件选择或权限。

## D59 上下文窗口与提前后台压缩（2026-10-23）

维护者要求 Claude 配置 1M 窗口，并在超过 272K 时开始自动压缩。复用 pi 原生后台压缩，仅增加可选 backgroundAtTokens 绝对触发点，取原生阈值与该值较小者；不伪装供应商窗口，也不把 GPT 的压缩推迟。共享 /model、/status 用量显示增加一位小数的窗口百分比。


## 2026-10-23 系统底座与两类官方常驻 Agent 分层（2026-10-23 用户要求实施）

用户提供完整参考提示词，要求完整合并共同规则，并将贾维斯主 Agent 与普通常驻 Agent 两类官方提示词落入插件；已明确默认 Agent 指普通常驻 Agent，无身份任务只继承共同底座。内核仍用确定性英文常量承载共同执行、常驻身份与真实运行约定；原文的 SendMessage-only、CloudAgent、box、Auto-review、固定 widget 与线程协议改为 Yonder 的实际契约，不新增这些能力。

使用独立官方 agent-presets 插件的现有 contexts/presets 槽，Jarvis 和 default-agent 各有 SOUL.md/AGENTS.md。新 init 选择 Jarvis；旧工作区不自动覆盖。沿用 scaffold、agents create --preset 与权限交集，不增加人格加载器。代价是模板修订不自动覆盖已创建的文件，用户已有设定优先；无身份 task 选择同名 preset 也不装入人格。来源逐项映射见 prompts/README.md。

用户随后补充本机多仓库、子 Agent/子进程、插件分散规则与原文表达案例，已纳入同一重构。又明确要求短上下文本地模型可移除、替换或部分选择提示词：Profile 增加可选 prompt.sections/overrides，按稳定段落 id 配置，包括移除框架导航；默认全量，既有配置兼容，不改变运行能力或投递。角色上下文、技能和工具沿原选择字段控制，不新增自动裁剪器或模型推断策略。配置运行快照与热重载仍走现有链。

用户随后明确要求基础设施完成后正式发版并全面更新本机 Agent 提示词。发布基线改为最新 main，保留已上线的 sources/effort、parent_ask、模型回退与按需工具目录；目录也纳入可配置的 tool-discovery 段。迁移只针对实际登记的本机 Agent 和 default 任务预设，备份后更新正文、保留个体职责与授权边界，移除旧的静态工具目录。外部 Hermes 扩展继续保留自身记忆与学习上下文。此授权属于本次部署，不将以后每次模板升级改成自动覆写。

## 2026-10-23 用户批准任务唤醒与合盖运行

电源能力归主仓库 macOS 系统集成，不归 UI 插件；沿用唯一状态栏。主服务续租，限定电源操作的特权宿主聚合并恢复系统状态。用户批准移除 MacToolkit 电源功能、落地验证后合并发版；保留其访达与硬件功能。

## 2026-10-23 职责型常驻 Agent 与三个任务预设（用户要求按方案开发）

用户要求减少层级，以有特定职责的常驻 Agent 承接长期工作，渠道分身与临时子任务辅助；独立工作 session 由模板定义提示词和工具。复用现有两类执行者与 preset/profile/context，不增加工作流框架或人格运行时。agent-presets 提供 default、coding、research 三套任务正文，后两者选择共同任务 context。短任务用 task_run，多轮工作用已有 manual task session；是否为子任务不改变专业模板。

用户明确要求大量保留参考项目和已安装技能的详细原文。编码取用 MIT OpenCode、Ponytail；调研取用 MIT CopilotKit OpenMuse；保存来源、原文、许可与适配说明，原文不自动注入。未找到明确许可证的 Digger OpenMuse 仅作结构参考。通用规则不在各角色中重复维护，工具/宿主专属约定改成 Yonder 实际接口。文案可配置，权限由现有代码落实；research 不提供 shell，不用提示词假装只读。

web-tools 是可选实际能力，不能让旧 home 只加载 agent-presets 就因未知依赖无法启动。插件的 research 默认只选自身；新 init 加载 web-tools 并生成选择它的同名 home 预设。现有 home 需显式选择，已有自定义 preset 保持优先。搜索凭据缺失与 HTTP fetch 可用分别报告。此轮不批量合并其他分支、不为展示创建无职责的常驻 Bot；开发者预览版的全仓收敛另按真实验收推进。

**统一聊天与压缩恢复（2026-10-23 用户批准）。** pi-durable 共享纯失败决策，generation 与 compaction 保留原生 checkpoint、取消链和状态所有权；Yonder 向两者注册同一错误分类。失败尝试记录在原生无模型正文 entry 中，与状态原子提交；压缩复用耗尽文案。不新建重试服务、队列或恢复存储。保留既有有回退链时所有模型 error 计数的契约，未配置回退时使用瞬时错误分类。

## D60 撤回未经设计批准合入的过度建设模块（2026-10-22 维护者要求）

主线曾合入三块没有 spec、没有决策记录、没有真实验收的模块，维护者要求回到“内核最小、官方插件各自独立”：（1）`plugins/progress-observer` 及其唯一消费的 `task.linked` 事件（含 `Runtime.exportTaskLink`/`recordEvent`）：与 D46“不加心跳模型或第二调度器”冲突，状态机一半无生产来源，测试以伪造模型代替真实模型；（2）`plugins/decision-routing`：违背 D52“路由插件要先有被批准的 SDK 钩子”，只是咨询型占位，测试在插件内直接 import pi-ai（违背 AGENTS 第 5 条）；（3）login operations 子系统（`login_begin`/`login_status`、`login_operations`/`login_outbox` 表、`runtime/login-*.ts`、`cli/login-*.ts`、`loginOperations` 配置）：插件形状的能力被塞进内核并自带 outbox 与第二套状态，未经人工登录验证。同时删除仓库根目录与 `artifacts/login-lifecycle/` 的过程报告，以及 `proposals/memory/skills/` 中与 `plugins/memory/skills/` 重复的副本。这些模块均不得在补齐 spec 与决策前重新合入；如需重做，先走设计变更，且登录类能力应以插件形式、复用既有事件与绑定实现。依据见审查盘点（代码、插件与架构文档对照）。

## 2026-10-23 用户要求 15 分钟缓冲和始终唤醒

保留同一电源租约和状态栏宿主，增加 tasks/always/off 互斥模式；任务归零后缓冲 15 分钟，期间新工作结束后重计。模式不参与 Agent 权限。网络恢复仅检查并反馈，不另造网络恢复层。

## D61 名片插件使用自定义设备协议，一次安装连接全部 Agent（2026-10-22 用户批准实施）

维护者明确要求先文档后代码，在当前分支、不提交、不连接真实服务的范围内实现 `@yonder/plugin-channel-card`（[16](spec/16-card-plugin.md)）。后端契约切换到 `yonder-card-web/server/PLAN.md`，旧 Tinode 草案被取代：设备码登录后以 agent id 为 key 登记本实例全部 Agent，单条设备 WS 多路收发、按游标补收；名片工具只写该 Agent 自己的草稿，发布保留为网页里人的操作。

`ChannelLoginResult` 只有 `qrcodeUrl`，复用该字段承载确认 URL，不新增 SDK 登录字段。`setup` 仍只注册，登记在启动/登录确认后执行；设备令牌只保存在插件私有数据目录。契约测试与真实后端联调分别记实。

## D62 名片渠道公共契约与后端补充（2026-10-22 维护者明确决定）

取代 D61 的未决契约项：G1 新增只读 PluginAPI.agents.list 返回启用 Agent id/name，启动、登录确认/邀请码兑换成功和每十分钟同步，无变更事件。G2 ChannelProvider/Channel 可选 multiAgent，注册 true 是普通渠道禁止 data.target 的唯一例外；目标须通过自己的绑定，其他 Agent no-binding；acct/conv ref 嵌入 Yonder agent id，OutMessage 不变。G3 使用 convKind/mentioned 下行与带 ref 的 sent/error；15 秒未确认 uncertain，绝不自动重发，io.emit 接纳后才 ack。G4 在后端 devices.ts 增加幂等 device/dm，限制设备所属启用 Agent 和共同会话/主人好友；token 私有，device.kind 配置默认 desktop。

真实实现差异：poll 的过期和未知码均为 404 invalid_code，used 为状态；WS 错误当前仅 {error}，没有 type/ref；登记仅 upsert，不移除省略 Agent，hello 的订阅在连接时固定。插件适配这些事实（未关联错误等待确认超时、同步后重连）；不修改 realtime.ts。详见 16。

维护者批准第二种连接方式 B（网页发起邀请）：已登录 human 的 `POST /api/device/invite` 返回绑定账号的十位数字一次性码及 ISO expiresAt，十分钟有效；Agent 经现有 `yonder channels login card --verify-code <code>` 无认证调用 `POST /api/device/redeem` `{code,name,kind}`，得到 deviceToken，复用私有保存、全 Agent 登记和连接，无需再次确认。card 的 verifyCode 在 start/poll 均走兑换，以兼容现有 CLI；404 invalid_code → invalid-code，429 rate_limited → retry-later，已有当前 endpoint 令牌则 already-connected、不消耗邀请码。原 start/confirm/poll 保留；邀请码与令牌均不得记录。新增替身测试仅为契约测试，不等于并行后端已联调。方式 A（浏览器 URL scheme/loopback 唤醒本地 Yonder）未实现，须先获维护者批准内核设计。

## D63 新建 Agent 默认窄权限 peer 协作（2026-10-24 主人批准）

选择方案 A：read/grep/skill_view/agent_ask、read/message，禁用工具搜索、插件及技能。init/create 共用生成器，置前 ephemeral peer binding，reply none；isolated 是严格布尔创建输入，保守拒绝可能接收 agent/agent 的显式 bindings。只复用模型参数，不继承主人的 defaults 上下文与提示覆盖；用现有 context 字段选内核内置双文件读取，不增加 schema、内核状态或可选插件依赖。工作区预加载也必须守 canonical 路径边界。旧配置不自动改；同一工作区不是私密文件隔离，旧宽泛 bypass 接收方仍有代理提权风险。人工迁移方案见 research/default-agent-peer-binding-design.md。

## D64 每条消息只问一个问题；记忆上手由对话 agent 逐来源推进（2026-10-24 维护者要求）

共同提示词增加一句：每条消息只问一个问题，其余决策排队，汇报也一次一件。memory-onboarding 改为与主人对话的 agent 按微信、聊天渠道、登记目录、节律的顺序逐个询问，进度写入记忆笔记以便跨会话继续；后台 memory-keeper 只执行不对话，因为主人的回复进入的是对话 agent 的会话。不改内核或 SDK，不新增机制。

## 2026-10-24 用户要求状态栏左右键统一菜单

移除左键直接展开交互窗口的动作，复用 NSStatusItem.menu 处理左右键；当前交互/历史仍从菜单主动打开，必要交互继续沿原有紧凑提醒入口呈现。

## D65 提示词去防御化，子会话继承发起方，运行可靠性修正（2026-10-24 维护者要求）

生产对话审计：Jarvis/Hermes 把主人的“去掉限制”读成“拆安全边界”并反复辩解，承诺“下一条讲”却没有任何机制兑现，同一问题五次追问，任务汇报退回备忘录体；子任务因预设少给工具白跑，交接被拒后悬了数小时，自动升级互相争用并打断运行，430 条 token 警告。决定：(1) 共同提示词与 jarvis/default-agent/任务正文直接重写，不加新 context：主人的指令即授权，不加警示与限制，边界由 harness 与系统承担，阻塞要立刻说明并绕行，只对不可逆且超出授权的花钱、公开发言、删数据提示一次；只在接手、阻塞、结果、需要主人拍板四处说话；“之后讲”必须有任务、续跑或计划任务支撑；一次一个问题并给默认；中文用日常语气，不带英文套话与私人比喻。(2) 子会话（task_run 与无身份预设）默认继承发起方的能力、工具、插件，预设只在显式写出时收窄，官方 default/coding/research 不再写白名单，嵌套限两层（03 §4）。(3) maxTokens 只计新输入与输出，不含缓存读写；停止提示给人读；剔除与主模型相同的回退项；agent_ask 被拒时说明缺少 peer 绑定并由 doctor 给出片段；飞书资源下载重试；升级单飞锁、自动升级等待运行中工作、通知只在终态发出。已有 home 预设里写死的 tools/capabilities 仍按显式收窄生效，需人工删除。

## 2026-10-24 权限入口继承可信内核续办来源（主对话批准）

修正 02 版本把全部输入限为直接账号消息的遗漏：仅 runtime.tool-result/runtime.continuation 可沿真实 parent 在同 agent/session/conv 中追溯 owner；64 跳上限，失败关闭。SDK EventQuery 增加可选精确 id，store 使用参数化 id = ?；不增加令牌、配置、模型来源参数或另一套授权。全部实际输入均须通过，访客、内部 Agent、混合输入与隔离保护不变；所有 OS grant 仍由人完成。

## 2026-10-24 统一实际 TCC 操作宿主并补文件访问（主对话批准）

同一 Yonder 签名 Helper 不仅发起申请，也执行需 TCC 的实际操作；本轮仅新增 owner 授权任务的一层文件列举和单普通文件导出，沿用稳定 bundle ID、安装路径与 LaunchServices。插件生成私有唯一产物，不接受目的地覆盖。Node/Python 不继承 Helper grant，不迁移全部插件、不增加 driver 或权限注册框架，OS 仍按资源种类分别授权。

## D66 统一任务账本作为官方插件 tasks（2026-10-25 主人批准）

背景：主人在飞书只有两个窗口，十几条任务线只存在于模型上下文里，串了、压缩了、做一半停了都无人知晓，Agent 之间互不可见。决定：(1) 官方插件 tasks，追加式账本，复刻 Codex `/goal`（持久目标、每次唤醒重现、软预算、完成前对照证据），不复刻已被业界默认关闭的 `update_plan` 清单；(2) 可见范围沿用能力模型：默认自己，主 Agent 加自己 sub-agent，持有 cross-agent 的配置档（管家，非新角色）可见全部并可催办；(3) 接受“滞留催办”等时点机制：带来源标记的输入，去重限频，不阻断、不截断，完成判定仍归模型；(4) 完成后复盘 / 留存为默认关闭的实验时点，复用 hermes-experience 静默复盘通道，按真实模型对照后再决定默认；完成后压缩待 context-keeper 提供 sessions.compact；(5) 展示分层：账本只产 TaskBoard，ui-companion 只做渲染渠道，IM 渠道用图片或文字，回复尾部清单经 beforeSend 程序化追加；(6) 底座提示词任务段同步修改，并更新本机常驻 Agent 的 AGENTS.md。规范见 [17](spec/17-task-ledger.md)，设计依据见 proposals/task-ledger。


## D67 插件可向打开的常驻会话投递系统提醒（2026-10-25 主人批准）

tasks 插件的滞留催办与管家催办需要唤醒任务所属的常驻会话，而插件 `sessions.submit` 原先只接受 task 会话。决定：仅插件路径（`submitFrom`）可向打开的 main/persistent 会话投递；复用原 `session.input` 落盘、当前 profile 与能力、busy 队列和重启恢复，事件来源 `plugin:<id>`，模型输入标注为系统提醒、不带人类授权；普通 `submit` 保持仅 task。不新增身份或授权机制。

## 2026-10-25 渠道实例最小作用域（主维护者批准）

Profile/defaults/preset 增加 `channelInstances?: string[]`。未配置保持旧版无限制兼容，不从 bindings 推导；显式空数组无实例，显式名单只允许名单内实例，admin/bypass 不越过。数组沿既有字段替换规则继承；子任务取父范围与 preset 范围交集，undefined 为交集单位元；创建时保存上限，恢复/重载不放宽。真实运行配置传入 ToolContext，SDK 提供共用实例授权判断，插件不读取 home。

带 ctx 的发送在 owner/person 候选账号选择前过滤范围，最终实例再次检查；通用 message_send/api.messages.send 与飞书 status/history/message/card/task-card（包括 rawSend）共用检查，在任何平台读取/请求之前拒绝。status 省略实例只列授权实例。保留 message 能力、history 来源/admin、卡片归属检查，不以事件来源推导范围，支持合法多实例与无 event 主动通知。

execution.resolve 返回可信 `ResolvedExecution`（能力与实例范围）；程序发送可传真实 `owner: ExecutionOwner`，核心核对存储会话归属并重新解析当前权限，不信任调用方自报范围，不伪造 ToolContext。cron 保留 job.owner 真实来源及 message 能力复核，创建/更新 delivery 与执行前共用实例检查，发送前核心再次复核；撤销后拒绝。无 owner/ctx 的原合法插件程序通知继续属于插件本身，不当作模型授权。不新增审批、身份系统或开关；此为受支持工具/API 的作用域，不是 macOS 沙箱。兼容代价：旧配置须人工填名单才隔离。


## 2026-10-25 Agent 运行概览与固定悬浮入口（用户要求）

复用原生任务、输入和流式回复快照，通过本机 service.info 聚合逐 Agent 状态；同一状态驱动唯一状态栏菜单、图标、浮球及浮窗概览。当前交互改名打开悬浮窗，保留左右键统一菜单。图钉保留桌面入口，移出/收起后回到同锚点浮球；未固定仍临时，默认完成自动收起。仅显示真实任务摘要及可见回复短片段，不复制转录、不新增调度器、不向 Agent 插件开放全局状态权限。

## 2026-10-25 共享权限 API 与薄服务宿主解耦（主对话批准）

复用现成共享 permissions registry、SDK/core 工具、native-automation provider 与真实 Runtime adapter 合同，从正式 .05 基线独立集成；不带入尚未收口的薄服务宿主及其清理补丁，不改服务启动链、安装或定位功能。它只统一既有权限入口与真实 ToolContext/session/profile/provider 校验，不建立新授权状态库、审批或原生架构。旧文件执行宿主任务中“不增加权限注册框架”的范围限制不再描述本次已批准的共享门面工作。发布、正式安装与真实 TCC 验收仍是分开的状态，本地专项通过不代替这些验收。

## 2026-10-26 Agent 云端头像（用户本轮授权）

Agent 身份增加可选 avatarUrl，name 继续复用原字段。配置校验仅接受公共 DNS 主机名的无凭据 HTTPS URL，渠道只同步 URL，网页服务端不接收图片二进制、不代理抓图。card 新客户端始终发送配置头像或 null（清除），旧客户端省略时保留原值。网页、名片与二维码复用该身份字段，加载失败恢复原默认图形；跨源二维码导出需图片源允许 CORS。代价：外部图源可失效，不保证离线可见。

## 2026-10-26 多设备执行 W0（父会话准入裁定）

采用独立无模型 execution-protocol，full SDK只重导出契约，不重构 pi 依赖。当前仅 W0 schema/标准 Ed25519 签名与本地契约测试；持久命令账本/设备锁、真实双端配对、插件、Card relay和平台包分别后续实施。只读状态查询按当前principal/device授权，不依赖旧session；running崩溃后unknown不自动重放；同home双daemon由执行端独占拒启。首版只做inventory/UI，已配对checkpoint restore/clone unsupported，不建外部epoch系统。Card v1中继可读正文，端到端签名不等于E2EE。见[18](spec/18-device-execution.md)。

## 2026-10-27 T63 模型账户选择配置（主对话批准）

公开 `SessionModels.credentialSlots?: Record<string, string>`，键为真实 provider id，值为非秘密 slot 名。defaults、profile、session 与按次 task_run 逐 provider 合并，显式 `default` 可覆盖继承值；模型及 fallback 仍使用原 provider/modelId，不新增 alias 或跨槽轮换。preset 只取自己的模型账户配置，不继承父映射。task_run 按次映射沿现有 effort 的结构化 session.input、重放与 admin 门槛进入运行快照，不增加授权机制。此条只定案配置与输入契约，凭据存储、认证与 runtime 绑定由对应实现负责。

## 2026-10-27 模型账号回退与冷却（主对话批准）

额度耗尽时同一个模型要能自动换用另一个账号，并且一段时间内不要反复用坏掉的模型重试。`fallback` 增加 `accounts`（同模型换槽）、`hold`（默认 600 秒）与 `probe`（默认 60 秒）：链按「主模型 → 同模型的其他账号 → 其他模型」展开，账号项在运行时用只读别名供应商 `<provider>#<slot>` 实现，别名不进配置、不改模型名。健康状态按 `provider/modelId@slot` 记在 `<home>/.yonder/model-health.json`，只把被持有的条目移到链尾，不重排其余条目；后台最小请求探测成功后立即恢复。不重放输入、不重跑工具、不新建队列或调度器；探测不落库、不计用量。代价：用量键会包含别名 provider，`hold` 期间该账号的额度恢复要靠探测才能被发现，探测本身也消耗一次极小请求。

## 2026-10-27 官方用量窗口与按槽停用线（主对话批准）

共享订阅的 5 小时窗口用完后所有请求都被拒，事后才知道太晚。供应商在正常响应里带回 `rate_limits`，运行时只读地取 5 小时窗口（`used_percent`/`window_minutes`/`resets_at`），按 `provider@slot` 落盘，配置档用 `fallback.quotaStopPercent` 给某个槽设停用线，达到即把该账号移到链尾，窗口重置后自动恢复。不新增轮询请求、不建第二个调度器、不复制转录；抓取挂在供应商事件观察上，观察失败不影响请求。失败冷却（`hold`）与官方配额是两套独立状态，前者靠探测恢复，后者靠 `resets_at` 恢复。代价：没有响应就没有新读数；供应商改字段时退化为只靠失败冷却。

## 2026-10-27 官方用量主动轮询（用户批准）

`fallback.quotaStopPercent` 存在时，运行时每 60 秒查询被设线账号的官方用量接口并写回 `model-quota.json`；未配置停用线时不轮询，上一条「不新增轮询请求」只保留在这个范围，正常响应里的 `rate_limits` 仍是另一条来源。轮询读取运行时已有的凭据槽 `<authPath>.slots/<provider>/<slot>.auth.json`，兼容 pi OAuth 与 Codex `auth.json` 两种结构；不另行登录、不复制或刷新令牌，过期或接口拒绝时跳过，不伪造读数。代价：每个设线账号每分钟一次 HTTP 请求；只有 Codex 客户端签发的令牌能通过该接口，pi OAuth 令牌缺少账号标识时无法读取。

## 2026-10-27 转换的 Codex 凭据自动刷新（用户批准）

转换到槽旁的 Codex 凭据约 10 天过期，原先用量轮询不刷新，过期后只能等 Codex 客户端续期。改为在用量读取这一条路径内自动刷新：访问令牌过期或距过期不足 60 秒时按 Codex 刷新协议（固定 `client_id`、`grant_type=refresh_token`、`scope` openid profile email）请求新令牌，用量接口返回 401 时强制刷新一次并只重试一次；刷新结果原地原子写回同一文件（0600、保留未知字段、`last_refresh` 使用注入时钟），写前重读文件并把同一路径的并发刷新合并为一次，避免重复轮换。pi OAuth 凭据仍不在这里刷新；刷新失败（网络、非 2xx、缺 `access_token`）按不可用处理，不抛错、不写文件。上一条中的「不刷新令牌」在转换的 Codex 凭据范围内由本条取代。代价：用量轮询可能自行轮换 refresh token，Codex 客户端或其他共用同一凭据的进程必须读同一文件才能保持一致。

## 2026-10-27 任务回报与确定性运行可见性（维护者批准）

task 最终回报使用 `STATUS: done|partial|blocked`、实际证据、剩余项与准确阻塞条件；空或 `NO_REPLY` 由内核返回 `STATUS: unknown (no report)`，原运行 status 不变，不加 outcome。task_run/agent_ask 简报说明覆盖目标、材料、边界、完成标准、阻塞条件、回传格式。后台续办结束且无新可见输出时，共享 delivery 用随 run.end 保存的持久意图与既有发送账本提供一次模板兜底；尊重静默绑定与非主人渠道，未知不重发。主人交互运行每静默五分钟确定性心跳，最多六次、可编辑则复用消息，复用软提醒计时，不唤醒模型。精确 luna/sol modelId 的短中文纪律段作为内置运行约定的末段（`runtime.discipline`）装入稳定 system，显式 `prompt.sections` 未列时不装入；不写本轮时间或计数。详见 03 §5.2.2/§8、06 §10；保留 D56 的 stdin 修复与无默认硬截止。代价：无 edit 的渠道每个活跃运行最多新增 6 条心跳、每次后台完成最多一条兜底；交付状态未知时主人可能收不到通知。

## 2026-10-27 自主决策、目标先行、够用就停（维护者批准）

日常常驻 agent 会把本可自己执行的权限与命令操作推给主人，让其等待数小时；对简单任务反复验证、独立审查、造一次性脚本与回执；钻牛角尖、无法收敛；没有目标与验收标准就连续运行数小时。共同底座因此补入这些规则：不把自己能做的事推给主人（只问主人独有的决定、凭据与必须在场的动作，附默认做法并继续不被阻塞的部分；确实需要人时一句话说明做不到什么、谁能做）；目标先行（目标、可观察验收、时间或轮次预算，软提醒即收尾信号，两个目标冲突时选一个并说明理由）；够用就停（验证一次用最便宜能失败的检查，文档不独立审查，已被检查覆盖的改动不再找人复核，并行工作线至多两条，状态表与“需要你”区块有内容才出现，不为一行台账单独发起模型调用，命令写明路径或超时）；典型死磕场景（小失败两次内修好、绕开或报告，新需求记录不实现，不为三行配置改动用候选/快照/回执的流程，等待通知而不是轮询）。本轮按当前 `content.ts` 的既有分节并入 `common.work`、`common.updates`、`common.autonomy`、`common.authority` 与常驻身份的目标句，不新增 section id；context-files 的 AGENTS.md 模板用途句提到目标与验收。不改工具、权限与内核行为。代价：底座多约 300 词；“两条工作线”“半小时内不前置调研”是经验阈值，需按真实对话调整；对话中未必处处守约，要靠真实运行观察。

## 2026-10-28 默认模型由配置给出，旧 home 缺字段沿用旧模型（PR #100 审查）

主人只配置模型；预设不带模型字面量，统一落到 `yonder.yaml` 的 `defaultModel`。`yonder init` 必须带 `--model`，把它写入该字段；没有任何模型来源且字段缺失时，解析时报中文配置错误并点名 `defaultModel`。旧 home 的处理选了加载器路径而非迁移命令：`yonder.yaml` 已登记 agent 却没有该字段，说明它早于本版本（此后 init 一定写入该字段），加载时把缺省视为升级前的 `openai/gpt-6-luna`，所以预设解析结果不变，不需要新增 `yonder migrate`（08 §1 本来也没有迁移命令）。代价：该常量只作为旧 home 兼容留在配置加载器一处；主人补写 `defaultModel` 即覆盖。
## 2026-10-27 渠道通知级别与入站通知（用户批准）

主人要求 QQ 私聊/群聊正式可用并带标注与通知、微信客户端消息进入渠道监听。按 `proposals/unified-client/research/C3-social-ux.md` §3.4/§5.3 采用三档级别 `all`/`mention`/`mute`，写进 `yonder.yaml` 的 `notifications`（默认级别 + 按 `conv` 覆盖），由节点侧判定并作为权威来源；`mention` 复用事件里已有的 `data.mentioned`，不新增字段。只有被绑定路由接纳的 `message.in` 与显式带字符串 `data.summary` 的插件事件产生 `yonder.notification`（走 `sessions.notify`，不唤醒 Agent、不进模型消息），`mute` 不产生记录但事件与未读照常累积；客户端在正查看该会话时抑制系统通知只是兜底。C3 明确先不做折叠群、关键词提醒、分时段免打扰与按渠道单设级别，本轮同样不做。详见 06 §9.1、08 §2。代价：每个入站消息在每个路由到的会话产生一条 entry；级别改动需要重启（随 `yonder.yaml` 其余字段）。

## 2026-10-27 QQ 渠道媒体、引用与发送间隔（用户批准）

主人要求 QQ 私聊与群聊正式可用。腾讯 SDK 1.0.4 已提供入站 `attachments`/`msg_elements` 与 `sendMedia`，插件此前的「只发文字」是插件层缺口而非平台限制，因此直接补在插件里：入站媒体映射为 `message.in` 的 `attachments`（`content_type` 决定 kind，只接纳 https URL，其他 URI 丢弃不猜测），引用回复原文取 `msg_elements[0].content` 写入新增的 `quote.text`（参考索引本身不含正文，缓存未命中时只有这一处来源），并进入本轮提示的 `quote:` 行；只有附件没有正文的消息不再被丢弃。出站接受 https URL 或绝对本地路径的 image/audio/video/file，音频按文件发送，不声称原生语音气泡；一次回复先发文字再逐条发媒体，复用被动回复的 msg_seq 计数。新增实例配置 `sendIntervalMs`（默认 500，0–60000 毫秒），所有发送与媒体上传经插件内串行间隔器，平台限流与 5xx 仍是 uncertain，不盲重发。重连继续由 SDK 的 ready/resumed/failed 状态机负责，不另建重试循环；媒体发送不携带 msg_seq 是已知限制。详见 11 §15。代价：媒体上传占用同一间隔队列，多附件回复会变慢。

## 2026-10-27 微信归档入站标注与提醒（用户批准）

主人要求微信客户端的消息能进入渠道监听。归档插件已经按会话批次发出 `wechat-archive.material`，但事件里没有可直接展示的发送人/摘要，因此补三处标注而不改事件类型：`channel: "wechat-archive"`、`conversation`、批次去重的 `senders`，以及一行 `summary`（单条 `发送人: 正文`，多条 `N 条消息（前三位发送人）：最后一条`，正文截断 60 字，纯媒体 `[<kind>]`，无正文 `[无正文]`；`media.kind` 为 `unknown` 时按无正文处理，因为 CLI 对未解析媒体统一给 unknown）。`summary` 只喂内核 `yonder.notification`，不替代正文，也不进模型消息。是否提醒由 yonder.yaml 的 `notifications` 按 `conv:wechat-archive:<chat>` 决定；微信批次没有 `mentioned`，所以 `mention` 级别对微信不提醒，需提醒用 `all`，这与 06 §9.1 的规则一致，不额外发明关键词提醒。监听保持只读：不新增发送工具、不自动回复，唤醒仍只由绑定决定（架构 5.2）。轮询间隔取自 `pollSeconds`，插件游标在私有 SQLite meta、源游标在稳定 consumer 名下，重启复用不重放。代价：摘要只有 60 字、只覆盖批次尾部，长批次要看 `messages`。

2026-10-28 回退顺序：先换模型再换账号（维护者 WIP 采纳）

## 安装根兼容（2026-10-28 主人授权）

安装根迁至 `~/.local/share/yonder/install`，旧 `~/.yonder-harness` 保留符号链接至少两个 minor（0.3、0.4）。迁移先预览，运行中拒绝执行，并支持同时回滚安装根与数据目录。

2026-10-28 console 隐式绑定视为已授权渠道（不受 channelInstances 限制）

## 2026-10-28 稳定性与兼容策略定为 spec/20（0.3 门槛）

0.3 起公共契约（home 布局、公开环境变量、命令与包名、插件 id、hash 路由、gateway 方法与事件、views、yaml 配置、state.db、apiVersion）只增不删，写入 `docs/spec/20-stability.md` 作为唯一权威。弃用的别名/shim 至少保留 2 个 minor（0.3、0.4），最早 0.5 移除，并要求运行时 warn 与 CHANGELOG 条目；破坏性变更必须先记 decisions，再升 protocol/apiVersion/schema_version 并提供 migrate。内容取自稳定化清单已定项，不改 contracts.md。代价：之后的改名与删除都要先走迁移流程，周期变长；golden 文件由 S-C02…S-C07 逐步补齐，在此之前部分冻结项只靠评审守护。

## 2026-10-28 插件 API 版本兼容规则（主人授权）

S-C05 将现有兼容规则补入 04 §6：缺省为 1，接受旧版本，跳过高于 SDK `API_VERSION` 的插件并记录错误，其他插件继续加载；非整数清单无效。此项记录已批准的稳定化规则，不增加新运行行为。

## 2026-10-28 独立 effort 命令（主人授权）

思考档位统一使用 `/effort [level|auto]`；旧 `/model effort` 保留兼容并提示新命令，至少保留 0.3、0.4，最早 0.5 移除。沿用现有权限和档位校准，不增加模型调用。

## 2026-10-28 参数化提示词模板（主人授权）

按 pi 的 Markdown 和参数替换语义提供斜杠模板，独立于管理角色与权限的 preset。先覆盖 home 与 Bot 的直接模板目录，并从共享输入路径展开；执行者、子 Agent 与插件层级仍需完成，不能据此声称已实现全部层级。

## 2026-10-28 子会话权限上限（主人授权）

子预设的插件、工具与 skills 不得超出创建时父会话及祖先上限；通配选择在实际名称上取交集，并保留非 main 常驻 Agent 的会话工具逐名限制。旧子会话没有保存 skills 上限，按空范围处理，避免恢复后扩大权限；需要 skills 的旧任务须重新创建。此项收紧原先可追加插件和覆盖工具的行为，不改变独立预设会话。

## 2026-10-28 任务项目规则（主人授权）

任务通用上下文通过新增可选 SDK 读取入口获取执行环境 cwd 祖先规则；宿主 pi 全局规则分开读取，不改变 Agent 人格工作区边界。单文件限 32 KiB、总计限 128 KiB 并标记截断；嵌套 worktree 遮蔽暂未覆盖。

## 2026-10-28 后台任务可视状态（主人授权）

保留共享后台执行与原生完成续办，增加按会话隔离的 `/bg`、日志及停止命令，并通过 console 的 rail 和 floating views 展示状态。重启后按持久记录如实展示，不重放外部副作用；代价是视图和命令需要使用同一会话作用域。

## 2026-10-28 O49 T11 项目规则补充（主人授权）

任务通过 `task-general` 读取宿主 pi 全局规则与实际执行环境 cwd 的祖先规则，按 pi 文件优先级加载并标注来源；按规范路径去重，单文件 32 KiB、总计 128 KiB。理由是让任务获得项目约束而不开放 Agent 人格工作区；代价是超限内容截断，且当前仅选中该上下文或主动使用入口的执行者生效。嵌套 linked worktree 遮蔽及跨工作区上下文去重尚未实现，详见 03 §11。

## 2026-10-28 O49 核心目录列表（主人授权）

按 pi 的 `ls` 提供只读目录列表，通过执行环境访问，继承现有工具选择与文件作用域；默认最多 500 项，截断时使用现有工具输出缓存。无需 shell 权限，也不新增缓存机制。

## 2026-10-28 O49 核心文件搜索（主人授权）

按 pi 的 `find` 提供只读 glob 文件搜索，通过执行环境访问，继承现有工具选择与文件作用域；默认最多 1000 项，截断时使用现有工具输出缓存。搜索遵守 .gitignore 并包含隐藏文件，依赖执行环境 PATH 中已有 fd 或 fdfind，不自动下载程序；未安装时返回错误。

## 2026-10-28 O49 按符号读取源码（主人授权）

可选 code-intel 复用 pi-lens MCP 的 `read_symbol`，与模块报告的符号和 callback handle 衔接；不建立第二套索引或编辑前置条件。工具输出沿用运行时截断和缓存，执行环境须安装 pi-lens。

## 2026-10-28 O49 社交增量契约（主 Agent 代批）

批准 channels-social 提案 §4–§8 的只增契约。direct 只沿现有 binding，不提升 write；profile 变化只影响新会话，现有会话保留固定 profile。旧无 notification 元数据发送保持原行为；新主动出口由 Agent 的 social.enabled opt-in，旧 home 默认关闭、新 init 明确开启，入站通知级别不变。关系不增加权限系统，插件 social.* 与核心路由事实各归其所有者。

控制面 scope_denied 映射 forbidden（data.reason），revision_conflict 映射已有 conflict 并返回当前 revision，unsupported_kind 映射 invalid_params（data.kind）；静态引用加载时检查，目标实例须属于 Agent 的 channelInstances，console 例外。增量契约不代表对应运行或真实渠道验收已完成。

CH-02 路由决定追加内核事件 `routing.social-decision`，以 parent 关联原始入站事件，data 记录 agent、reason 和 social 配置的 SHA-256 内容版本 revision（主 Agent 代批）。它只记录确定性路由事实，不复制转录或由插件伪写。

## 2026-10-28 O49 T08 插件委派入口（主 Agent 代批）

插件工具使用 `api.subagents.run(request, ctx)` 复用 `task_run`，绑定真实工具调用上下文，沿用既有权限上限、取消和 durable 子会话，不增加存储或独立授权。

## 2026-10-28 O49 诊断处理标记（主 Agent 代批）

可选 code-intel 按 pi-lens 4.4.6 的标记语义提供直接工具；defer 按 Yonder 会话隔离，suppress 需要写能力并写源码注释，其他持久标记与日志保存在项目作用域。pi-lens 未通过 MCP 暴露标记，使用最小 host-neutral 适配；不建立 Yonder 诊断总线，不复制 pi 事件总线或转录。单 path 诊断分析消费项目标记与当前会话延期；显式 LSP 探测不消费会话延期，不能声称所有诊断已自动过滤。

## 2026-10-28 O49 AST 结构搜索（主 Agent 代批）

可选 code-intel 复用 pi-lens 4.4.6 MCP 的 AST 搜索及其参数、分页、校验与读取位置，不新增 AST 引擎或索引。规则作为数据传递；执行环境、权限和长输出沿用现有边界。

**2026-10-28 O49 PT-P149 AST 替换（主 Agent 代批）。** 最小闭环仅支持当前执行环境的一个明确常规文件；通过 pi-lens 在临时副本预览和执行 AST 替换，应用前检查预览时文件内容和运行时写入保护；其他范围明确拒绝。文件校验与写入之间的外部进程竞态与现有 edit 相同，不称为跨进程原子操作。

## 2026-10-28 O49 T08 异步子任务（主 Agent 代批）

`task_run` 增加可选 async，复用已有 durable 后台句柄和自动完成回报；异步子会话保留以支持 `task_control` 查询、steer 与 resume，按发起会话隔离。同步默认语义不变；子任务结果通过既有工具输出缓存落盘，返回可选 resultFile。插件委派入口当前只支持等待。

## T09r2 学习复盘独立任务与模型来源（2026-10-28，主 Agent 代批）

学习复盘在前台会话关闭后继续执行；排队证据持久化并在重启后恢复，授权仍由插件在执行时重新检查。独立 task 通过 `sessions.open.modelSource` 只复制模型选择与凭据槽，不建立父子关系；模型按 profile cheap、simple、插件配置、主模型依次选择。状态面板与撤销能力采用插件 views 和私有变更记录。

## 2026-10-28 O49 PT-P119 可选咨询记录（主 Agent 代批）

采用独立 advisor 插件，通过 T08 的 `api.subagents.run` 复用原生任务，显式咨询后签发会话内 adviceId；自愿记录默认关闭，沿 pi reserve/commit/release 语义，插件私有状态只保存加盐哈希及结果。ID 保存在进程内，重启失效；不新增模型循环、转录或提醒系统。

## 2026-10-28：会话事件追踪（主 Agent 代批）

`sessions.trace` 只读扫描现有事件账本，以路由、事件 session 或 unknown 对应 attempt 的 session 关联会话；沿用会话权限，不推断无会话的事件归属。扫描分页可能返回空页与 next。

### 主 Agent 代批：任务模板层级

无身份任务按 preset 名称依次查找 `agents/<preset>/prompts/`、`presets/<preset>/prompts/`、home 和选中工具的插件目录；子 Agent 模板仅在已发现的 Markdown 定义 name 与任务 preset 身份相同时生效，模板目录不参与定义发现；常驻 Bot 的 profile 不映射到同名 preset。模板只展开输入，不改变权限；补全与展开复用发现和过滤。


### 2026-10-28：工具原文缓存补齐（主 Agent 代批）

网页文本响应超过 2 MiB 时通过 SDK 字节流缓存完整原文，提取只保留前 2 MiB，输出保留截断内容与读取路径（主 Agent 代批）。SDK 缓存 API 增加 golden。流式工具输出沿用会话缓存与索引，缓存失败不得声称原文可取回。


## 2026-10-28：默认工具按需加载（主 Agent 代批）

新建主 Agent 和未显式配置工具的配置档默认常驻 pi 的 read、write、edit、bash，其余已选且有权限的工具通过 search 加载。既有显式工具配置保持原样；不改变工具契约或权限。

## 2026-10-28：插件文件写入授权（主 Agent 代批）

插件需要逐个实际命中文件复用内核写策略时，工具上下文提供可选的 `authorizeFileWrite`；内核按当前运行配置检查写能力、真实路径及保护规则，插件再经执行环境写入。

**2026-10-28 CH-03r3 批次账本（主 Agent 代批）。** 社交路由在 batch 判定事实中附生效策略快照；social 插件读取既有事件账本恢复批次，并以 batch-read / batch-failed 记录游标和失败。触发仍由内核重验来源、授权与策略版本。按主人要求，未 @ 消息默认不运行：新增可选 batch.run，默认 false；仅显式 true 且没有 judge 时允许直接运行。judge 尚未实现时保留未读。

### CH-05r3 主动通知队列（主 Agent 代批）

用追加事件保存意图和终结事实，按 Bot/主人合并，默认每日一次，沿用现有投递或主会话 app-only 通知；发前逐条重查当前权限。投递前先记 attempted，崩溃可能留下未知结果，不自动重发。超过 maxItems 的意图保留至后续汇总。真实模型与外部渠道送达须另行验收。

### 2026-10-28：社交策略工具的确认与目标范围（主 Agent 代批）

社交工具的应用必须先在同一会话预览，再由主人单独发送“确认”或“confirm”；随后同参数应用。控制面由具有 owner 与 admin 的调用者显式传入 `dryRun: false` 应用。目标通过已有入站事实确定类型；个人策略目前作用于其具体私聊会话，不自动扩展到其他渠道。无法确定类型或验证授权时拒绝。

## 2026-10-28 DBG01r2 供应商 trace（用户批准）

本机验收可显式开启供应商请求与 SSE trace，以排查 OpenAI 兼容协议；限定 provider baseUrl，脱敏已知鉴权头、指定正文模式和已加载的 credential 值，文件限制权限并清理 24 小时前的 trace。只支持 openai-completions 和 openai-responses，禁止在正式 HOME 开启；其他协议暂不支持。
