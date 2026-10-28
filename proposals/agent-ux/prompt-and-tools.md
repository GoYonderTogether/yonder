# X02：提示词瘦身、工具标准与主管 Bot

状态：O49 授权范围内的设计提案及 terra 实现拆卡；本次不改运行代码、正式配置或冻结规范。2026-10-28。

依据：`yonder-lead/program/source/owner-messages.md` 的 O49 原文（256 行起）。主人要收短系统提示词，把工具规则放回工具，采用新的工具判断标准；Bot 负责沟通、规划和分派，能接收插话并继续原任务。19 项缺失能力全部有实现去向，Codex 作为可选插件。此处的 grok bot 是主人描述的交互目标，不声称已调研或复刻某个 Grok 私有实现。

## 1. 判断与范围

当前问题不是没有分段：`prompt/index.ts::systemPromptParts` 已有稳定 key，`runtime/prompt-sections.ts` 已按段 patch。问题是共同底座带了大量写作示例、工具操作教程和重复的交付/继续执行约束；没有选相关插件的执行者也负担这些文字。应压缩正文、移动归属，复用已有 offer/search 和 durable，不能再造提示词引擎或第二套任务系统。

三种产品角色不等于三种当前运行对象：主 Agent 有常驻身份；执行者是无身份 preset 会话；`task_run` 子 Agent 同样是 preset，附加父子生命周期和权限交集。不能用不同标题冒充三个不同的基线，不能把任务会话加上常驻人格。测量见 §6；工具逐项审计见 §7。

本设计对接已有 O49 卡：T03 管输入/插话/合并，T04 管后台状态，T05 管原文缓存，T08 管 pi-subagents，T10 管参数模板，T11 管项目规则，T13 管任务提醒，X01 管社交准入/通知。PT 卡只补明确的缺口或验收，不另写一份竞争实现。

## 2. 系统提示词的最小完整重写

### 2.1 常驻预算与归属

预算使用 §6 同一种 token 估算方法，约束官方模板的可见正文；用户文件只报告占用，不静默删截。工具 schema、动态 turn、上下文历史分别计费。上限是实现验收目标，不是已经达到的成绩。

| 段 | 上限 token | 装配条件与职责 |
| --- | ---: | --- |
| common.identity | 100 | 所有角色；Yonder 产品方向、个人 Agent、小内核/插件 |
| common.work + common.facts | 280 | 完成授权目标、复用、证据与未知；删除固定半小时/两次尝试/两条任务线等无场景门槛 |
| common.authority + common.autonomy | 240 | 来源不是授权、范围与秘密、未决高影响操作；不重复每个插件的登录流程 |
| common.updates + common.writing + common.visuals | 180 | 简明沟通、明确进展与实际产物；删长英文写作示范 |
| framework + runtime.events + runtime.delivery | 250 | 身份类型、可信 turn、自动回路、气泡和完成区别、保密路由 |
| resident.* | 300 | 仅常驻：连续身份、关系、主管式分派、已授权长期职责；任务不加载 |
| task 角色/最终报告 | 150 | 仅无身份任务：目标/边界/证据/剩余，STATUS 协议保留 |
| 官方个体模板（SOUL/AGENTS 合计） | 300 | 仅所选常驻模板；个人资料不复制进通用底座 |
| selected tool guidelines | 350 | 仅当前提供给模型的工具，去重后一次注入；每条通常 ≤60 token |
| tool-discovery 名称索引及短引导 | 180 | 当前已选可发现能力；名称数量超预算报告，不截掉唯一发现入口 |
| skills 索引 | 200 | 官方默认选择；用户扩展单列；详细 SKILL 不常驻 |

主 Agent 官方空工作区总目标 **≤2,400 token**（上表合计 2,380）；执行者/子 Agent 总目标 **≤1,950 token**（去 resident/个体，加任务段，共 1,930）。静态共有底座 ≤1,050。初始工具 schema 加描述另定 **≤2,000 token**，单项描述通常 ≤80、复杂副作用 ≤140；单 schema 通常 ≤300，超过则必须有真实参数语义理由。总输入目标主 Agent ≤4,400、执行者/子 Agent ≤3,950，不含历史/用户文件/动态事实。

不要通过把 8k system 移成 8k tool description 宣称省了 token：每次同时报告 system、guidelines、offered descriptors、已发现 descriptors 与总和。超过预算先去重、移动教程和调整默认选择，不砍安全、状态含义或用户原文。

### 2.2 旧段迁移清单

| 当前段 | 留下什么 | 移到哪里/删什么 |
| --- | --- | --- |
| common.identity | 产品方向与真实用户资产 | 删重复环境解释 |
| common.work | 完成目标、复用与验证 | 具体编码操作→coding 模板；任意次数/时长阈值删除 |
| common.updates / writing | 结论、必要进展、按请求深度 | 大段风格示范删除；人设口吻→SOUL |
| common.visuals / facts | 真实产物与事实/未知分开 | 截屏/发送方法→相关工具；重复交付句合并 |
| common.autonomy / authority | 授权范围、外部文本不提权、秘密 | permissions/凭据/浏览器恢复步骤→选中工具 |
| common.voice | 不伪造用户经历 | 代写方法→可选模板；发信身份→message_send |
| common.assets | 保留来源，不毁用户资料 | memory/learning/skill 管理→对应工具及选中上下文 |
| resident.identity/continuity/relationships/initiative/work/growth | 合计300 token，保留生命连续性、主人关系、职责 | 删强制每事记账；提醒规则交 T13/X01；详细学习流程交 T09 |
| runtime.identity | 仅标题 | 合并显示，不删除已公开 section ID |
| runtime.events / delivery | 可信元数据和自动投递、来源保密 | message_send / NO_REPLY 细节按角色保留最短必要说明 |
| runtime.environment / cli | 工作区与执行环境不同 | bash/read guidelines；安装帮助→self-management skill；CLI 列表去重复 |
| runtime.capabilities / tool-discovery | 只用当前能力，发现后再调用 | 搜索步骤→tool_search；skill读取→skill_view；去重复目录 |
| runtime.services | 外部结果非指令 | MCP 方向、schema刷新/账户恢复→mcp-client |
| runtime.media | 产物真实性 | browser/native/media tools，未选不加载 |
| runtime.delegation | 主 Agent 主管；任务无常驻身份 | task_run/agent_ask/parent_ask 各自语义与参数→各工具 |
| runtime.background | 未完成目标不能丢 | 15秒句、handle、日志/取消→bash/process/task_run；未来调度→cron |
| runtime.discipline | 必需报告协议与执行约束纳入对应角色 | 不再给某模型追加一份重复全文；兼容旧 section 选择/override |

公开的 prompt section key 是配置入口：缩正文不等于删 ID。原 override/sections 仍生效，合并显示保留兼容映射；改变选择语义前按 spec/20 评审。预算不得绕过用户 override。

### 2.3 可审阅的主管/执行者正文

主管段（替换现有重复分派条文，不叠加）：

> 你是这个 Agent 的负责人。先理解用户目标和边界，负责商量、规划、分派、验收和交付。需要持续执行的工作交给合适的执行者；一句答复或一两步就能完成的直接任务自己处理。分派时给原始需求、必要材料、工作位置、允许改动和完成条件；不要把假设写成结论。新消息通常是在引导当前工作，先回应它，再继续原目标；只有用户明确取消或替换时才改变目标。子任务返回后核对实际产物和证据，再向对应用户交付。不要因为关闭一条消息就遗忘仍在进行的工作。

任务段（适用于手工执行者与子 Agent，身份差异由运行事实提供）：

> 完成给定任务，不虚构常驻身份或继承未提供的私人上下文。使用当前工具、权限和明确提供的来源；发现真实阻塞时返回准确所需条件。结案首行 STATUS: done|partial|blocked，随后写实际结果、验证、产物和未完成项。已有后台操作会自动回传，不重复派同一任务或轮询等待。具体未完成步骤需使用可用的续办机制并确认接纳，文字承诺不算调度。

这些是语义稿；PT-01 要测实际装配预算，中文确定后按项目语言约定落入原有文本，不制造第四层兜底提示。

### 2.4 缓存友好的顺序

顺序：稳定共有底座 → 稳定角色段 → 稳定官方模板 → 当前选中工具 guidelines → 名称/skills 索引 → 用户工作区上下文 → profile.instructions；动态时钟/版本/来源/权限事实继续走 turn。保持稳定排序和 key，同一配置同一文件逐字确定。工具按固定名称顺序提供；延迟发现只增当前运行需要的 schema，不能每轮随机洗牌。

`prompt-sections.ts` 已有按 key patch，直接复用。插件 context 顺序若有语义，不为了缓存重排；profile.instructions 当前由 pi 后追加，不能重复拼接。新增 selected-guidelines 如需 SDK 字段，应为可选，缺省不改变已有插件行为；声明工具何时真正 offered 是 runtime 的责任，不能只看“包已安装”。缓存命中/首 token 延迟必须在同一模型同一输入重复请求实测，字数缩短不能冒称命中率提高。

## 3. 工具新标准

| 判定项 | 通过条件 | 不通过时最小动作 |
| --- | --- | --- |
| 名字 | 动作/对象明确；插件保留既有前缀 | 优先改说明；需新名则旧名 warn+shim 至少2 minor |
| 描述 | 说明何时用、关键引用、状态/副作用；不复述所有 schema | 一句用途+关键限制，教程放选中 guidelines 或按需 skill |
| 参数 | 必填只留执行必需；枚举明确；默认保持旧行为 | 删文案重复；不能删既有字段/收紧必填；复杂操作有独立权限时才拆 |
| 结果 | 默认有界、保留ID/状态/下一步；截断有原文可回读 | 统一接 T05；不让插件先丢原文再进共享截断器 |
| 错误 | 给真实失败阶段、可操作下一步，区分 denied/not-configured/not-found/unknown-result | 不暴露凭据；未知副作用先查状态，不自动重放 |
| 合并/拆分 | 同对象同权限同生命周期才合并；独立副作用或权限才拆 | process 的 status/log/write/kill 可共入口；任务账本和运行控制不可混成万能task |
| 延迟加载 | 冷门能力设 search；当前可发现名字可见；发现后再按schema调用 | 复用 catalog + tool_search，不造第二目录/语义搜索服务 |
| 可选插件 | 需要外部进程/专用服务/平台/个人账号 | 维持显式选中，安装≠启用；无此插件仍能正常聊天/基础编码 |

T05 原文目录沿用该卡 `<home>/cache/tool-output/<session>/` 设计，不另选路径。写原文必须在信息首次被截断前，先经过既有秘密脱敏/授权边界；索引不能保存 token 或私密参数全文。返回实际路径/大小/截断标记，read 分页与 grep 在对应执行环境中有效，跨 session/profile 不能因公共目录获得私密输出。默认7天/容量清理与失效说明由 T05 定契约；原文已清理应说明过期，不能装作从未有结果。此机制不缓存未授权的数据，也不凭空生成成功路径。

默认初始工具按角色：主管优先 task_run、必要消息/权限/发现入口；执行者优先 read/edit/write/bash/grep；它们都只在现有能力和 profile 允许范围内。这属于新官方模板默认选择建议，不自动收窄既有用户配置。task_run 不可用时主管做当前权限允许的工作并说明具体能力缺口，不能一律拒绝或声称已派活。

## 4. Bot 行为落在哪层

| 场景/规则 | 提示词责任 | 必须由运行时/渠道保证 | 对应卡 |
| --- | --- | --- | --- |
| 主管与小任务例外 | 理解目标、派活、验收；短任务直接做 | task_run 真正接纳、权限交集、父子取消、结果返回 | PT-01/T08 |
| 用户中途新消息 | 判断是补充、支线还是显式替换；响应后恢复目标 | 默认 steer，工具边界接纳，不因普通插话 abort 正在执行的副作用 | T03 |
| 明确 /stop、取消 | 尊重取消，不再承诺续跑 | 调用方有权取消且取消归其任务；报告可能已发生的副作用 | T03/T04 |
| 多条排队消息 | 同批处理，不只回答最后一条；冲突按时间和授权解释 | 同会话 drain all；保留原事件顺序、来源、reply route 与权限；不跨会话合批 | T03/X01 |
| 15秒自动后台 | 收到真实handle后可回应用户/做其他工作 | 共享长工具边界继续执行，持久状态、自动结果输入、去重，不依赖模型计时 | T04 |
| 回应后继续 | 主目标/下一步不丢；已有后台等待则不轮询 | background result / task_continue 已接纳才算续办；最终气泡不是目标状态 | T03/T04 |
| 主人跨渠道/授权群 | 不跨受众泄漏上下文 | 绑定、身份、级别、来源隔离与投递路由；群免打扰和筛选先用程序 | X01 |
| 无事提醒 | 无新信息不打扰，不为汇报而唤醒 | T13 汇总/免打扰，确定性筛选；判断模型只处理需判断事件 | T13/X01 |

“随时响应”不是零延迟承诺：普通 steer 在可安全注入的模型/工具边界消费；不可取消的外部副作用不能靠文本中断。15秒后台保证主管不被长工具持续占住，不代表所有工具都在15秒内完成。验收记录消息接纳、首次可见回应、子任务完成、最终送达四个时间，分别验证，不虚构统一毫秒SLA。

验收场景至少覆盖：空闲、生成中、工具执行中、待用户操作、后台中 × 单条、连发、跨渠道同会话、不同会话；显式取消另测。关键断言：子任务未被普通插话杀死；批次不漏原消息；权限不因合批取最大值；后台完成只回传一次；用户新问题有答复且原目标有最终交付。无真实渠道凭据只能声明临时HOME的CLI/gateway覆盖，不能称飞书/QQ/微信全通过。

## 5. 实现卡与次序

卡位于 `yonder-lead/program/agent-ux/O49/cards/`，均给 terra 执行：PT-01 提示词重写与预算；PT-02 工具描述/guidelines/选择装配；PT-03 工具输出和可操作错误接 T05；PT-04 主管插话/后台集成验收。19 个矩阵缺失项各有 `PT-Pnnn.md`，详见 `PT-README.md`。

先做 PT-01/PT-02 的官方空工作区闭环与量测，再对齐 T03/T04/T05/T08/T10/T11 已有产物，最后逐个加入可选插件。core find/ls 可以独立先做。code-intel 共享一个插件生命周期，不能19卡各起一套进程/索引；Codex三模板共享一个可选companion插件。实现时先查主分支最新状态，已有能力补缺和验收，不重写。

所有新增 SDK 方法、事件或配置先同步对应 docs/spec 或 contracts.md 与决定记录，再按 `UPDATE_GOLDEN=1` 的现有测试流程刷新相关 golden，普通模式复跑。0.3 后不得改旧必填、名字、类型；移除需至少2 minor 的 warn/shim/CHANGELOG。这里的“合并/删”只针对重复实现或默认暴露，不能授权即时删除公共工具。本提案不刷新 golden，因为未改任何契约或实现。

并行状态补记：写作期间主分支已经出现 `Tool.guidelines?: string[]`（sdk/types.ts）和 runtime 的 `toolGuidelines` 注册，`task_run` 已把两条规则移到 guidelines。PT-02 必须以开工时实现为准，验收实际 selected/offered 注入链，只补缺口，不能因本提案的基线较早而再造字段。以下基线是带来源哈希的时间截面，不是锁定当前分支的发行基准。

## 6. 系统提示词实测基线

口径：2026-10-28，临时 home /tmp/x02-home-CnyZYR；模型 siliconflow/deepseek-ai/DeepSeek-V3.2；官方 initHome 模板，无主人个性化工作区。调用真实 initHome / openKernel / plugins / systemPromptParts / skills.index / inspectToolCatalog；没有用正则猜提示词。字符为 Unicode code point；近似 token = ceil(UTF-8 bytes / 4)，不是 DeepSeek tokenizer 或计费 token；未安装 tiktoken，不加依赖。schema 列只计 JSON.stringify(parameters) 的紧凑 JSON，description 单独计；descriptor 包含 name/description/parameters，不计 provider protocol 包装。

三角色：主 Agent=initHome 的 main/jarvis owner；任务执行者=手工打开 default 无身份 preset；子 Agent=main/owner 作为调用方派发 coding preset：调用真实 presetSession(selected, env, parent.resolved, undefined, parent.agent)，再 presetProfile(...) 还原 task_run 写入运行状态后 sessions.resolveBaseSession 的配置解析路径；未执行 task_run。手工 sessions.open(coding) 只作附加对照，不等价于继承父级权限的子 Agent。default-agent 是额外常驻 Agent，不能当任务执行者。主和手工 coding 使用 source prompt 组装，default 与真实父级继承配置的 coding 用已构建 dist 函数补测（并行源码短暂缺 views/builtin.ts）；插件按 manifest 加载 dist，代表当前可运行注册内容，非所有 TS 均已重新构建。

### main

|段落|字符|近似 token|
|---|---:|---:|
|framework|1129|283|
|common-identity|863|218|
|common-work|2961|741|
|common-updates|2445|612|
|common-writing|3786|949|
|common-visuals|1790|448|
|common-facts|930|233|
|common-autonomy|3131|783|
|common-authority|3159|790|
|common-voice|814|204|
|common-assets|1533|384|
|resident-identity|418|105|
|resident-continuity|685|172|
|resident-relationships|1092|273|
|resident-initiative|1183|296|
|resident-work|1445|362|
|resident-growth|412|103|
|runtime-identity|17|5|
|runtime-events|1591|398|
|runtime-delivery|1946|487|
|runtime-environment|1760|440|
|runtime-capabilities|1774|444|
|runtime-services|1348|337|
|runtime-media|1432|358|
|runtime-delegation|3625|907|
|runtime-background|2464|616|
|cli|981|246|
|skills|2324|649|
|context-jarvis-soul|2355|590|
|context-jarvis-work|4337|1085|
|profile.instructions|0|0|
|完整 system 合并文本|53788|13520|

starting 工具（catalog 可见）35 个：description 2715；parameters schema 3966。
工具名：model_route, message_send, parent_ask, agent_ask, task_continue, task_run, session_list, session_read, identity_lookup, identity_link, permissions, skill_view, process, grep, read, write, edit, learning_memory_read, learning_memory_edit, learning_skill_store, learning_memory_pending, learning_refine, learning_review_memory_read, learning_review_memory_edit, learning_review_skill_store, tasks_open, tasks_update, tasks_done, tasks_list, tasks_get, tasks_nudge, tasks_show, onboarding_probe, onboarding_record, bash

目标 2400，相对当前 system 近似减少 82.2%。

### task-default

|段落|字符|近似 token|
|---|---:|---:|
|framework|1206|302|
|common-identity|863|218|
|common-work|2961|741|
|common-updates|2445|612|
|common-writing|3786|949|
|common-visuals|1790|448|
|common-facts|930|233|
|common-autonomy|3131|783|
|common-authority|3159|790|
|common-voice|814|204|
|common-assets|1533|384|
|runtime-identity|17|5|
|runtime-events|1591|398|
|runtime-delivery|1946|487|
|runtime-environment|1760|440|
|runtime-capabilities|1774|444|
|runtime-services|1348|337|
|runtime-media|1432|358|
|runtime-delegation|3625|907|
|runtime-background|2464|616|
|skills|2324|649|
|context-task-general|5801|1451|
|profile.instructions|0|0|
|完整 system 合并文本|46742|11758|

starting 工具（catalog 可见）10 个：description 1118；parameters schema 1093。
工具名：message_send, parent_ask, task_continue, task_run, identity_lookup, permissions, skill_view, process, grep, read

目标 1950，相对当前 system 近似减少 83.4%。

### delegated-coding

|段落|字符|近似 token|
|---|---:|---:|
|framework|1297|325|
|common-identity|863|218|
|common-work|2961|741|
|common-updates|2445|612|
|common-writing|3786|949|
|common-visuals|1790|448|
|common-facts|930|233|
|common-autonomy|3131|783|
|common-authority|3159|790|
|common-voice|814|204|
|common-assets|1533|384|
|runtime-identity|17|5|
|runtime-events|1591|398|
|runtime-delivery|1946|487|
|runtime-environment|1760|440|
|runtime-capabilities|1774|444|
|runtime-services|1348|337|
|runtime-media|1432|358|
|runtime-delegation|3625|907|
|runtime-background|2464|616|
|cli|981|246|
|skills|2324|649|
|context-task-general|5801|1451|
|context-task-coding|9378|2350|
|profile.instructions|0|0|
|完整 system 合并文本|57196|14377|

starting 工具（catalog 可见）16 个：description 1515；parameters schema 1578。
工具名：message_send, parent_ask, task_continue, task_run, session_list, session_read, identity_lookup, identity_link, permissions, skill_view, process, grep, read, write, edit, bash

目标 1950，相对当前 system 近似减少 86.4%。

### 默认 home 已注册工具逐项量

|工具|提供方|description 近似 token|parameters 近似 token|descriptor 近似 token|
|---|---|---:|---:|---:|
|model_route|core|89|129|231|
|message_send|core|153|234|400|
|parent_ask|core|65|30|108|
|agent_ask|core|212|178|402|
|task_continue|core|45|30|88|
|task_run|core|436|383|832|
|session_list|core|19|73|105|
|session_read|core|17|51|82|
|identity_lookup|core|31|25|70|
|identity_link|core|19|49|82|
|permissions|core|90|102|205|
|skill_view|core|17|40|70|
|process|core|174|103|288|
|grep|core|32|70|113|
|read|core|75|76|162|
|write|core|32|57|100|
|edit|core|82|194|287|
|interaction_present|interaction|154|23|192|
|interaction_result|interaction|75|36|125|
|web-tools_search|web-tools|21|148|184|
|web-tools_extract|web-tools|49|74|138|
|web-tools_fetch|web-tools|64|49|127|
|learning_memory_read|learning|16|34|65|
|learning_memory_edit|learning|49|152|217|
|learning_skill_store|learning|52|412|480|
|learning_memory_pending|learning|35|44|95|
|learning_refine|learning|45|35|94|
|learning_review_memory_read|learning|41|34|92|
|learning_review_memory_edit|learning|41|152|210|
|learning_review_skill_store|learning|41|412|470|
|channel-card_card_push|channel-card|38|104|158|
|cron_manage|cron|113|657|783|
|cron_exec|cron|115|657|784|
|tasks_open|tasks|108|181|302|
|tasks_update|tasks|77|204|294|
|tasks_done|tasks|107|83|202|
|tasks_list|tasks|50|19|83|
|tasks_get|tasks|13|33|59|
|tasks_nudge|tasks|55|48|116|
|tasks_show|tasks|40|50|103|
|onboarding_probe|onboarding|57|16|87|
|onboarding_record|onboarding|72|172|260|
|mcp-client_stdio|mcp-client|280|343|637|
|mcp-client_http|mcp-client|280|343|637|
|memory_status|memory|33|16|62|
|memory_capture|memory|46|90|150|
|memory_search|memory|45|197|256|
|memory_read|memory|53|72|137|
|memory_plan|memory|25|416|454|
|memory_review|memory|26|301|340|
|memory_me|memory|34|300|347|
|memory_import|memory|35|64|112|
|memory_bootstrap|memory|38|155|207|
|bash|core|228|61|300|
|todo|core|117|262|390|
|tool_search|core|85|55|154|

注意：此表覆盖默认 home 加载插件 36 个工具 + 20 个核心工具，动态外部 MCP 与未加载可选插件不在此表。todo 在实测时 runtime 注册已存在，而 inspectToolCatalog 尚未列入；model_route 已列入且 main exposure=offer（此前草稿把两者混写，已纠正），starting 数字不冒充完整 provider request；schema 总量独立列全，实施卡应让 inspection 与运行注册同源。

### 证据与限制

基线脚本 /tmp/x02-measure.ts；启动器 /tmp/x02-load.mjs；原始组装文本和 schema /tmp/x02-raw.json；default 补测 /tmp/x02-default.mjs；工具补测 /tmp/x02-extras.mjs。全部只写临时 home，不改仓库与主人 home。首次可用 source 快照成功：main 30 段、default-agent 29 段、coding 23 段；default 22 段；父 main → coding 24 段（继承 exec，因此 cli 和 bash 均存在）。

初始脚本失败记录：模块路径解析 1 次；siliconflow 未注册 1 次；yaml CJS 导入 1 次；新增 executor 尚未刷新 skills 配置 1 次；todoTool 导出路径误指 2 次；并行源码 views/builtin.ts 暂缺 1 次。均为测量程序/环境失败，不计产品模型测试失败。未运行仓库完整测试套件（只读基线任务）。

额外常驻 default-agent：13489 token（分段之和）。

### 源文件 SHA256（报告生成时；并行 main 可能继续变化）

- `packages/core/src/prompt/content.ts`: `a87e2d33c9287bf87bbd86a8ef6a24c039e7da1de7b711736d027dca608ac24e`
- `packages/core/src/prompt/index.ts`: `c926db9f55b45ac0c4571b57096ca0666a9eb830b57f0272111a96565bcb9f57`
- `packages/core/dist/prompt/content.js`: `f05528c2e8c68f45ad4ce57b3c62c13764de4e82335e82cdc6c6b3bac27ec347`
- `packages/core/dist/prompt/index.js`: `b3fbc6cbfa27698678ae57637abc478b84bd5c82a67690a33c827678ab2ca58f`
- `packages/core/src/runtime/catalog.ts`: `98eb504f8ff2355f35504509a55d77eb8ee08413e48e0af5f8a38522f6b05911`
- `packages/core/src/runtime/process.ts`: `4e138a079fadf15ab043caab9e3962a4f69ad15c01d188e5d2411f981fc1c4d7`
- `plugins/agent-presets/dist/index.js`: `2222296fcaf6f7df70e1b802e084643eab5b835ea2796a0fbd062ec85a4fed0c`
- `plugins/agent-presets/prompts/tasks/general.md`: `89efde5eba5594bf589be84e91208bf7ab95f8f64b358ed2d8c535a3a8f81189`
- `plugins/agent-presets/prompts/tasks/coding.md`: `bdbdfa9fe0a9afb85fd7f71ea1b376be30f3be64540c774a1f056057e9c19753`
### 真实模型运行

1 次真实会话通过、0 失败、0 跳过：`agent-network run -- node /tmp/x02-live.mjs` 使用同一临时 home 打开 `default` preset，模型 `siliconflow/deepseek-ai/DeepSeek-V3.2`；session `16` 返回 `status=done`，文本为 `STATUS: done\nX02_BASELINE_OK`。原始结果在 `/tmp/x02-live-result.json`。只从主人 home 读取 siliconflow 默认凭据槽，复制该 provider 到临时 home 的 0600 auth 文件；未打印、未写主人 home，未调用主人运行服务。本次只证明官方系统与起始工具 schema 能被真实 provider 接受并完成回复，不证明委派、工具执行或瘦身后的行为保持。

真实调用完成后已删除临时 home 的凭据副本；非秘密配置、原始测量结果与会话数据留作复核。

### 非秘密复测流程示意

以下从仓库根执行；要求当前 checkout 已按仓库流程构建（本次 source/dist 混用的限制见上文），只新建临时 home，不读取主人 home 或凭据、不调用模型。此命令示意重建三角色 **system** 基线（需先在临时 home 配置该 provider 的非秘密模型定义；整段命令未另行试跑）；用同一 `parts` 输出逐段表。工具完整注册量由独立全插件注册表给出，不能把 catalog 当完整 schema；读取 schema 时从实际注册的 `Tool.parameters` 序列化，禁止用正则估算。

```sh
node --input-type=module <<'JS'
import { mkdtemp } from 'node:fs/promises';
import { initHome } from './packages/core/dist/kernel/index.js';
import { loadYonderConfig, loadPresets, presetSession, presetProfile }
  from './packages/core/dist/config/index.js';
import { loadPlugins } from './packages/core/dist/plugins/index.js';
import { inspectionServices, loadAgents, profileFor, filesFor, skillsFor }
  from './packages/core/dist/kernel/workspace.js';
import { systemPromptParts, toolDiscoveryGuide } from './packages/core/dist/prompt/index.js';
import { inspectToolCatalog } from './packages/core/dist/runtime/catalog.js';
const home = await mkdtemp('/tmp/x02-repeat-');
await initHome(home, 'owner', { model: 'siliconflow/deepseek-ai/DeepSeek-V3.2' });
const config = await loadYonderConfig(home);
const plugins = await loadPlugins(home, config, inspectionServices(home, config, () => {}));
const agents = await loadAgents(home, config, plugins);
const presets = new Map([...plugins.presets, ...await loadPresets(home)]);
const main = profileFor(home, config, agents.get('main'));
const makeTask = (id, parent) => {
  const preset = presets.get(id);
  const env = parent?.resolved.env ?? 'local';
  // Mirrors task_run's captured capability/channel scope and the subsequent session resolver.
  const scope = presetSession(preset, env, parent?.resolved, undefined, parent?.agent);
  return { agent: null, profile: id, cwd: parent?.cwd ?? home,
    resolved: presetProfile(preset, env, scope.capabilities, scope.inherit,
      scope.channelInstances, config.defaultModel) };
};
const skills = skillsFor(home, config, plugins, () => {});
const tokens = text => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
for (const [role, session] of [['main', main], ['task-default', makeTask('default')],
    ['delegated-coding', makeTask('coding', main)]]) {
  const catalog = inspectToolCatalog(session, plugins.tools);
  const parts = await systemPromptParts({ ...session, id: role }, {
    contexts: plugins.contexts,
    workspace: s => filesFor(home, config, plugins, s.agent),
    skillIndex: s => skills.index(s),
    toolIndex: () => toolDiscoveryGuide(catalog),
  });
  const text = [...parts.map(p => p.text), session.resolved.instructions].filter(Boolean).join('\n\n');
  console.log(JSON.stringify({ role, model: session.resolved.model,
    capabilities: session.resolved.capabilities,
    parts: parts.map(p => ({ key: p.key, chars: Array.from(p.text).length, tokens: tokens(p.text) })),
    total: { chars: Array.from(text).length, tokens: tokens(text) },
    starting: catalog.filter(t => t.exposure === 'offer').map(t => t.name),
  }));
}
console.log('Non-secret temporary home:', home);
JS
```

真实测得的父 main → coding 配置包含 `read, write, exec, network, message, cross-agent, admin`；完整 system 为 **57,196 字符 / 14,377 近似 token**。catalog 起始 16 工具，其中包含 `bash`，`agent_ask` 因无 Agent 身份被排除。description 1,515、parameters 1,578；第三角色预算 1,950 对应下降 86.4%。额外手工 coding 对照仍为 56,121 字符 / 14,108 token；它没有 opener，不能拿其工具面代表 `task_run` 子 Agent。

### 全部插件真实注册 descriptor 估算补表

测量日期：2026-10-28。方法与角色基线一致：`ceil(UTF8 字节数 / 4)`；description 单独计数，schema 使用紧凑 `JSON.stringify(parameters)`，descriptor 使用紧凑 `{name,description,parameters}` JSON。不是供应商 tokenizer 的精确 token，不含网络协议封装；分列独立取整，所以 description + schema 不必等于 descriptor。

使用实际 `loadPlugins` / `inspectionServices`，逐个加载仓库插件 manifest 指定的现有 dist entry；不同插件单独加载以避免 learning 与旧别名共享 context 的注册冲突。没有调用任何工具、模型、渠道 start 或 trigger start。HOME 和 plugin data 均位于临时目录 `/tmp/x02-all-home-cBMFQS`；memory 配置指向该目录内空 memory 根，iLink 仅提供临时初始化已有的 person:owner 身份引用。没有使用主人服务或凭据。core 复用角色基线真实构造函数 descriptor（含 model_route、permissions、todo、process 与 tool_search）。

这是当前已构建包的真实 schema，不是源码正则猜测；并行源码修改是否已进入 dist 未逐文件重建，因此与源码审计表有时间差，应在 PT-01 验收以同一 commit 的构建重测。注册成功不代表外部服务可用或运行验证。

合计 **120** 个 descriptor（含 8 个 hermes-experience 兼容别名）；去除兼容别名为 **112** 个。这些是插件全集库存，不会同时注入单一角色。

| 插件/核心 | 工具数 | 描述估算 | schema 估算 | descriptor 估算 |
|---|---:|---:|---:|---:|
| agent-presets | 0 | 0 | 0 | 0 |
| browser-skill | 9 | 844 | 5366 | 6346 |
| channel-card | 1 | 38 | 104 | 158 |
| channel-cli | 0 | 0 | 0 | 0 |
| channel-feishu | 5 | 765 | 762 | 1606 |
| channel-github | 9 | 426 | 450 | 1023 |
| channel-mcp | 0 | 0 | 0 | 0 |
| channel-qq | 1 | 154 | 16 | 184 |
| channel-wechat-ilink | 3 | 306 | 267 | 625 |
| clipboard | 5 | 334 | 482 | 884 |
| codex-tools | 4 | 405 | 123 | 585 |
| context-files | 0 | 0 | 0 | 0 |
| core | 20 | 2018 | 2202 | 4469 |
| cron | 2 | 228 | 1314 | 1567 |
| devices | 9 | 501 | 654 | 1279 |
| hermes-experience | 8 | 320 | 1275 | 1741 |
| interaction | 2 | 229 | 59 | 317 |
| learning | 8 | 320 | 1275 | 1723 |
| mcp-client | 2 | 560 | 686 | 1274 |
| media-tools | 2 | 228 | 121 | 383 |
| memory | 9 | 335 | 1611 | 2065 |
| native-automation | 2 | 931 | 707 | 1670 |
| onboarding | 2 | 129 | 188 | 347 |
| secrets | 0 | 0 | 0 | 0 |
| tasks | 7 | 450 | 618 | 1159 |
| web-tools | 3 | 134 | 271 | 449 |
| wechat-archive | 7 | 348 | 547 | 1001 |
| **总计（逐工具求和）** | **120** | **10003** | **19098** | **30855** |

| 工具 | 描述估算 | schema 估算 | descriptor 估算 |
|---|---:|---:|---:|
| agent_ask | 212 | 178 | 402 |
| bash | 228 | 61 | 300 |
| browser-skill_bookmarks | 99 | 369 | 483 |
| browser-skill_extensions | 107 | 228 | 351 |
| browser-skill_file | 79 | 377 | 471 |
| browser-skill_inspect | 88 | 872 | 975 |
| browser-skill_interact | 91 | 1723 | 1830 |
| browser-skill_page | 66 | 809 | 889 |
| browser-skill_session | 105 | 271 | 391 |
| browser-skill_setup | 146 | 183 | 344 |
| browser-skill_tabs | 63 | 534 | 612 |
| channel-card_card_push | 38 | 104 | 158 |
| channel-feishu_card | 134 | 105 | 254 |
| channel-feishu_history | 59 | 96 | 171 |
| channel-feishu_message | 210 | 201 | 427 |
| channel-feishu_status | 102 | 26 | 143 |
| channel-feishu_task_card | 260 | 334 | 611 |
| channel-github_comment | 42 | 60 | 118 |
| channel-github_create_pr | 48 | 104 | 168 |
| channel-github_read_issue | 36 | 44 | 96 |
| channel-github_read_pr | 52 | 39 | 107 |
| channel-github_read_release | 46 | 43 | 105 |
| channel-github_repository | 46 | 39 | 102 |
| channel-github_status | 34 | 29 | 79 |
| channel-github_update_schedule | 75 | 46 | 138 |
| channel-github_update_status | 47 | 46 | 110 |
| channel-qq_status | 154 | 16 | 184 |
| channel-wechat-ilink_login | 117 | 62 | 196 |
| channel-wechat-ilink_message | 93 | 179 | 290 |
| channel-wechat-ilink_status | 96 | 26 | 139 |
| clipboard_capture | 70 | 34 | 118 |
| clipboard_copy | 88 | 197 | 298 |
| clipboard_drop | 48 | 36 | 97 |
| clipboard_list | 39 | 19 | 72 |
| clipboard_paste | 89 | 196 | 299 |
| codex-tools_js | 142 | 60 | 216 |
| codex-tools_js_reset | 35 | 16 | 66 |
| codex-tools_search | 58 | 31 | 103 |
| codex-tools_status | 170 | 16 | 200 |
| cron_exec | 115 | 657 | 784 |
| cron_manage | 113 | 657 | 783 |
| devices_apps | 37 | 65 | 116 |
| devices_cancel | 39 | 77 | 129 |
| devices_close | 53 | 80 | 146 |
| devices_describe | 46 | 48 | 108 |
| devices_execute | 92 | 143 | 249 |
| devices_list | 75 | 19 | 108 |
| devices_observe | 46 | 80 | 140 |
| devices_open | 58 | 65 | 137 |
| devices_status | 55 | 77 | 146 |
| edit | 82 | 194 | 287 |
| grep | 32 | 70 | 113 |
| hermes-experience_memory_edit | 49 | 152 | 219 |
| hermes-experience_memory_pending | 35 | 44 | 97 |
| hermes-experience_memory_read | 16 | 34 | 67 |
| hermes-experience_refine | 45 | 35 | 96 |
| hermes-experience_review_memory_edit | 41 | 152 | 213 |
| hermes-experience_review_memory_read | 41 | 34 | 94 |
| hermes-experience_review_skill_store | 41 | 412 | 473 |
| hermes-experience_skill_store | 52 | 412 | 482 |
| identity_link | 19 | 49 | 82 |
| identity_lookup | 31 | 25 | 70 |
| interaction_present | 154 | 23 | 192 |
| interaction_result | 75 | 36 | 125 |
| learning_memory_edit | 49 | 152 | 217 |
| learning_memory_pending | 35 | 44 | 95 |
| learning_memory_read | 16 | 34 | 65 |
| learning_refine | 45 | 35 | 94 |
| learning_review_memory_edit | 41 | 152 | 210 |
| learning_review_memory_read | 41 | 34 | 92 |
| learning_review_skill_store | 41 | 412 | 470 |
| learning_skill_store | 52 | 412 | 480 |
| mcp-client_http | 280 | 343 | 637 |
| mcp-client_stdio | 280 | 343 | 637 |
| media-tools_audio_transcribe | 54 | 48 | 119 |
| media-tools_image_generate | 174 | 73 | 264 |
| memory_bootstrap | 38 | 155 | 207 |
| memory_capture | 46 | 90 | 150 |
| memory_import | 35 | 64 | 112 |
| memory_me | 34 | 300 | 347 |
| memory_plan | 25 | 416 | 454 |
| memory_read | 53 | 72 | 137 |
| memory_review | 26 | 301 | 340 |
| memory_search | 45 | 197 | 256 |
| memory_status | 33 | 16 | 62 |
| message_send | 153 | 234 | 400 |
| model_route | 89 | 129 | 231 |
| native-automation_browser | 191 | 241 | 448 |
| native-automation_desktop | 740 | 466 | 1222 |
| onboarding_probe | 57 | 16 | 87 |
| onboarding_record | 72 | 172 | 260 |
| parent_ask | 65 | 30 | 108 |
| permissions | 90 | 102 | 205 |
| process | 174 | 103 | 288 |
| read | 75 | 76 | 162 |
| session_list | 19 | 73 | 105 |
| session_read | 17 | 51 | 82 |
| skill_view | 17 | 40 | 70 |
| task_continue | 45 | 30 | 88 |
| task_run | 436 | 383 | 832 |
| tasks_done | 107 | 83 | 202 |
| tasks_get | 13 | 33 | 59 |
| tasks_list | 50 | 19 | 83 |
| tasks_nudge | 55 | 48 | 116 |
| tasks_open | 108 | 181 | 302 |
| tasks_show | 40 | 50 | 103 |
| tasks_update | 77 | 204 | 294 |
| todo | 117 | 262 | 390 |
| tool_search | 85 | 55 | 154 |
| web-tools_extract | 49 | 74 | 138 |
| web-tools_fetch | 64 | 49 | 127 |
| web-tools_search | 21 | 148 | 184 |
| wechat-archive_history | 53 | 58 | 127 |
| wechat-archive_media | 56 | 45 | 116 |
| wechat-archive_message | 42 | 45 | 102 |
| wechat-archive_policy | 65 | 273 | 353 |
| wechat-archive_search | 42 | 71 | 128 |
| wechat-archive_sources | 45 | 39 | 99 |
| wechat-archive_status | 45 | 16 | 76 |
| write | 32 | 57 | 100 |

未测/排除：ui-companion: no package.json。ui-companion 无 package.json，不能测注册 descriptor；secrets 实际注册零工具。所有外部工具的真实执行均未测，本任务仅统计注册。

## 7. 逐工具审计与 19 项能力落点

### 7.1 范围与证据

审计来自当前工作树源码（首次记录 HEAD `160745a0066ad49b8db8cda2e5fde56f4bfdaefc`），包括 `packages/core/src/tools/`、`packages/core/src/runtime/` 与全部 `plugins/*/src` 的 `.ts`/`.mjs` 注册点；逐一展开动态名称。`model_route` 确认由 `createCoreTools` 返回；`permissions` 由 kernel 注入；`todo` 由 runtime 注册 `yonder.todo`，并非文档推测。下面来源列省略 `plugins/` 前缀；插件工具默认来源 `src/index.ts`，learning 为 `src/index.mjs`。这是一份设计建议和静态证据，不能证明工具当前被某 profile 选中、已配置或已真实运行。并行任务可能继续改变工作树。

“保留”仍遵循 T05 共享截断与原文索引，不代表不用改公共输出层。“可选”指按 profile 选择和 tool_search 延迟发现，不是卸载。“合并候选”须先证明参数、权限、原生回复关联和返回值等价，新增入口后保留旧名至少两个小版本。没有依据为凑分类删除现有工具；首先删重复描述和不必要的常驻 offer。

### 7.2 核心工具

| 工具 | 来源 | 结论 | 理由/动作 |
|---|---|---|---|
| read | runtime/pi coding tools | 保留 | 文件读取、分页和图片沿原生语义 |
| write | runtime/pi coding tools | 保留 | 完整写入与局部编辑职责不同 |
| edit | runtime/pi coding tools | 改 | 按 pi 提高编辑可靠性，未匹配/多匹配错误给下一步 |
| bash | runtime/process.ts | 改 | 精简描述，保留 stdin、15 秒后台、完整日志入口 |
| grep | runtime/grep.ts | 保留 | 文本搜索独立；有界匹配与完整结果索引 |
| tool_search | runtime/durable | 保留 | 仅发现实际授权工具，发现不扩权 |
| process | runtime/background.ts | 保留 | status/log/wait/write/kill 属同一句柄生命周期，不拆五工具 |
| todo | runtime/todo-tool.ts | 保留 | 会话内步骤唯一入口，短请求不强制建账 |
| message_send | tools/index.ts | 保留 | 跨渠道统一主动发送；来源和气泡语义留工具说明 |
| agent_ask | tools/index.ts | 改 | 明确常驻 Agent 经绑定与临时执行者区别，说明后台回收 |
| parent_ask | tools/index.ts | 保留 | 只读分身求助有独立权限边界 |
| task_run | tools/index.ts | 改 | 对齐 pi-subagents 的委派和结果设计，沿 durable 子会话 |
| task_continue | tools/index.ts | 保留 | 持久续办接纳不是自然语言承诺 |
| session_list | tools/index.ts | 改 | 分页短摘要，不默认返回全会话对象 |
| session_read | tools/index.ts | 改 | 指定范围、分页转录和原文索引 |
| identity_lookup | tools/index.ts | 保留 | 查询与身份写入分离 |
| identity_link | tools/index.ts | 保留 | admin 写操作，不合成权限含混工具 |
| skill_view | tools/skill-view.ts | 保留 | 正文按需，索引不展开所有 skill |
| permissions | tools/permissions.ts | 保留 | 权限观测/请求说明归此处，不铺满 system |
| model_route | tools/model-route.ts | 改 | 只推荐不切模型，alternatives 有界，排序细节移指南 |

### 7.3 插件工具

| 工具 | 来源插件 | 结论 | 理由/动作 |
|---|---|---|---|
| browser-skill_setup | browser-skill | 改 | 冗长连接恢复分支移已有 recovery reference，保留共享 daemon 边界 |
| browser-skill_session | browser-skill | 改 | 短描述保留 owned session/后台窗口/关闭语义 |
| browser-skill_page | browser-skill | 保留 | 导航与等待同类，超时必须真实 |
| browser-skill_inspect | browser-skill | 改 | HTML/console/network 有界，图片保留 capture_id |
| browser-skill_interact | browser-skill | 改 | action 专属字段明确，fresh refs 与未知副作用不可删 |
| browser-skill_tabs | browser-skill | 保留 | 借用/归还用户 tab 的授权独立 |
| browser-skill_file | browser-skill | 保留 | 上传/下载有独立外部影响 |
| browser-skill_bookmarks | browser-skill | 可选 | 现有 owner opt-in，默认不 offer |
| browser-skill_extensions | browser-skill | 可选 | profile 管理影响，默认不 offer |
| channel-card_card_push | channel-card | 保留 | 仅自身名片草稿，不等同发消息 |
| channel-feishu_status | channel-feishu | 改 | 诊断保留，长恢复教学放返回 guidance 或 skill |
| channel-feishu_history | channel-feishu | 改 | 分页默认短，保留消息/线程 ID 和原文 |
| channel-feishu_message | channel-feishu | 合并候选 | 普通投递归 message_send；replyTo 未等价前保留 |
| channel-feishu_card | channel-feishu | 保留 | 原生卡片语义独有，模板详情按需 |
| channel-feishu_task_card | channel-feishu | 可选 | 用户明确需要状态卡时选入，勿自动推送账本变更 |
| channel-github_status | channel-github | 保留 | 配置/策略诊断 |
| channel-github_read_issue | channel-github | 改 | 默认摘要，评论分页、正文缓存 |
| channel-github_comment | channel-github | 合并候选 | 与 message_send 契约/权限等价后折叠 |
| channel-github_repository | channel-github | 保留 | 准确仓库和分支元数据 |
| channel-github_create_pr | channel-github | 保留 | PR 创建不是消息投递 |
| channel-github_read_pr | channel-github | 改 | 默认元数据；patch/commits/checks 按需和缓存 |
| channel-github_read_release | channel-github | 改 | 短摘要+发行原文入口 |
| channel-github_update_schedule | channel-github | 可选 | 运维 profile 专属 |
| channel-github_update_status | channel-github | 可选 | 与 schedule 成对发现，保留版本核验 |
| channel-qq_status | channel-qq | 保留 | 渠道诊断按需 |
| channel-wechat-ilink_status | channel-wechat-ilink | 改 | 保留配对/recipient context 差异，恢复长文移 guidance |
| channel-wechat-ilink_login | channel-wechat-ilink | 可选 | onboarding/运维时发现，普通会话不常驻 |
| channel-wechat-ilink_message | channel-wechat-ilink | 合并候选 | message_send 覆盖相同投递与回执后折叠，保留兼容 |
| clipboard_copy | clipboard | 保留 | 引用化复制，秘密不进模型原文 |
| clipboard_paste | clipboard | 保留 | typed destination 是安全边界，不改任意命令 |
| clipboard_list | clipboard | 保留 | 仅作用域元数据 |
| clipboard_drop | clipboard | 保留 | 删除句柄独立于复制粘贴 |
| clipboard_capture | clipboard | 保留 | TTY ticket 的秘密输入不能改聊天问答 |
| codex-tools_status | codex-tools | 可选 | 外部 bridge 状态 |
| codex-tools_js | codex-tools | 可选 | 外部 app-server 计算机能力，不做核心依赖 |
| codex-tools_js_reset | codex-tools | 可选 | 与 js 同生命周期 |
| codex-tools_search | codex-tools | 可选 | 替代搜索 provider，不与 web-tools 无条件重复 offer |
| cron_manage | cron | 改 | action 条件字段清楚，调度不等于模型唤醒 |
| cron_exec | cron | 保留 | 命令调度有独立 exec 边界 |
| devices_list | devices | 保留 | 设备元数据发现 |
| devices_describe | devices | 保留 | 能力详情按需 |
| devices_apps | devices | 保留 | 应用目录有界 |
| devices_open | devices | 保留 | 设备会话开始 |
| devices_observe | devices | 改 | 默认观察有界，保留截图与原始引用 |
| devices_execute | devices | 保留 | 执行命令 grant 不因省 token 削弱 |
| devices_status | devices | 保留 | 执行端权威回执 |
| devices_cancel | devices | 保留 | 取消与关闭语义不同 |
| devices_close | devices | 保留 | 会话资源关闭 |
| interaction_present | interaction | 保留 | 人类交互入口，描述不铺窗口实现细节 |
| interaction_result | interaction | 保留 | 异步人类结果，不变成隐式长等待 |
| learning_memory_read | learning | 保留 | 精选 Agent 记忆与主人资料库不同 |
| learning_memory_edit | learning | 保留 | revision 和原子操作保留 |
| learning_skill_store | learning | 改 | 按 action 精简，批处理/归档说明移指南 |
| learning_memory_pending | learning | 保留 | 提案与已应用记忆区分 |
| learning_refine | learning | 保留 | 真正用户 /refine 约束归工具层 |
| learning_review_memory_read | learning | 可选/内部 | 只授予 active grant review preset |
| learning_review_memory_edit | learning | 可选/内部 | 普通 Bot 不 offer |
| learning_review_skill_store | learning | 可选/内部 | 普通 Bot 不 offer |
| hermes-experience_memory_read | hermes-experience | 保留兼容 | learning 实现的旧命名 alias，不双重 offer |
| hermes-experience_memory_edit | hermes-experience | 保留兼容 | 同上，按既定弃用窗口移除 |
| hermes-experience_skill_store | hermes-experience | 保留兼容 | 同上 |
| hermes-experience_memory_pending | hermes-experience | 保留兼容 | 同上 |
| hermes-experience_refine | hermes-experience | 保留兼容 | 同上 |
| hermes-experience_review_memory_read | hermes-experience | 保留兼容/内部 | 旧名保留，仍仅 active grant |
| hermes-experience_review_memory_edit | hermes-experience | 保留兼容/内部 | 同上 |
| hermes-experience_review_skill_store | hermes-experience | 保留兼容/内部 | 同上 |
| memory_status | memory | 保留 | 私人资料库准备状态 |
| memory_capture | memory | 保留 | 来源引用和隐私边界 |
| memory_search | memory | 改 | 短匹配/索引，保留来源时间 |
| memory_read | memory | 保留 | 已有 12000 字符分页，统一索引不重复复制主人文件 |
| memory_plan | memory | 改 | 修周/月路径实际问题，提交边界保留，详细指南按需 |
| memory_review | memory | 保留 | 原始正文与整理状态分离 |
| memory_me | memory | 保留 | 证据和 supersede 历史 |
| memory_import | memory | 可选 | 迁移/回填时发现 |
| memory_bootstrap | memory | 可选 | 初始化审计时发现 |
| mcp-client_stdio | mcp-client | 改 | action 字段明确，外部 schema/instructions 按需 |
| mcp-client_http | mcp-client | 改 | 同上，保留传输配置边界 |
| media-tools_image_generate | media-tools | 保留 | 有效配置才选用，返回真实产物 |
| media-tools_audio_transcribe | media-tools | 改 | 长转录缓存+分页，不吞原文 |
| native-automation_browser | native-automation | 改 | 收紧 action 字段，详细指南按需，避免双浏览器默认 offer |
| native-automation_desktop | native-automation | 改 | 包含权限/位置/文件 action，保留各自授权和 OS 状态 |
| onboarding_probe | onboarding | 可选 | 仅 onboarding profile |
| onboarding_record | onboarding | 可选 | 不给日常会话注入管理 schema |
| tasks_open | tasks | 改 | 普通执行用 todo，跨会话长期事项才建账 |
| tasks_update | tasks | 改 | 保留状态操作，移除重复工作方法训令 |
| tasks_done | tasks | 改 | 取消强制条数和逼拆 follow-up 的设计，保留真实交付/未完项；走稳定性流程 |
| tasks_list | tasks | 改 | 默认短状态/next step，不默认全对象 |
| tasks_get | tasks | 保留 | 详情/历史按需 |
| tasks_nudge | tasks | 可选 | 主管显式追问；关闭时间驱动骚扰由 runtime/config 负责 |
| tasks_show | tasks | 可选 | 用户要求看板才发送 |
| web-tools_search | web-tools | 改 | 默认数量/摘要有界，保留 URL/时间/原文 |
| web-tools_extract | web-tools | 改 | T05 缓存正文，返回有界正文+读取入口 |
| web-tools_fetch | web-tools | 保留 | HTTP 原文与正文抽取不同，统一缓存 |
| wechat-archive_status | wechat-archive | 保留 | 采集准备不冒充完整历史覆盖 |
| wechat-archive_sources | wechat-archive | 保留 | 来源元数据分页 |
| wechat-archive_history | wechat-archive | 改 | 有界分页+原文，保留 chat/message ID |
| wechat-archive_search | wechat-archive | 改 | 有界结果和继续 cursor |
| wechat-archive_message | wechat-archive | 保留 | 已发现消息的单项读取 |
| wechat-archive_media | wechat-archive | 保留 | 真实媒体状态，不冒称理解 |
| wechat-archive_policy | wechat-archive | 保留 | expectedVersion/silent 与身份权限区别不可删 |

无 Agent 模型工具贡献：`agent-presets`、`context-files`、`channel-cli`、`channel-mcp`（MCP server 的外部协议工具不算当前模型 offer）。审计时 `secrets/src/{vault,use,find-put}.ts` 注册函数为空，不能宣称有可用工具；`ui-companion` 未找到 package/src。旧 `docs/plugins.md`、`docs/reference.md` 有滞后：learning 迁移、tasks_nudge/show、permissions/model_route/todo 等以实时源码为准。native-automation 当前还包含 permission-request/guide/watch、location-*、file-list/export，不能沿旧文档宣称仅只读权限探针。

### 7.4 matrix 中恰好 19 项缺失能力

来自 `program/agent-ux/inventory/matrix.md` 状态严格等于“pi 有 Yonder 未实现”的 19 行。该标签是历史清单，不是实时未实现证明；执行卡开始时核对并行落地情况，复用已有实现。

| ID | 能力 | 实现落点与验收重点 |
|---|---|---|
| P-001 | codegraph_explore | 可选 code-intel 包装 codegraph status/explore；索引新鲜才查，失效明确返回，不注入全图 |
| P-048 | find | core runtime 适配 pi 原生 glob 查找；执行环境/read 能力、有界列表和完整结果 |
| P-052 | ls | core runtime 适配 pi 目录列表；类型/范围/截断保持 pi 交互 |
| P-119 | record_advisor_outcome | 可选 advisor 插件按 adviceId 记录采纳与验证；SDK 事件/插件数据，不混入 tasks 或重建会话 |
| P-129 | codex:adversarial-review | 可选 Codex 插件的参数化 slash 模板；复用桥接、保留许可，结果回原任务 |
| P-130 | codex:rescue | 同一可选插件，受控上下文传递，不默认接管主会话 |
| P-131 | codex:review | 同一可选插件，review 返回结果，不变成审批阻塞 |
| P-148 | ast_grep_outline | code-intel 适配 pi-lens/ast-grep；选定文件/层级大纲 |
| P-149 | ast_grep_replace | code-intel AST 改写；write 能力、范围、预览及可操作错误 |
| P-150 | ast_grep_search | code-intel AST 搜索；语言/范围/模式沿 pi-lens，结果有界 |
| P-151 | effective_config | code-intel 实际语言服务器/项目配置，只读排障按需 |
| P-152 | lens_diagnostic_mark | code-intel 稳定诊断 ID 标记；标记不冒充修复编译错误 |
| P-153 | lens_diagnostics | code-intel 真实 LSP 诊断/文件版本，默认相关文件和严重项 |
| P-154 | lsp_navigation | code-intel 定义/引用等 action；不向 core 塞 LSP 服务 |
| P-155 | module_report | code-intel 单文件符号结构报告 |
| P-156 | project_report | code-intel 有界项目摘要，不常驻注入 |
| P-157 | read_enclosing | code-intel 按位置读包围符号，返回范围/版本/原文 |
| P-158 | read_symbol | code-intel 按符号读取，同名消歧明确 |
| P-159 | symbol_search | code-intel 符号搜索，共享 pi-lens 索引/LSP 生命周期与版本 |

code-intel 覆盖 13 项（codegraph 1 + pi-lens 12），只做一个可选插件；保持每个工具的明确 schema 和公开语义，不用一个无约束 `code_intel(action, ...)` 隐藏 13 套参数。插件只依赖 SDK，第三方设计/实现按许可移植或通过 CLI 适配，不 import pi 运行包、不新增第二套会话持久化。

## 8. 本次交付验证与未完成项

- 文档覆盖：matrix 精确19项与 PT-P* 卡逐项匹配，19/19；24个PT文档（23张卡+索引）相对Markdown链接通过。全部是待实现方案，未改任何代码或冻结契约。
- 真实模型：临时HOME，siliconflow/deepseek-ai/DeepSeek-V3.2，1通过/0失败/0跳过；只证明现有默认task可回复，未证明本设计瘦身、子Agent实际执行或跨渠道交互。
- 相关Vitest：`npx vitest run packages/core/src/prompt/index.test.ts packages/core/src/prompt/official-prompts.test.ts packages/core/src/runtime/catalog.test.ts packages/core/src/runtime/prompt-parts.test.ts`：4文件中3通过1失败；19测试中16通过、3失败、0跳过，3个 official-prompts 用例均30秒超时，总165.96秒。未修改断言、延长超时或用重跑覆盖原始结果。
- `npx tsc -b` exit 2：并行工作树 SDK SessionsAPI.fork 调用方尚未补齐，delivery/sourceMessageId exactOptionalPropertyTypes 与stream类型、model-chain.test order、views/index.test参数等错误。均非本次文档路径，未改他人代码。
- `node scripts/check-file-size.mjs` exit 1：sessions/index.ts 512行、sdk/types.ts 502行新增超限；runtime/index.ts +62、kernel/index.ts +9、cli/terminal.ts +1 超基线。这是检查当时快照，不声称最终主分支仍有这些问题。
- `npx biome check proposals/agent-ux/prompt-and-tools.md` exit 1，处理0文件；当前Biome不处理该Markdown路径，不能写“lint通过”。文档另用ID/链接校验及 `git diff --check` 检查。
- 未运行完整build/全仓测试或正式安装；文档未新增依赖，未启动主人服务，临时凭据副本已删除。工具全集只注册未执行；外部MCP动态工具schema、渠道真实发送、缓存命中率及瘦身后的模型质量待PT/T卡实测。

最小后续：PT-01/02在同一构建commit重测完整provider请求（包括guidelines、runtime追加工具及协议开销），避免本轮并行source/dist差异；随后PT-04证明真实主管委派/插话/交付。不能把这些未完成的实现验收写成X02设计已经提供的能力。
