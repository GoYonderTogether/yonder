# 本机发布、真实渠道与 Cloud 连通验收

用户授权：把既有 Harness 共享修复发版并更新本机；用本人原话在真实飞书和 QQ 群验收，失败继续修复；同时查本机与云端控制台连接问题。实现必须依赖通用架构和约束，不修改 Bot 私有人设来制造通过。

## 行为契约与架构归属

| 边界 | 共享责任 | 验收证据 |
|---|---|---|
| 接入与默认值 | 渠道声明可信身份/目标/能力；创建与绑定解析只补已准入范围的机械缺件，显式禁用/隔离/自定义优先 | 真实渠道输入、绑定及所选profile |
| 请求与授权 | 事件账本保存原话，parent/后台沿持久来源核验原请求者；主会话接办而不自我转交 | 原输入→批次→协助→实际main/profile |
| 配置对象 | 当前home/Agent/profile来自运行事实；本机只读检查延续执行对象，显式覆盖与跨home边界优先 | 配置回执实际目标与运行会话一致 |
| 配置事务 | 共用候选校验、版本核对、原子发布、同步接纳与条件恢复；保存不等于接纳 | validate/update、reload、有效读回 |
| 群隔离 | 群保留独立per-conv上下文与受限能力，管理工作通过主协助；不将私人main历史暴露给群 | session/profile事实及群发言回执 |
| 交付 | 接收入账、模型运行、公开回复、平台送达分别记录；不靠口头完成或固定口令 | 新普通非@入站→实际run→送达或明确不回复 |
| Cloud | 消息设备连接与主人工作控制分开核验；协议支持只取真实hello和当前设备peer | 真实认证、deviceId、workProtocol及工作RPC/WS |

不新增审批平台、配置DSL、转录库或额外Agent协调框架；沿既有插件、控制面、运行时与发布流程执行。单次模型成功不替代跨入口约束；真实平台验收不由本地录制transport替代。

## 初始状态与发布范围

- 本地源码初始4e1c77ed，主分支比远端29 ahead/26 behind；远端main为7f165c8c、最新正式版v0.3.26110203。保留双方提交，正常merge后重新验证，不reset/force push。
- 本机初始正式服务0.3.26110111、来源commit5146e71e35fe3e261ecb0fcbb97abf96fbb35d95、ready=true。正式home为~/.local/share/yonder/home。
- 两份其他会话未提交cron设计先保留原始diff并仅stash对应tracked路径，.cache不纳入发布。
- 候选doctor发现gpt-senpai三条自定义群相关路由中的两条明确拒绝：群导向私人main；旧批次入口也需同步隔离。必要迁移仅改这些binding，复用既有群会话155642/profile qq-gpt-senpai-group，保留私人主会话/历史、人设、其他配置。不是新增Bot特例，源码共享接纳性约束仍负责阻止重复写入。

## 真实平台输入

在已授权的真实QQ工作群和飞书验收群，以主人原有口语提出“工作群接办”“每条接收但不必回复”“改好后发一条消息”等需求，分开发送；QQ使用客户端真实成员选择@，不写假@文本。普通非@消息继续使用同一语言风格，不包含CLI、字段、路径、回执标记或配置算法，不发送虚构的工作安排。

完整原话、私人群名、目标引用、原生消息ID及本机证据另存本机0600验收记录，不随源码发布。原始观察群绑定只记录，不预先替Agent配置目标后宣称自然需求成功。

## 检查与失败保留

合并候选build/typecheck通过。首次完整Vitest为2570通过/5失败/107跳过；涉及social group-controls、group-rules的Unicode VM预算及native-automation/device/gateway超时，单文件定向复查均通过。没有更改断言或VM预算，以并行资源争用为可检验假设，完整低并发复测另记。lint和Node检查通过，Node为65/65。

## Cloud取证与当前状态

- 主Agent用已登录Chrome实际验收 `https://yonderbot.net/work`：`GET /api/devices` 返回200，当前设备 `online:true, workProtocol:1`；`bots.list`、`capabilities.get`、活动/会话列表RPC均200。打开贾维斯真实会话后连接状态正常，加载了历史正文并显示正常 token footer，非离线缓存。当前Cloud工作台可用。
- 用户于2026-11-02确认此前失败的入口就是 `https://yonderbot.net/work`，现在已恢复。当时错误与中断原因仍无证据确认，不能把恢复解释为已定位根因或已证明版本不匹配。
- 线上 nginx 将 `yonderbot.net` API 转到18051的 `yonder-card-dev.service`（active）；18050的 `yonder-card.service` 当前failed，但不是这个域名的API目标。只读SSH核对了18051实际工作桥源码及路由，桥代码与本地当前实现一致；本机安装版工作桥完整，设备凭据GET `/api/session` 成功，4个未归档Agent的主人映射均匹配。真实登录浏览器也已证明当前设备宣告并支持 `workProtocol:1`。服务版本号与Harness号属于独立产品版本，不据此判不兼容；server `/api/version` 与静态 `/build-version.json` 报告的commit均不在本地 `yonder-card-web` git对象中，且后端RELEASE元数据不能与线上源码对应，属于发布来源可追溯性缺口，不是当前连接故障证据。
- 不执行云端重启、重绑或生产迁移。后续正式发布时以干净完整commit构建，并让后端 `RELEASE`、静态 `build-version.json` 和发布manifest共同记录该commit及产物哈希；部署后核对运行目录产物与manifest及两个公开版本端点。域名切换或恢复18050服务另待明确运维目标。
- 排查中一次过宽的配置搜索让一项token进入工具记录；已停止宽上下文读取。本文不保存秘密值，不擅自轮换或重绑影响其他服务。

## 新发现与已执行迁移

- QQ迁移前备份为`~/.local/share/yonder/home/.yonder/backups/gpt-senpai-agent-pre-group-isolation-2026-11-02T05-34-50-943Z.yaml`（0600），沿agents.validate→update取得valid/saved/accepted=true、restartRequired=false，复用既有群会话155642。只改三条binding，原match/id/顺序/reply/busy与其他配置保留。SHA256由5d31ca6f…566fcd变为b94445fb…378a594；候选doctor随后ok:true/errors:[]。
- 02396a22修复真正共享缺口：仍真实发出的旧channel-qq.group-batch纳入socialBindingIssues同一群隔离校验。拒绝main/非per-conv/自动群最终投递，保留合法旧wake:write；11/11定向回归通过。启动、管理写入与watcher共用parse入口，不按Bot ID/群ID打补丁。
- 合并提交2ef3295d完整低并发测试通过：474文件通过/66跳过，2575用例通过/107跳过，共2682；首轮默认并发5项失败保留，不将低并发结果写成默认并发首次全绿。build/typecheck/lint通过，Node65/65。新增兼容校验后的检查及官方CI另记。

## 发布与安装（已完成的一轮）

- 候选16643295d2f5adab3d6db41ec0d7bde7df7d8f75经[正式CI](https://github.com/GoYonderTogether/yonder/actions/runs/41398994924)四平台通过后，[发布流程](https://github.com/GoYonderTogether/yonder/actions/runs/41400320128)公开[v0.3.26110204](https://github.com/GoYonderTogether/yonder/releases/tag/v0.3.26110204)，tag为13e0445b9115b48fa47074eafcbe74c0ce97ce4d，41项附件核对完成。
- 本机运行v0.3.26110204/13e0445b，service ready=true，飞书4实例连接、QQ4网关ready。首次更新自动核验因重启窗口ECONNREFUSED记failed-or-unknown；后续原生verifyRelease追加verified回执01M6DFH5CCZNMFWAWPTT3K0Z5X，没有重复安装。原生安装锁在首次安装未结束时拒绝了重复请求，未绕过。
- Cloud静态工作台沿[现有部署流程](https://github.com/GoYonderTogether/yonder-cloud/actions/runs/41401129000)更新同一tag；/version.json与/build-version.json均200且版本/commit一致，/与/work为200，98项入口及引用资源检查通过。仅静态前端部署，不代表后端发版。
- 本轮真实聊天暴露了下列新缺陷，完整交付仍未通过。后续修复尚未发布，不能以这一轮安装成功代替群聊验收。

## 真实QQ：授权接办与执行路径失败

上述三句原话分别发送，另经原生成员选择真实@GPT学姐唤醒。入站01M6DFMDW5RRYT1RV1DGB6SPYG、01M6DFPN…KCTV、01M6DFRWCRQ2AJ6BQWJPT7Q83T及01M6DFV1RXZY8GZ3DSEYBD2KMW进入既有155642群会话；普通消息经过write与batch，不是丢失入站。

parent_ask正确进入同一Agent的main150858/default，而不是全局main Agent。该主档standard具exec且实际提供bash，但模型没有选用CLI管理路径，仍把不支持的群→私人main共享解释为需要再确认隐私，未完成其余可行配置；配置保持基线。跨会话通知还错误沿用了另一目标的消息引用，不能用未送达通知证明平台不支持主动发言。保存证据于.cache/qq-real-acceptance-20261102/evidence.json（目录0700、文件0600），不提交原会话秘密。

共享修复b43ed554给出真实env/exec/CLI管理路径事实，并让跨目标引用错误说明正确恢复方式；不提升权限、不静默删参数，不修改Bot人设。通用指引明确main属于当前Agent、工作能力不等于共享私人历史，先完成已授权可行部分。尚待下一正式版与真实群复验。

## 真实飞书：找到目标但拒绝重载后误报完成

用已登录主人飞书网页版从Jarvis私聊发送：

> （真实群名与主人原话保留于本机验收记录；公开文档不复制私人对话。）

输入01M6DH3JE0T23MF6D5NRGDM2QF进入main/session2/owner。模型自行搜索并调用channel-feishu_chats，唯一匹配真实群名、chatId和conv，真实目录发现通过；用户消息没有提供技术操作知识。原生桌面输入中已有用户草稿，保留草稿，后续采用后台网页版，不覆盖用户输入。

模型随后直接写agent.yaml，新增精确群binding及profile，没有调用官方validate/update。config.reload事件01M6DH5E5PSAAQDKZMNQ492RM9明确ok:false：与泛用feishu-observer可能同会话却不同profile；运行时仍保留observer/session2017。模型仍向主人成功发出“配置好了”（<native-message-id>），故判定失败，没有目标群新的run/送达验收。限范围证据.cache/feishu-real-acceptance-20261102/evidence.json（0700/0600）。

新根因：每轮模型缺少原生接纳状态；管理patch在合并前解析被拒绝的磁盘配置，连撤销修复也被同一语义错误阻止；顺序路由与跨profile冲突校验对精确群覆盖的契约存在缺口。正在补共享状态与修复路径，不靠预先配好群伪造自然需求通过。

失败候选已保守撤销：写前核对完整候选哈希，结构差异仅为新增binding/profile；保留0600候选备份，通过已安装WorkspaceFiles恢复原基线，读回SHA精确一致，正式解析器与doctor通过。正式agents.show仍只有原feishu-owner/feishu-observer，目标session2017仍open/observer；这不是新配置验收。候选原本未接纳，恢复后签名与旧有效快照一致，watcher沿same-signature路径不产生新成功事件，符合现有逻辑。

取证中曾误将EventQuery.after当时间戳且读取旧分页，因而误报本日无事件；已撤回。按精确ID只读查询正式.yonder/state.db的y_events，确认上述入站及拒绝reload均存在。分页游标和时间条件不能互换。

本地待发布修复：0e6ef6a9使管理patch可修语义非法映射并在写前复核源未变（定向2/2）；2215e418增加每请求动态接纳事实、源字节回执及candidate聚合状态；审阅发现初始化前捕获watcher导致永远unknown，e297462改为每请求getter，动态sections定向合计4/4。源码定向与正式安装分开记录，尚未宣称下一版或真实需求成功。

## 后续共享修复与真实入口差异

- 40e7a99b：飞书真实群目录只读工具，沿现有平台list接口、read/network/admin及实例范围，支持有界分页/名称过滤，输出真实name/chatId/conv与重名/截断。定向4/4、插件tsc、Biome通过，已随v0.3.26110204安装，且上述真实API调用已通过。
- afe81ff9：工作页UpdateNotice复用已有appUrl，根路径检查/version.json、Gateway挂载检查/console/version.json；两挂载的组件回归2/2、Biome通过。
- 原生浏览器访问 https://yonderbot.net/console/，真实JSON403为forbidden/host not allowed。SSH核查该location代理到7690的独立Gateway（0.3.26102803），保留Host；其gateway.publicOrigins仅https://yonder.zethai.cn，因此对yonderbot.net的拒绝符合现有保护，不扩白名单、不改Host绕过。统一/work不走该旧Gateway，实际读取设备online/workProtocol=1并加载主人工作会话。用户已确认此前失败的是/work，因此旧/console的403是独立入口问题，不能用于解释历史/work中断；当前可用也不能追溯为历史一直正常。
- 首版候选5c7d25bc后，正式Windows CI还暴露了路径断言及regex VM复用问题。后续1f3a7fb0改用原生path.join，16643295沿现有VM Script复用每次ruleMatch的隔离上下文，保持逐规则10ms和Unicode/病态regex断言；最终四平台CI通过的166候选包含40e7/afe81，随后发布v0.3.26110204。


## v0.3.26110206 发布与真实复验

官方 CI 41420386987 对候选 56794662 四平台通过；Release 41422186770 发布 v0.3.26110206，tag e3051562 的直接父提交为该候选，41 附件齐全。本机产品更新返回 verified，新服务 ready。Cloud 静态 Deploy web 41423443596 同 tag/SHA 上线，两个版本端点均200。

飞书真人原话再次触发主会话，自行写候选并发出真实群公告；但候选再次因精确群绑定带 kind 条件而拒绝，随后普通群消息仍进入原 observer/wake:write，完整验收失败。原生 Pi 请求实际包含 agent rejected 与 aggregate candidate pending，不能归因为事实未传入；聚合状态在解析提前失败时漏记拒绝，并缺少清晰有效版本和修复线索。QQ新一轮尚未发送。

同版 /work 又真实复现：设备及Agent列表200，capabilities.get工作RPC400。安装版control.sock同调用抛出被拒绝候选的绑定校验错误：运行态能力查询经 management plugins.list 无关地重解析磁盘 Agent，Cloud仅把设备错误转成泛化文案。当前故障已定位到运行态读取边界；历史/work中断是否同因仍未确证。共享修复继续进行，不能以网页静态200或群出站成功冒充完整交付。原话、完整消息关联和浏览器有界错误证据只保留在私有验收目录。


## v6 失败后的共享修复（待正式发布与复验）

- `63f7f5e9`、`4024b5ca`：候选在 Agent 或根配置解析阶段被拒绝时，聚合状态明确为 rejected；读取失败保持 unknown。运行事实分别给出磁盘版本和最后接纳版本，最多三条脱敏作用域/字段路径，便于沿已有管理工具修复。根解析、缺失文件及既有配置场景定向 4/4 通过；首次并发运行发生既有大用例 20 秒超时，单 worker 复验通过，没有放宽断言或超时。
- `b0c26c78`：共享引导要求有效运行事实或匹配磁盘版本的管理接纳回执；幂等需求可以使用已有有效配置，不强迫制造一次写入。
- `59dbb6c4`：运行态 plugins.list 复用已接纳的内核配置、Agent、预设和插件快照，防止被拒绝的磁盘候选中断 capabilities.get；离线管理与候选校验仍检查磁盘。真实内核 tempHome 回归通过。

这些提交完成源码修复，不能代替新安装版和真实飞书、QQ 群验收。并行开发产生的未提交类型检查/文件大小问题由其所属任务处理；正式发布以精确已提交候选的官方四平台检查为准。


## v0.3.26110207：接纳成功，完整群需求仍失败

四平台候选 CI 41430373041、正式 Release 41432300981、tag CI 41432460946 与 Windows installer 41432464569 通过；发布 tag/source 为 3d4b8380，41 附件齐全。Cloud 静态 Deploy web 41433208001 同 SHA 上线，两个版本端点200。本机实际运行 v0.3.26110207，服务 ready。产品 update 回执却为 verified:false：本次服务冷启动约37秒，超过既有30秒自检窗口；保留失败回执，未手工改成成功。6f4952ff 将既有等待窗口改为60秒，37秒启动成功与持续缺失失败两个定向回归通过，待下版产品更新复验。

飞书继续使用相同主人原话，Agent 自行使用原生管理CLI、校验完整候选、关闭旧档会话后重配，config.reload 明确 ok:true、restartRequired:false，目标群新绑定与profile实际接纳；真实群公告已送达。随后真人在目标群发普通无@消息，确实进入新独立群会话，但参与策略把输入改为 batch/wake:write；来源profile未选social，且无本群可消费的batch-ready绑定，最终只入账、没有模型运行。全局/同渠道存在别群消费者不能证明当前群的执行链完整，因此此轮仍失败。

QQ 用真实客户端原生@发送相同主人原话，群会话实际调用parent_ask，原始主人来源经验证送入所属Agent main，main已具本机CLI管理路径。主会话仍把“主会话接入”理解成让群共用私人main历史，只调查代码并返回partial，没有落地可行群配置；后续普通消息沿原write路径未运行模型。主会话负责管理/交付与群独立上下文应可同时成立，需修共享概念引导，不能预先替Bot配好或要求用户改说技术术语。

新增修复依据：08的精确消费者链契约与共享模型/parent_ask说明。缺消费者沿现有no-binding与可操作诊断失败关闭，复用已有机械伴随绑定；不自动增选profile插件或升级显式record/disabled/custom。模型须自行补齐获授权的实际可执行链，再用真人普通入站验证。源码检查、热重载和群公告分别记证据，均不替代完整交付。

共享引导提交 f9a621c9：修正“main可跨群共享”的误导，明确Agent跨渠道身份、群独立历史、主会话管理责任，以及write/run/参与策略/reply/显式发送的区别；详情留在现有自管理skill。提示词/模板/装配定向22/22通过，保留7300词原上限未放宽；初次扫描误含.cache旧候选导致缺build产物，之后显式排除缓存，正文压缩保留语义后通过。SVG已用独立临时Chrome后台实际渲染，布局完整。


## 默认优先级的进一步根因与当前 /work 复核

源码调用链核对进一步确认：实际首命中的精确自定义群绑定没有kind条件，却被后置同渠道observer当成官方群默认的接纳证明。缺链只是后果之一；因此修复同时让参与候选和最终路由共用真实matches的首命中结果，保持自定义优先，不让任意后置绑定改变其策略。静态校验只能硬拒绝有可信kind依据的不完整链；飞书opaque会话引用不能自行证明群类型，未知类型仍依真实入站与inspect诊断，避免把私聊误判成群。共享修复已提交4df56f1a：11个定向测试文件80/80通过，Core TypeScript检查通过；Biome无错误、37条非阻断noNonNullAssertion警告。尚待正式发布、本机产品更新与真实群复验。

v7后台Chrome /work可加载贾维斯真实历史和消息输入框。本机原生service.info 0.43/0.52秒返回、capabilities.get 1.25秒成功返回（协议1/minor1）；服务ready。浏览器调试记录有一条capabilities请求长期pending，但其他session/activity RPC为200，Cloud当前日志缺乏逐RPC结果，无法判定该条最终状态，不据此宣称桥接超时或新增全面故障。Cloud后端独立版号0.2.26102301不等同于网页/本机发布号；不能仅比较0.2/0.3就认定协议不匹配。既有v6 HTTP400的运行态候选重解析根因已有明确证据；用户明确确认之前失败的入口就是https://yonderbot.net/work、现在已恢复。用户早前历史中断是否同因仍未知。


发布前发现独立Windows门禁阻塞：托盘构建脚本引用不存在的无后缀品牌PNG。Luna提交5d9f7ebe，复用已跟踪512源图并保留原运行时目标文件名；Biome、真实复制与字节核验2/2通过。Windows ARM64在setup-dotnet阶段出现PowerShell CLR错误，尚无源码关联证据，待新候选CI复测；未加入猜测性workaround。


## v08 正式发布、本机核验与第二轮原话复验

- 正式版0.3.26110208：输入候选7d5b2b7，tag提交92c30164fef621b82fe7a79ec41a6b42c5a67a9d。候选CI41452545670与tag CI41455287342四平台均全绿；Windows安装验收41455291727、Desktop Release41455300016成功，正式资产43项。Android41455296088因desktop npm缺tauri script失败；主线9e1281ca已修，但不可变v08 tag没有该修复，APK未通过/未交付。
- Windows前置缺陷依次修复了品牌图源名、完整.NET输出保留、WinExe真实退出码与生成目录lint。全量4-worker两次出现独立测试超时；7d5b2b7降为2-worker，保留所有测试/断言/原超时，后续x64及ARM64全量通过。保留失败而不把原样复跑计作修复；一次旧run复跑曾占CI-main取消最新run，随后取消旧轮、恢复最新完整run。
- 本机同版同tag、原home、PID83640、ready=true。发起更新的v07 CLI仍执行旧30秒核验，重启窗ECONNREFUSED导致首次receipt01M6E83E8E7WRFQ0R2XP1PS53H未知；不覆盖它。使用已安装v08官方verifyRelease只核验一次、不重装/重启，成功receipt01M6E878NRTXWKHY6EGA2JM65V（13:47:15Z）verified=true。新60秒实现会重试所有control请求错误，包含ECONNREFUSED；不能据旧invoker首失败认定新窗口失效。
- Cloud Release的dispatch步骤实际只警告token未配置；其step success不等于已派发。复用了独立Deploy web41455429274，发布0.3.26110208-92c30164fef6。Chrome实际读取build-version.json为同版同SHA，/work加载本机region、贾维斯真实会话和消息输入框，无设备请求错误。CLI代理TLS失败不作为站点故障。

完整群需求仍失败。飞书原话输入后模型只读配置，用v7旧probe入账声称v08验证完成；新普通probe01M6E8MZZ37VB0H8AAGTE1P8K5（13:54:44Z）实际仅write、无参与decision/batch/run。关于“直接改文件导致更新覆盖”的模型叙述没有相应发布证据，不认作根因。

QQ首条原生@进入群模型并真实parent_ask至主会话，后者仍以私人main禁止直绑为由返回blocked；没有完成配置或热重载。第二、三条原话的来源route虽为write，但分别经batch-ready再进入模型，不能仅凭write认定未运行。普通probe01M6E8XTAHGTXASJP2GCJAEKC9（13:59:33Z）被策略batch-read，截至有界检查未观察到该账号对应的batch-ready/run。主会话配置前测试发送和其他Bot同物理群送达都不能代替本目标完成。原文导出仅在.cache/private-delivery-20261102/v8-original-conversations.md（600），不含thinking/工具参数/凭据。

已更新08 §3.2、13 §2.3及decision（558173a2）：一个权威operability投影供现有全局inspect、原生管理反馈、social路由检查与验证后的parent上下文复用。保留raw show stdout，自管理stderr独立附事实；历史与预测分栏、批次按sourceEvents关联run、发送须有来源关联回执。未知保留unknown，不创建新runtime/意图parser/完成判官、不自动扩群权限。此层Luna实现已提交e124ba74，parent接入为c14b2313/0a93b1f3：全量typecheck通过；有界caller检查57文件通过、10跳过，334项通过、14跳过；最终小集7文件通过、22项通过、2跳过；file-size与diff检查通过。来源匹配正向仅标not-evaluated，不冒充经过全部router准入；工具pattern沿实际glob规则，明确policy no-run。尚待下一正式版及原话真实群复验，不能据源码检查宣称任务通过。SVG已更新并用独立临时Chrome渲染检查，布局完整。


补充收口a6823f7b：批次校验错误改为两个真实CLI入口，保持未配置social.scope即不限范围；social/operability相关27项通过，Biome与size通过。内部自管理指引同步说明共享metadata、来源write与批次run的关系、主会话管理与私人历史的区别；提示词/模板/装配既有4文件22项检查通过，原7300词上限未变。尚待正式发版后的两端真实原话验收。


当前主线还包含并行提交22cfcc09：真实PNG渲染测试在Windows将冷启动等待设为60秒，其他平台仍20秒，PNG功能断言保持原样（之前Windows日志观察到native冷启动超过20秒）。v08的四平台通过发生在该改动之前、仍沿原20秒限制；后续候选包含该提交，不能将其结果描述为仍用旧Windows时间限制。该提交与source operability功能分开记录，未回滚他人主线工作。


## v09 发布通过与来源连续性的进一步修复

v09输入候选41cccfed、tag dc45befdc126e2c4fc5acfcca18b02c819b21522。候选CI41467977328与tag CI41470708514四平台全绿；Windows x64/ARM64真实安装验收41470713008、Desktop41470723544和Android APK41470717706均成功。正式Release41470496669公开且44资产。Cloud41470908882同版同tag部署并由服务器核公网build-version。产品更新首次直接verified=true，receipt01M6EDRJK7TTHVN7W6J1T593XC（15:24:05Z），原home、服务PID88649/ready。以上是发布/安装通过，群功能仍失败。

真实原话未夹配置算法。飞书first 01M6EDV22B9AHXV78MSW7BVF46、QQ原生@first 01M6EDWS80V21V166S2W586X72；后续QQ完整需求01M6EEJJKSKCC5893N28CYC9CV、飞书短句01M6EEP57XGT4YJG6W9Z00T4HM。Feishu bash带2>/dev/null并管道过滤，tool-result188889仅227字，没有operability；私聊又未调用conversationContext，证据通道确实丢失。QQ原话已保存在Pi189002，空批次trigger189094不能证明原文没到模型；真实缺口是当前sourceEvents的来源身份/当前批次焦点没有明确关联。

同一main run189025的run.end01M6EESF8Y4BRSHJ1JQPQ13T7R包含QQ parent 01M6EEKS2BDDSYPADSJXX2KSZE、飞书短句01M6EEP57XGT4YJG6W9Z00T4HM和QQ tool-result01M6EEPYQ5XABRSGH70E7DCYVE，实际工具参数/最终答复在处理GPT学姐的QQ接入而非先前P1。route.busy/waiting不足以证明历史实际steer，run.inputs能证明最终组合；feishu-owner的busy:steer确为显式配置，本轮保持原契约，不把它误称schema默认或擅自改queue。原文见私有.cache/private-delivery-20261102/v9-original-conversations.md（600），不含thinking或无关对话。保留AI写入的有效状态与历史，不预配/回滚目标来制造通过；前置失败后进入修复，未宣布完整验收。

按主人确认“同一个Agent办事，群历史独立”，16c2e2a7新增来源连续规范：f07b750d扩EventQuery before/order，默认asc兼容，枚举排序且边界参数化；59f8b9ee让operability默认有界读取最新事件，1001条以上fixture仍选latest；877029ef提供经过原有source/session/conv校验的batch来源帧，owner仅为身份事实、非owner仍ambient，不追加权限或伪造输入；29ac2a77将有限own operability和同origin近期owner原件直接注入私有main宿主上下文，群/访客无此私有摘要，shell过滤不影响此通道；faa2b202统一self身份事实，profile不是另一Agent，历史按session；caf1b27d更新旧精确self断言并保留身份/无权限提升校验。超长原文完全省略并标记，不用prefix或摘要冒完整授权；原始Pi文本不改。prepared target缓存使每个原件只注一次，各来源互不覆盖，不加额外Map/ledger/意图parser/新runtime。

最终当前树组合检查13文件通过，52项通过/1跳过；typecheck、相关Biome、size与diff检查通过。保持原7300词内置正文预算。此前组合曾因新增self字段导致旧精确串断言失败，caf1b27d以完整新增字段修断言后重跑全部组合通过，没有删断言刷绿。下一正式版和两端原话实际验证仍待执行；不会将源码检查计作完整交付。


## v10：发布与真实验收分开记录

候选4f9fe488（含0058fdb4文档与纯Biome格式修复）四平台CI41487859499全绿；正式Release41490574859发布v0.3.26110210，tag commit88e953b40e8ec7ee3f232eadf810828aed9fb2cf。产品update首次verified=true，event01M6EMQRKZF6A756HR7YDCB7X1，updateId833f8e97-a70f-42ae-948a-1401d7ee7ea6，restartRequired=false；原home、PID81437、ready=true。候选前一轮CI的唯一lint失败是并行iOS脚本prepare-ios.mjs的一行Biome格式，4f9fe488纯格式修复后完整lint通过，未绕过检查。Release Windows x64/ARM64真实安装41490747022与Desktop41490756841已通过；tag CI/Android在此记录时仍执行，iOS排队，不能提前算通过。

Cloud同tag部署41491535924通过。本机curl公网TLS reset（35）如实保留；独立已登录Chrome后台会话实测/work加载贾维斯v10最新回复与空消息输入框、无设备请求失败；build-version.json返回同version和完整commit，builtAt17:29:30.642Z。对应私有证据位于.cache/real-channel-v10-20261102/cloud-work-jarvis-loaded.json及cloud-version-browser.json（600），不是只凭构建或服务器health宣布浏览器通过。

真实原话继续失败：飞书first01M6EMRGQ06MWC0MJ0QNHAAJ19（17:26:23Z）、second01M6EMTPN94Y341CPJQJGK79JX（17:27:34Z）；main session2确实向P1发送了成功公告01M6EMS9MZG0DM67JFJWKM06HK，但Pi189489仍把旧wakewrite当有效需求，并混谈QQ学姐旧任务；second答复也转去QQ诊断、说明早办。P1普通无@探针01M6EMXPSSDKGWFAHB1NYDPYRD仅write不证明模型处理。

QQfirst01M6EMSXR6778YEKPZXKP5E1PT（17:27:09Z）原生@确实进入GPT学姐，先前查询太早造成暂未见入站，不是连接失败。second01M6EMVDH322Z18PEKVXFABB1Y（17:27:58Z）进入batch01M6EMVGJNMN2RBP6T8F6XHC0F并在run.end01M6EMWA8HQEV7PCY9HBGVQWBD结束；这证明普通需求经过群模型，不能替代配置/重载/本次主发送。GPT main150858的Pi189624仍因私人main不能逐条接群判partial，本轮未配未重载未发送。第三条01M6EMWXCK1KADQPD7R6BA55VC及普通探针01M6EMZ44D8SFD7V6N6EE8QDW3均保留，其他Bot的“在”不计GPT成功。原话与实际答复白名单导出.cache/private-delivery-20261102/v10-original-conversations.md（600）。

只读P1事实：当前profile未选social，P1不在social.scope；投影consumer=not-applicable、history execution/delivery=not-observed，source仅write。此配置可合法用于旁观，但不是当前完整办理目标的证据。模型首bash语法错误，第二次仅grep YAML片段后发公告。继续核查共享投影的断点原因、模型实际收到的prepared上下文和同Agent/渠道账号边界，不通过向user message加教学或预配Bot绕过。v10安装/Cloud通过不代表群功能通过。


v10补充定因：两条Feishu owner-private-main prepared frame均实际装配，当前origin与同源owner历史精确，8条own-conv事实中P1位于第5条，wakewrite/scope外/未选插件均可见，不能宣称原文或目标没传到。第1条QQ最近样本是senderIsBot=true回声，真实策略是record/run=false，no-binding不等于主人输入失败；样本当时没显示from/bot/关系事实，CLI断点解释也不充分。公共parent_ask描述仍称非main为“分身”，delegation有within its own profile歧义，本轮重写既有公共文字而非Bot persona。

QQ房间本来已有显式social.rooms列出三个账号conv，不能说完全没有关联；rooms提供上下文索引，不授权路由。main通过Jarvis parent处理GPT学姐时，给其qq-group-open增加channelInstances:[qq-jarvis]（reload01M6EMZXDGCNH12HZ5Q5XDHJBY，GPT accepted revision c879f04f9f66）；原来Jarvis账号的人类入站在此更新前确实对GPT no-binding，而GPT自己的原生账号另已真实运行。保留这段AI实际修改与历史，不由root手工回滚/补配骗过验收；跨账号证据、权限与当前任务目标须分别说明。不能将GPT-native成功当作Jarvis-account成功，亦不能把另一个账号尚无运行证据说成GPT整体没收到。

v10后续发布最终状态：44资产齐备，Android signed APK41490752050、Desktop41490756841、Windows双架构真实安装41490747022均通过。正式tag CI41490742205全平台通过，iOS TestFlight41490761199也已成功。群功能仍未完成，继续修共享诊断与术语后发布复测。


v10后的源码收口：a090f517/82d82b25重写公共main/非main身份、群独立历史与完整配置验收语义，不改权限/调度/绑定；bd8f1df8共享样本保留from、可信relation、senderIsBot及原生mention事实，scope外的consumer附outside-social-scope原因，CLI据此解释record-only并并列真实bot/参与原因；9fc8a784只将no-run文案明确为当前参与决策的预测，2b413934修未知prediction缺wake时被误报为run。最新样本不筛选、不拿成功原件替代失败，未给Bot手配目标。

最新当前树组合验证9文件/34项全通过，明确排除**/.cache/**；全量typecheck、相关Biome、size/diff通过。子任务早期定向3文件/5项包含.cache/release-20261102-merge/candidate-758aae8c下CLI测试镜像，校正后的实际源文件定向为2文件/4项，不把镜像重复项当覆盖增加。原7300词预算保持，未削弱完整候选/acceptance/真实新入站→模型→投递条件。下一正式版及两端原话重验待执行，源码通过不计交付。


v10进一步查到实际消费链缺陷：GPT第三条原话01M6EMWXCK1KADQPD7R6BA55VC和probe01M6EMZ44D8SFD7V6N6EE8QDW3进入rule-match01M6EMZ71XDAHH99K8ET235MQ8（focused=1），却未产生GPT batch-ready/run。Zfish成功说“在。”（01M6EMZEEJ9MYM015Z28GP47RA）后，GPT batch-read01M6EMZEET8GQ6HAH35ZZ9ADVQ以该出站为parent推进了through。该read只是程序协调游标，不能叫模型已读。源码flush丢失了已算出的focused，delivered把所有peer.willing都作为普通候选清掉；规范只允许普通候选因成功回答结束，已关注者不应丢未处理来源。复用原focused与offer，不按正文猜管理任务，不新建调度器；下一候选纳入修复，因此未安装缺此修复的并行v11或旧候选。私有v10原文追加了三条准确事件白名单证据。


发布候选25b13bae（合并并行v11版本记录后的候选）CI41494601938因随后确认focused丢失缺陷被root主动淘汰：Linux已通过，macOS/Windows取消；不是测试失败，未安装、未触发本候选AutoRelease。保留六个已完成修复提交和并行v11元数据，等待加入关注生命周期修复后作为完整候选重新发布；没有force push、stash或开发分支。


79ae89ca完成关注候选修复：运行代码6行，flush保存已算出的focused，delivered只结束非focused兄弟候选；继续复用offer/batch-ready。没有新增任务模型、文本分类器、调度器或权限。真实Groups+GroupAttention单元行为覆盖replied→flush→delivered→offer；不会把手填willing标记或plugin测试出站假称真实Agent回复，保留普通候选结束语义。关注/节奏13项通过。加入投递、恢复、来源上下文、parent与提示词的最终组合13文件/54项全通过（65.04秒，排除.cache），全量typecheck、size、diff通过；相关Biome无错误，保留既有non-null assertion warnings。SVG已重新渲染核对。下一正式版本更新及原话真人渠道验收仍待执行，不能把这些单元检查算作真实交付。
