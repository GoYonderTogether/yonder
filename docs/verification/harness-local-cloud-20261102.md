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


## v12 发布完成，原话复验仍失败

候选11c492b8的CI41496846912首次macOS因hosted ARM容量不足取消（无runner分配、非测试失败）；其余Linux/Windows通过，受限attempt2仅重跑macOS，最终全绿。AutoRelease41500047068唯一派发Release41500075423；正式v0.3.26110212/tag commit5e94c9204c92e3c7c895f44bbc8bb299685773ec，精确pin产品update，receipt01M6ER6DQB3DMJ5WR54Q73QGFM/updateId7265ea2c-2297-42e1-9887-51013bd7195f verified=true/restartRequired=false，服务PID30998 ready。Feishu四实例及QQ gateways均有本次新PID连接就绪证据。

发布平台最终均通过：tag CI41500277613，Windows双架构真实安装41500282275，Desktop41500290515，Android41500285991，iOS TestFlight41500294830，Cloud精确同tag部署41500744455。GitHub Release最终实查45资产（38个tgz、SHA256SUMS、两个install脚本、APK、DMG、Windows setup.exe、iOS IPA）；初始41是native上传前读数，不能当最终资产数。Chrome后台实测/work加载贾维斯18:35新回复及消息输入框，无设备请求失败；公网build-version为v12/完整同SHA、builtAt18:28:19.299Z。

飞书最初18:26:45客户端消息气泡带红色失败标记，原生重发提示some_error_occurs；未计Yonder入站。重新加载这个独立网页会话后，失败气泡不存在，同一句原话18:32:16成功入账01M6ERH576QCMETJYKB8PY3XFR；second01M6ERPPDRBVGEZB7X56XJN9NJ18:35:17也成功。两轮run均done但无工具调用，DM reply01M6ERHYXMSD5KDMPRQ1B2GR96及01M6ERQCCR56PYR7KZHFSBM5H7仍称P1纯write配置完整、无需再发、GPT不在QQ群要重新邀请、深夜/离电脑65分钟可明早办；没有本轮P1出站，也没有配置/重载。P1probe01M6ERSTK0DX35JD9STXEM4ZQF只write，不算模型处理。

QQ原生first01M6ER7V6ST3G0094JVBNEJS5618:27:11收到并由GPT发“会核查”公开ack，但无parent_ask。second01M6ERC5VVF4PBERQTJ40X360B18:29:33→batch01M6ERE2PKKT3H4M7VT2YED1F318:30:35→run01M6EREDFA7NKGP4QMG8B61X1E18:30:46；Jarvis在18:30:06成功发言未再吞其focused候选，79ae89ca生命周期修复有真实效果。third01M6ERFXDRJZNQPW72R2ETNYAF18:31:35→batch01M6ERHXVKDTEK95W3P122G7ES18:32:41→run01M6ERJ7M35TCFN3RNAR2WQPQV18:32:51。两批GPT均NO_REPLY、无工具，无配置/主发送交付；不能信用Jarvis或Zfish代答。普通probe01M6ERVMY72PY3C78V6366G5DV18:38在关注过期后由Zfish回答，只属其运行，不计GPT模型已读。原对话见.cache/private-delivery-20261102/v12-original-conversations.md（600）。

实际模型上下文核验排除了旧prompt缓存：main2最新pi.system190017与gpt155642最新pi.system189946含a090/82新同Agent/配置验收文案、旧within-its-own-profile不存在，parent_ask已提供且非旧“分身”描述。两条Feishu prepared190152/190206有owner-private-main、8个own-conv投影、P1 source=write与新增consumer.reason/from/relation字段；分别约52411/52090字符，需继续查摘要体积/聚焦边界。当前prepared和system均没有idle/65min/owner全局offline字段，不能把回复的AFK判断归因本轮host。未抓provider HTTP wire-body，不将durable实际系统上下文冒充独立传输审计。

新断点：首批rule-match真实focused=true保留到了willing，offer创建GroupTurn时却只传direct:false，最终social.group-turn/context仍标independent contribution；因此调度互动状态没有传到模型。另第三条虽在300秒窗口内到达，consider实际执行时已过期4.7秒，真实focused=false，不能将它重标focused来刷验收。下一修复贯穿既有focused至模型输入、保留direct/普通与权限语义；暂不改过期策略、不增加意图分类器，不声称此一项能独立解决全部NO_REPLY。完整群交付仍未完成。


v12后源码收口：15add313以内部必填类型把focused贯穿willing→GroupTurn→social.group-turn→compact groupContext，区分explicit address、recent interaction follow-up、independent和旧缺字段unknown；不伪造mention/addressedTo，不改变300秒处理时点或权限。f2790622将CLI纯summary映射移至core，宿主和CLI复用同一受限摘要，raw projector/inspect与CLI原始配置stdout保留；summary明确current-agent-exact-binding作用域而非全局membership。默认8项/8000序列化字符，超预算整项省略并计数，不截断身份/权限。

同一只读prepared190206快照：operability JSON对象17091字符/字节→7237字符/字节；整个owner frame JSON字符18346→8492。8条完整fact保留7、omitted=1/truncated=true；详情仍可inspect。原有3条owner历史窗口不改，约20k post-turn其他上下文未改；未重测最终新prepared turn总大小，不把原escaped conversation行与新raw JSON混同比较。

当前源树最终构建scripts/build-tsc.mjs通过；整合来源、私有主会话、摘要预算/unknown/revision、parent、公共提示词、CLI、群关注/context/rhythm/delivery/recovery：15文件59项全部通过（69.15秒，排除.cache）。最终全量typecheck、size、相关Biome与diff通过，stable prompt原7300词上限保持。下一正式版/本机更新和两端原话实测仍未执行，不将此源码阶段计作完整交付。


## v13：关注连续与有界视图上线，配置闭环仍未完整

候选2ddb5f11（含15add313/f2790622）CI41506377340通过；AutoRelease41508821553唯一派发Release41508850220，正式v0.3.26110213/tag f41f484f3bc7f2d046db1fbcd3b9faefaaf6b4df。精确pin产品update verified=true/ready，event01M6EVDZ8RENSKAC6AC06659RM/updateId2c9be187-a978-47e7-a6d7-7a043446a880，原home/PID77028；新Feishu/QQ gateways约19:22:55Z全部就绪。

全平台发布通过：tag CI41509084986，Windows双架构真实安装41509089476，Android41509093842，iOS TestFlight41509103090，Desktop41509098500。Desktop DMG首次runner capacity取消，其他CI成功后只重试该job125496737271一次，新job125505921379取得runner并成功。最终GitHub实查45资产四项native齐全，不把初始41/中途44当最终。Cloud同tag41509477042成功；Chrome实际/work读到最新v13主会话回复和输入框，公网build-version=13/同完整SHA，builtAt19:24:16.359Z。证据.cache/real-channel-v13-20261102/cloud-work-jarvis-loaded.json与cloud-version-browser.json。

真实原话全部保留。QQfirst01M6EVFRHVB9QXC8SQ6BKWVYWR19:23:56先误称要邀请自己；但19:24:45实际parent请求01M6EVH8C2ZHNVY47CT998B2RW后，main150858核实已在本群原生收发，并由GPT公开更正。second01M6EVMW5BZT0CPSESRA5MCND119:26:43与third01M6EVP8595X5SFXNMC6TJYT9G19:27:28进入GPT批次并运行，公开承认普通消息收到，却把未查询的平台范围当作必须用户先改，没完成本轮GPT配置/重载/主发送。probe01M6EVWN4RMW48HTE7WZ94HNBW19:30:58在Jarvis回答后仍获GPT batch-ready01M6EVX7XS64RX634V81VAQM4319:31:18及run.end01M6EVXQZKG3KJ03D7988Q8ECG19:31:34，不能把兄弟“在”当该run；本次确有自身运行。

飞书first01M6EVG8RBGHR795MV82MAB3RC19:24:12仍只复述旧配置；second01M6EVNENWGZEW6J55035D2NWM19:27:02后，main2确实向P1新发公告01M6EVNRHGP3AEHQ57A6YN860R19:27:12、delivery成功，并给DM回执。但仍称无需配置，P1probe01M6EVW71XAK3MRW7P15N161BY19:30:44只write，无模型链，故部分动作通过、整体未交付。原话/实际回复白名单见.cache/private-delivery-20261102/v13-original-conversations.md（600）。

本轮进一步共享根因：QQ status/README无条件要求先把群范围设all，而插件没有bot_state查询（官方接口仅部分白名单）；这将unknown误报missing。f139c906按精确instance+group显示platformReceiveScope=unknown和basis=recorded-event的lastNativeIngress，local allowedGroups/groupParticipation分开，不冒平台永久全量证明、不发明API。不扩大权限或改真实群。

另从默认分支发现可复现程序缺陷（不是声称当前P1已触发）：social未写时revision(undefined)会hash TypeError；conversation batch/signals局部patch会丢同级值。db2facfd/04072660复用既有effectivePolicy合并已声明的batch/signals，保留YAML其他键与注释、可初始化首条policy；重载后返回独立postcondition，配置接受、当前静态source/consumer与历史执行分栏，读取失败unknown而不撤销已成功重载。314f59d5/79acd0be重写公共功能语义：Agent判断需获准模型处理而非只存储，batch只是可用路径之一，显式模式与准入/权限不被改掉；不改Bot persona或在user message塞配置步骤。

最终当前源树build-tsc通过，整合23文件118项全通过（76.38秒，排除.cache），typecheck、size、相关Biome/diff通过，原7300词预算保持。source-only QQ测试22项与social/相关prompt23项独立通过；早期QQ镜像误跑失败来自.cache，未算作source结果。下一正式版、本机更新与真实原话重验仍待执行，不以源码/平台发布通过冒完整交付。


同批补修358122c3：公共goal句“任何时间/context提醒就wrap up”与已有14§1软阈值契约相反。v13实际warning01M6EVGKRZNWETTFMSKXVM52NW（main2，19:24:24，285250tokens）、01M6EVH8ANJ9KRBZZW8GJ6CCZ0（gpt155642，19:24:45，398730）、01M6EVP85SZQCG5B8NK4HWGHPK（19:27:28，204981）文本均明确继续工作。改公共句保持目标续办，不改真实limits；不能据此认定全部失败因果已确认。定向prompt/limits18通过1真实模型跳过、typecheck/Biome/diff通过，原7300预算保持。此前e564候选尚在CI，下一候选包含此补修后推送，由正常并发淘汰旧run，不安装缺补修的候选。


## v14：已安装，真实群仍未完整交付

候选5043338d正式发布为v0.3.26110214/tag 554ba68e3afbfe52509cb721714d407e8ff88e16。产品update回执01M6EZ2YXRJQZQZJ5DYFHV4VPW（updateId37b5ce87-4367-4afc-a39e-5ad35f79018c）verified=true、restartRequired=false，本机服务PID13524 ready；新Feishu四实例20:26:48Z就绪。QQ恢复会话不一定再次打印ready，不能据此判离线；20:31:38Z真实三入口入站证明本次连接可收消息。没有修改正式home来替Agent完成配置。

候选CI41515585148成功；旧e564候选CI41514741178被新push淘汰，不是测试失败。AutoRelease41518493964首次dispatch HTTP500，仅重试失败派发步骤后成功；实际Release41518688116唯一派发。tag CI41518895905及Windows安装、Desktop、Android、iOS流水线成功，最终实查45资产包含APK、IPA、aarch64 DMG、x64 setup。Cloud同tag41519443117成功。root于21:13Z起用独立后台Chrome实际打开/work的本机贾维斯真实会话、历史和消息输入框；公网build-version读取version14/同完整SHA，builtAt20:28:38.272Z。历史连接失败原因仍未证实，不归因为版本不匹配。

Feishu first01M6EZ7HWCKT1G9E2GSBXTYZ6X（20:29:21Z）仍无工具调用，回复01M6EZ89R8KXX8NXJ4RSR3SVF4称旧配置有效无需再改/再发；P1没有新配置或本轮发送。实际prepared190594含准确P1事实：scope排除、source仅write、无处理consumer；owner frame约8492字符，新处理语义及软提醒条款已在当前system。不能继续归因为旧prompt或P1事实被摘要省略。

QQ first01M6EZBQQ3T0MSMEWKC18178MF（20:31:38Z）由GPT公开接手，parent请求01M6EZD3E4MS8N5QMED7Y8MSPT进入main150858。主会话20:32:58Z确实向GPT本群成功发送01M6EZE5FTMF8JHZPB6AMZS0KZ；本轮读回既有batch/run/plugin/consumer配置，无需重复写入重载。报告partial并保持平台状态unknown。这是本轮真实进展，不等于P1或全部普通消息处理通过。

QQ second01M6F0098J70NH3DEKDE2PKD6D（20:42:52Z）、third01M6F00PT65KQ4QMSEG9JV9JVM（20:43:05Z）保持原话；后续Jarvis parent01M6F0219VHGHD7M3Q8P16DFC7与Feishu second01M6F03Y39QRNMAJDJ8ZZQQQAV（20:44:51Z）进入同一main2轮次，run.end01M6F04S16VYSP5FHDY6E9N2SW的inputs同时含两项。Feishu回复01M6F05PMWMDF7FSA777ZRBEC0只讲QQ外部设置，漏办P1。现有同session全局steer/all合并不保留执行来源边界；不能把一个最终答复复制给多个来源算各自交付。

QQ普通probe01M6F1QPJWTKXARVCQG79XK00E（21:13:07Z）由GPT入口实际收到；Zfish成功回复01M6F1R0M50WTSHSM0YCCGHHEN后，GPT的social.batch-read01M6F1R0M84679HDBJ7CR9EZK0推进游标，本轮无GPT batch-ready/run。这再次证明发言竞争结束会吞掉明确batch.run=true所需的模型处理，之前只保留focused不能解决普通消息。P1 probe01M6F1X62ETE2TAYYV07QQVV28（21:16:07Z）仍只write。原文白名单导出.cache/private-delivery-20261102/v14-original-conversations.md（600）；源码、发布、云端连通与真实目标结果继续分开。

用户确认“同一个Agent办事，群历史独立”，不合并私聊与群历史，也不把这项实现解释附加到真实测试user message。后续收敛为三个共同边界：既有typed配置操作补齐已授权目标的依赖；模型处理不被公开发言协调代替；同main执行中保留可信来源与交付归属。暂不增加独立意图模型、关键词分类器、第二runtime、转录库或任务账本；完成判断仍归实际Agent，配置/运行/投递事实由宿主记录。


## v14 后的共同边界收敛（未发版）

476b44fb将明确batch.run=true的模型处理与公开发言协调分开，保留quiet、暂停、显式过滤与批次限制；普通消息指向别人或兄弟Bot先答不能提前推进已处理游标。3文件15项通过。a80b6e51/e2577e3b/4acb0ca7复用现有social.update候选与真实first-match/consumer投影做完整依赖预检，保留accepted runtime派生profile/bindings；显式设置mode=batch或batch.run=true且合并后两者均生效时触发，record/mute及无关patch不扩范围。known缺件一并给对象、字段与agents.show/validate/update路径；ready/unknown可选回执不把未知当缺权限，不暗改scope/profile。5文件22项通过。

只读installed accepted profile进一步确认main/owner、main/feishu-p1未选择social，social_update为plugin-not-selected，不能靠search通配符越过插件边界；bash和本机CLI管理仍已提供。095ca941只重写共同tool-discovery规则的无条件禁止启用插件措辞，使工具发现不提权与主人授权配置走已有管理路径一致，不改Bot persona/home。prompt/index15通过1真实模型跳过；Biome无错误。

真实Luna自然配置fixture初次1 failed（180.137s），当时失败捕获不足，不能追溯猜定错误。6189a34e增加有界social_update安全参数/错误白名单后，第二次1 failed（约147s）确证原生写入错误：Expected YAML collection at conversations。ae197ecb将已有social但缺conversations的父mapping初始化改为document.createNode({})，纯YAML及createSocial.update回归8/8通过并保留注释。构建前误启动一次case被取消exit130，不计通过；构建后同原话fixture1/1通过（84.58s），parent为main/private，独立群session，未预置显式batch binding，派生consumer实际处理首条及后续普通输入，Luna run done并成功发送。该fixture为本地记录transport，不能当真实QQ/飞书。

第二次失败另有policy文件true但普通决策false；只读核验显示该决策21:49:07.379Z早于后续reload21:49:08.219Z约840ms，超时catch读取的effectiveSocial不能反推探测前状态；router与watcher共用agents Map，没有证据支持已接纳后仍用旧策略。本轮未加reload等待时长或猜测性缓存修补；YAML根因修复后的同case通过。

共享main来源隔离在原生Pi Inbox完成，不另建队列或任务库。先将既有14个anchor源文件迁回fork D1 4e37df84c2929fb46e86b58d7b18a189bf8825d9，对Harness现存93文件逐字节核验0差异后沿原guard同步D2，再同步最终D3 91e8c7a958ad15a7f5a4be9e6a76c0162ee77c1c并从干净同commit重建pi-ai包。sourceGroup仅来自核验原事件conv；同源steer续办，异源留同一个持久inbox到后轮，unknown独立event组。显式interrupt用可选标记保留跨源取消与并入当前轮；原mode枚举与one/all约束不变，旧版回滚仍可按原steer识别输入。onIdle现有收尾移至run-completion复用closeReason，不新增状态。

原hashline五个测试逐文件迁回fork，transfer/write-gate覆盖保留；Harness core consumers保留3文件13通过2因缺fd/fdfind跳过。D1迁移初期旧工具检查12 failures、14项格式诊断（含2 warnings）保留为原结果，后续在fork按既有anchor契约更新有意义断言与格式后通过。fork tools入口图17→26只反映既有9个anchor模块归源，不增加余量或关闭guard。D3目标9文件102通过1因macOS无PowerShell跳过，native构建/同SHA clean pack通过；fork全仓tsc仍有50项旧ai/test模型目录诊断，无本轮durable错误，不称全仓全绿。

Harness早期组合6文件12通过5未启用真实模型跳过；随后启用真实模型的组合3文件为3 failed/7 passed：其中真实onboarding与restart用例通过，三个queue用例误将startup run.end当目标，已按实际owner输入关联修正；显式interrupt兼容缺口也在D3修复。D2 foreign-steer对照首次测试仍failed（过早快照投递），但实际事件已证A+C同轮、B后轮且两个conv各自送达；保留失败，不改写成pass。最终D3四场景最近组合为3 passed/1 failed（generation在原5秒窗口内未观测到成功投递标记）；其后同代码仅generation单例1 passed/3 filtered skip，真实assistant streaming前置、A/B/C同轮done、唯一message.out正确parent/conv/delivery.ok且含merged标记、无旧答案。没有将单例通过改写成组合全绿；此前失败原因不能仅凭后续成功追溯定为服务延迟。coherent源提交e423078f537f23aec99ad0aaa85563c03132ae59，Pi源D3同SHA包匹配。

完整共享工作树检查：build通过15s、typecheck通过5s；默认非真实模型全套测试exit0，494文件通过/67跳过，2659测试通过/112跳过（2771 total，455.58s suite/457s command）；file-size和layers通过。完整npm run lint原始失败34 errors/1245 warnings/34 infos，34 errors全部位于foreign未跟踪proposals/brand的18文件；没有修改这些草稿。tracked-source Biome exit0，1632文件、0 errors/1244 warnings/34 infos，不能把它改称完整目录lint通过。日志.cache/checks-d3/私有。该检查对象为ae197ec加当时coherent共享改动，不冒充干净提交CI；最终候选将通过正式CI和发布门禁后安装原home，并继续两端原话真人渠道验收。


## v15：正式上线与真实复验，完整交付仍失败

固定候选4e58ceb85f52df472d19efbe59232caaf77b8703正式CI41538017087的11 jobs全通过，AutoRelease41540319131唯一派发Release41540344344成功。v0.3.26110215/tag d7d86c8e1ce92c48f7abec658fe6b807de661983直接parent为候选，最终45资产齐全；Android41540533183、iOS41540541825、Desktop41540536836及Windows安装41540529191成功。原生update exit0，110s；event01M6F7E7T2VTZ2HQV7PHG8DR3F、updateId04a8b512-a521-461e-891b-cc04f3992b70、verified=true/restartRequired=false，原home、PID62581。没有直接改安装文件/收据或预置目标Bot配置。

Cloud既有自动通知未产生匹配run，使用既有Deploy web精确派发41541134034，同tag/SHA静态部署成功。root实际后台Chrome /work打开本机贾维斯v15真实回复和输入框，无设备请求失败；build-version.json实际version15/同完整SHA、builtAt22:55:12.345Z，证据.cache/real-channel-v15-20261102/cloud-jarvis-loaded.json与cloud-build-version.json（600）。历史那次/work恢复前中断根因仍未确证；不能以独立产品版号不同就判协议不兼容。

发布链不全绿：tag CI41540525612 Windows x64初次4失败，488文件通过/4失败/69跳过，2635测试通过/4失败/132跳过；4项分别为sync-pi-durable20s、preparedTranscript20s、social group-recovery40s、kernel/home20s deadline。一次受限只重试x64 job125611227564后，这四项均通过但另3项失败：489文件通过/3失败/69跳过，2636测试通过/3失败/132跳过。workbench-remote负向权限断言期待grant而收到timeout abort；tasks board与tasks各20s deadline。未第三次重试。无runner资源数据，其他timeouts归因unknown。已证test fixture把20s绝对signal跨多步TLS流程复用，最后权限请求可能在signal过期后开始；0fcaf613仅给负向操作新鲜同20s signal，保留能力/资源及grant断言，定向2 passed/2 skipped（5.18s），不改产品/全局timeout或CI workers。Windows ARM64、Linux、macOS tag jobs通过。

原话Feishu first01M6F7GFRA5YVFJMF76Q5GAHB0（22:54:03Z）与second01M6F7JQ5D51H2ED6YW5CW4PZG（22:55:16Z）各为main2单输入轮次，未发生本轮跨源并轮；first曾用bash只读，但没有配置/热重载。reply01M6F7HWZFJQY6C5X91FF7K9NB和01M6F7KDATDEGJXYX8ZJ4NZ2XW仍答旧QQ设置、引用旧03:27回执并说等主人醒来。P1普通probe01M6F8ZC002C41W4MXMCG7C5EZ（23:19:39Z）仅write，无模型路径，故配置目标仍未完成。

QQ first native@01M6F7HV9FGT5ZS60QK96M4YD9（22:54:47Z）收到GPT接手并产生parent01M6F7KCJF4FFW8ZM7GAWGK0X0；转述自行加入不要重复发送。second01M6F7RPJVD8AWQAF572GQR60C与third01M6F7RXDY9JH50Y63EFMDZ57X保持原话，进入GPT batch01M6F7SX3S28TSPRR68BQS0Y3T、run01M6F7TPX49HX41CEQ7VW72P2Z，未发生本轮fresh主发送。Jarvis公开要求再开GPT平台scope仍缺官方状态证据。群原文见.cache/private-delivery-20261102/v15-original-conversations.md（600）。

五分钟窗口外QQ probe01M6F8Y8CC9K645ZK6DFGVW455（23:19:02Z）实际rule-match01M6F8YB9F0QBMV1ED64XKB30F focused=false/matched=true。Zfish先成功发在01M6F8YJW9N0JJ56A81K1GRTB8后，GPT仍有自身batch01M6F8YNR1MTREPWC7D19CW22S与run01M6F8YWTHPJ2S8GYC4DBXCR33（23:19:23Z），之后才read。此项真实确认v15不再让兄弟发言吞掉明确batch.run的普通模型处理；model可沉默仍符合按需说。它不代替P1配置或本轮主发送验收。

新的已证上下文缺口：当前owner-window只取同Feishu DM owner旧输入，没有混入QQ正文；但operability行无可信平台群显示名，事件无群名、session182977 title为空，feishu-p1只是配置标签。Channel.describeConversation为已有精确授权群补平台标签，以对齐自然名称，label不证明membership/权限。parent的原始owner正文虽在conversation JSON，主要任务段仍是模型转述；新内部结构化帧将全部核验owner原件作为primary目标，转述为辅助、不重复正文，guest/mixed/unknown不升权。两项正在共享源码实现与验证，未安装为真实通过。未启用全量provider trace；pi.system/prepared不是最终wire receipt，当前没有已证provider丢失字段，不能以未知假设改SDK发送路径。

## 后续候选：目标名称和主人原文分层

eedc7701集成Luna执行的共享修复：SDK可选精确会话描述、Feishu已有API客户端只读GET、仅主人私有main对已绑定已观测群提供标签；无支持或查询失败显式unknown，不拓展目录或权限。全部核验为owner的parent-request以完整有序原件为primaryRequest，转述为delegateNote，原文只保留一次；访客、混合和伪造来源不升权。FeishuChannel为488行，prompt/index为495行。

实际v15输入对应prepared entries191058/191115的摘要，按源码预算口径JSON.stringify(summary).length均为6961，7行/omitted1，P1在第6行。旧平台工具结果181751含同一精确conv和群名；以该旧名称核对新字段预算，结果7321 JS chars/7329 UTF8 bytes，仍7行/omitted1，P1完整行及名称保留；全unknown路径7283 chars。未抬8000预算，未把历史标签说成此次fresh API查询。此前7237计数边界不同，以此直接解析摘要口径为准。

定向集成3文件31项通过；标签/owner边界4文件14项通过；build/typecheck通过。真实Luna自然fixture首次缺显式测试auth来源而2项跳过（1.76s），随后显式传入既有本仓库测试auth路径，2文件2项通过（76.44s）；事后核对发现未排.cache，实际为当前工作树和.cache内758aae8c旧候选各一份，不能称两个当前源用例，正在排除缓存仅跑当前文件。未复制其他应用OAuth或打印凭据。两份脱敏证据self-config-group-03716d86-1521-4350-bea4-64effcbdd6cf.json及self-config-group-a7f53372-6047-4f5f-9260-9dbc4ea5bba0.json记录原话群主人输入→batch→parent-request→main/private session30，群session2独立；mode=batch/batch.run=true实际写入、热接纳读回，后续普通输入有真实Luna run done及本地录制投递。该fixture不是真实飞书/QQ，不保存最终provider payload，不能单独证明wire字节；结构化输入由实际prepareInput/parent-origin定向断言覆盖。正式CI、安装与实群复验仍待完成。

纠正后的精确当前源命令加`--exclude '**/.cache/**' --maxWorkers=1`，仅运行plugins/social/test/self-configuration-natural-live.test.ts：exit0，1文件/1项通过，99.05s。日志.cache/v16-checks/self-config-natural-live-source.log权限600。先前2pass的统计保留，不将缓存副本计作当前源验证。

eedc7701a27074811a3206eee60e011d7b574ffb源码共享树检查：build通过14.76s、typecheck通过8.82s；默认非真实模型全套`npm test -- --exclude '**/.cache/**' --maxWorkers=1` exit0，494文件通过/67跳过，2664测试通过/112跳过（2776 total），358.01s suite/358.55s command。size/layers通过。完整npm run lint仍exit1：34 errors/1244 warnings/34 infos，34 errors均为foreign未跟踪proposals/brand的18文件；未修改这些草稿。tracked-only Biome检查1632文件exit0、0 errors/1243 warnings/34 infos，不冒充完整目录lint通过。原始日志.cache/v16-checks/。此时仅文档与foreign草稿dirty，后续固定候选须通过干净提交正式CI和发布链再安装，不能以此取代实群交付。


## v0.3.26110301：全部发布门禁通过，实际配置与交付仍未完成

候选ddae602994cc180557b6c867b9609cfc32401eaf，push CI41548031895为11/11 jobs成功；唯一AutoRelease41550207700、Release41550223979成功。正式tag/SHA为v0.3.26110301/deeaa2ffdadf0ec845f636225dfaaec79c62714a，parent精确为候选；45资产齐全。tag CI41550377177为11/11成功；Windows双架构安装41550380595、Android41550383918、Desktop41550387225、iOS41550390582成功，无失败后重试。原生updater exit0/105.34s，event01M6FBTB6PX2475CTW18Q9Z0CB、updateId c3d505bb-db7c-40f0-8037-4aea201b418b、verified=true/restartRequired=false；原home、PID35862/launcher35723，实际origin.commit与tag一致。没有预配置Bot/群或换owner模型。随后正常ff-only合入release元数据，main与origin/main/tag一致。

Release自动Cloud通知未产生对应run，既有Deploy web仅手动精确派发一次41550938085并成功。root后台Chrome真实/work打开贾维斯本轮两条26110301回复及输入框，无设备请求错误；public build-version实见同version/SHA、builtAt2026-11-03T00:11:07.698Z（不把服务器目标元数据生成时刻冒称浏览器字段）。证据.cache/real-channel-26110301-20261103/cloud-*.json权限600；owned session lpms已stop。此前用户那次/work中断仍无确切历史根因，不能认定产品版本不匹配。

实群watermark row16449，00:09:43Z。Feishu第一原话input01M6FBVHWFCAR9ZV74V619Y9R0（00:09:59Z）/run01M6FBW0BWF9SSV1B9FBCYGMNQ，第二input01M6FBY5YPXCGGXZ3GJ1TAK0W9（00:11:26Z）/run01M6FBYDSF1Z3V4AEJVVHFTSCW均main session2独立单输入，真实model workbuddy/deepseek-v4.1-flash；两轮无toolCall，reply01M6FBWDFCBQS96CNV1FT5CZRG、01M6FBYTABF1H9ZY8D2XB4QVBK仍据旧03:27回执声称不必修改/不再发送并转QQ手机scope。P1 probe01M6FC5544KGJ8PCA5M9MDHS8E（00:15:14Z）已实际入账，未有本Agent模型处理/新发送，因此失败保留。

只读核对实际prepared：本版pi.system hash已更新；原文、当前event、P1 platform-exact名称和wake=write/scope excludes/record-only缺口均完整保留。第二input正常Pi user191393经prepared191397原生replace装配，非旧缓存。groupContextMerged=false；旧owner历史只作背景。生效beforeRequest为core图片/limits/recovery/system-as-user及tasks-budget/wechat-watch，实际systemAsUser关闭；代码追踪均不删除当前user正文，只可能追加提醒/裁旧图片。最终provider wire仍未直接捕获，不启用含正文/秘密的全量trace，不把prepared夸称wire证据。该prepared为31783 JS chars；conversation JSON原始8576，文本节点将1158个双引号转实体后14366，多出5790；摘要本身7321仍完整未超8000。新事件native msgId彼此不同且按ID去重，projector只按当前source关联run/receipt；旧回执只出现在旧对话叙述中，宿主未把其计作当前投递。

QQ首条native@GPT input01M6FC037FCS5452GWFA6S141V（00:12:28Z），公开接手reply01M6FC0WAW0S4TYTXN3RZWX9C2；parent01M6FC13DZNR93XYV73J8R3469（00:13:01Z），main session150858 run01M6FC23TQ1ARJHM2DEV0G8XVD结束。后两句原话分别GPT input01M6FC2A3AJ1B2PT3NAZ6YK3WE（00:13:41Z）和01M6FC2GNYGQ894GETJABHE1A7（00:13:48Z）；各自进入batch01M6FC2D11F896NZY78MJMDKJ7与合并batch01M6FC2KJY1J16VNSZF2G2CK84，run01M6FC44SJVD632Z1Z2JXYTPBE inputs含两批及parent返回runtime.tool-result，不是仅旁观游标。模型两次实际message_send到正确群/respondTo第三句，但均遭social beforeSend“当前没有发言机会；不要重试”拒绝，最终NO_REPLY且无fresh message.out。来源群session不持有当前GroupTurn；该共享gate先于respondTo目标校验运行，不能据respondTo或owner身份偷授lease。

下一修复沿已存在职责边界：无机会错误指出条件化的parent_ask→所属main按核验原件及原群完成的入口；不新建lease/队列，不放松暂停/已可靠回应/权限。主人私有main用既有event身份明确本轮新请求与旧回执边界，结构化JSON文本保留引号但保留&<>及换行安全；不改Bot persona，不改变模型，不把当前失败事后改成通过。规范02/03/11及decisions已先更新，Luna正在最小实现。原对话快照.cache/private-delivery-20261102/26110301-original-conversations.md权限600，最大row16536，14入站/3出站及57条白名单关联事件；不含thinking/凭据。
