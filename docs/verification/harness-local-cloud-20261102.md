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
