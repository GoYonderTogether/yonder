# 共享 Bot Worker：阶段 8 验证（完整gate通过）

本页保留当时的命令、原始计数、失败原因与真实短摘录；原始日志与机器转储已按最终清理要求移除。

工作区为指定的 yonder / cloud shared-core worktree；不连接生产。阶段 7 提交为 `552e80db`。阶段8源码已冻结并完成下述最终完整gate；保留所有开发失败，开发聚焦检查不替代末尾完整gate、真实模型与资源证据。

## 实际组合

`packages/cloud-host/src/worker-main.ts` 启动一个 worker，经同一个 channel-card、`/ws/device`、PG Pool 和持久化 deadline 调度器服务全部 Bot。`openCloudBot` 与真实本机 `openKernel` 共用 `createBot` 和 Runtime；本机零环境通过显式 `environment: none` 选择同一 NoEnvironment，存储仍为 FS / 单 SQLite。PG 定义中的插件选择与各插件 config 交给共享配置校验与注册；已装模块只全局缓存，不按 DB 内容任意 import。

PG 模型目录只暴露平台 `rightapi-glm/glm-5.3-flash`；模型元数据来自已装 pi-ai 的真实 Z.AI 目录，成本属于 SDK 估算，不代表已验证 RightAPI 实际账单。实际模型凭据仅由受信任程序读取。

## 已发生的开发检查

- `摘录：packages/cloud-host/src/open-bot.ts(126,67): error TS2454: Variable 'runtime' is used before being assigned.`：22 条 TS 诊断。第二轮通过；第三轮 4 条 adapter 诊断，第四、第五轮通过。后续改动须重新检查。
- `摘录：Test Files  1 passed (1) / Tests  1 passed (1)`：真实 PG，20 Bot 并发持久化计划；只有一个有效唤醒 timer，detach 后 deadline 保留且各自动唤醒一次。1 通过。
- 无标准输出：实际 `openKernel → createBot → Runtime`、FS + 单 SQLite；显式回环 HTTP 传输 stub 一次请求，运行 done，文件与 exec 访问均拒绝。不是实际模型证据。
- `摘录：Test Files  2 failed \| 2 passed (4) / Tests  3 passed (3)`：文件 2 失败 / 2 通过；测试 3 通过。两个 suite 在导入时失败：错误导入 Cloudflare Photon WASM，Node 无法解析 wbg。已改为实际 Node Photon 处理器延迟创建，不用空图片实现。
- `摘录：Test Files  1 failed \| 52 passed \| 10 skipped (63) / Tests  2 failed \| 201 passed \| 21 skipped (224)`：文件 1 失败 / 52 通过 / 10 跳过；测试 2 失败 / 201 通过 / 21 跳过，19.31 秒。两项失败因为 SDK 目录对外模型 ID 是 `glm-5.3-flash`，不是底层数据键 `chat:glm-5.3-flash`；修正查询实际 public ID，待重跑。
- `摘录：Test Files  1 passed (1) / Tests  2 passed (2)`：修复模型目录 public ID 后，PG runtime services 2 通过，1.29 秒。不是全部阶段检查。
- 首次完整 Worker 回环未通过；数据库已有结果后，验收脚本等待 worker completed 计数的条件超时，失败点 verify.mjs:119。正常清理退出，待核对真实结果和投递链；不得以放宽断言替代修复。
- 增加脱敏阶段诊断后，真实结果明确报 memory 默认配置缺 root/owner/timezone。修复是沿本机默认形状为云端虚拟库提供实际 owner/timezone，不禁用该插件、不接本机目录。
- `摘录："rssPeakBytes": 196591616, / "rssPeakMB": 196.591616,`：真实本机 PG/Redis/server + 一个 Worker 子进程、两租户均得到 markdown 结果。空载 RSS 140,017,664 bytes（140.018 MB），两 Bot 后 RSS 193,298,432 bytes（193.298 MB），采样峰值 196,591,616 bytes（196.592 MB）；active/highWater 均2、PG连接2，TCP资源3、Timeout资源2没有随Bot增长。两次cold轮均155次worker数据库query，包含首次激活/定义/插件装配。没有手动GC。虚拟文件、生产Store会话get/find与插件文件隔离通过；会话ID为租户/Bot内局部编号，不以数字相等误判串租户。尚不能据两Bot结果宣称100Bot预算通过。
- Cloud model-admission 聚焦测试先后各 21 通过；第二次使用既有 pending turn 事实，删除多余一小时 source marker。server build 通过。该两轮计数按上文保留；Cloud 的准入记录见同仓验证文档。
- 该次网络检查仅证明代理/DNS/未认证 HTTP 401 的连接，不能证明业务模型可用。

## 开发期间的包管理错误与恢复

机械子 Agent 误用 `pnpm exec biome`，两处工作区均产生自动工作区/安装行为。Yonder 尝试解析未发布的 `@yonder/design@0.3.26110207` 并 404，生成的 pnpm-workspace.yaml 已删除；原 npm 模块目录、工具版本与 bin 链接经核对仍正常，没有改 npm manifest/lock。Cloud 则创建 .pnpm 安装了 236 包且无 Biome；生成的 pnpm lock 已删除。

Cloud 使用既有精确 npm lock 执行 `agent-network run -- npm ci --ignore-scripts` 恢复，238 包安装 / 239 包审计，退出 0；输出摘录：`added 238 packages, and audited 239 packages in 4s`。未更改依赖清单/lock。曾整文件格式化的 cloud auth/bots 由该写入者恢复其本阶段改动前的已提交内容后重施必要差异，未覆盖其他写入者的文档。后续直接使用现有 npm 工具，禁止再次 pnpm 安装。这是执行错误与恢复，不是基线环境失败或架构阻塞。

## 待验收

两租户实际回环已通过；真实 GLM 读取 PG SOUL、失败唯一结果与历史过滤、真实 cron 经 LRU 后唤醒、100 Bot RSS/每轮数据库往返，以及阶段 8 完整 build/typecheck/test/lint 均待完成；不据上述聚焦检查宣称 A5–A7 / A12 通过。

## 阶段8 Cloud配套提交与完整gate

Cloud提交 `eed0b17b058eaea0d7e26e611df8b8eb5a814d7f`。根/server build和typecheck均退出0；完整server tests 206通过/0失败/0取消/0跳过，22 suites，49.742秒。输出摘录为 `ℹ pass 206 / ℹ fail 0`，详细准入与原始开发结果见cloud同名验证记录。该仓无lint脚本，已运行git diff --check；不冒称lint命令通过。

## A12开发历史：缺主系统段版本的100 Bot测量（不是最终通过）

root 执行 `node scripts/cloud-worker/verify.mjs --load`，退出0；后来A6定位主系统段遗漏，该测量仅作开发历史，不作最终A12。使用真实本机PG/Redis/server、一个真实worker进程（PID77812）和明确标注的HTTP传输stub，不调用真实模型。临时进程/服务由脚本finally关闭；此运行没有手动GC。原输出摘录：`"rssPeakBytes": 304054272`；主要资源数据见下表。测量对应阶段8开发dist（TS8）；后续改动若改变常驻资源/导入必须按影响重测，不能用它替代最终gate或GLM。

| 实测项 | 结果 | 门槛/解释 |
|---|---|---|
| 不同Bot / 实际轮数 | 100 / 101 | 100次cold激活轮 + 最后Bot真实复用一轮 |
| 空载RSS | 141,295,616 bytes（141.296 MB） | ≤150,000,000 bytes |
| 负载后RSS | 302,284,800 bytes（302.285 MB） | ≤350,000,000 bytes |
| 采样峰值RSS | 304,054,272 bytes（304.054 MB） | ≤350,000,000 bytes；50ms采样，不声称捕获所有瞬时峰值 |
| active / highWater | 20 / 20 | LRU实际释放前80个Bot |
| PG连接 | 空载2 / 负载2 | 同一个Pool |
| TCPSocketWrap / Timeout | 空载3/2，负载3/2 | PG+共享渠道；一个持久deadline调度器，不随Bot增长 |
| cold轮数据库query | min155 / max156 / mean155.8 | 包含定义、插件、人格、Runtime激活及本轮持久化 |
| warm轮数据库query | 77 | 相同实际Bot实例复用；Client.query计数，不重复叠加Pool.query |

所有101轮完成，source唯一结果断言通过；两租户虚拟文件、生产Store会话get/find、插件文件隔离仍通过。PG query计数只覆盖worker进程，不含server处理HTTP的SQL；不是TCP包数，也不声称77次全是可删除的额外开销。真实GLM少量轮次仍待完成。

## A7：实际失败传输与后续提示词

以下均由真实PG/Redis/server/Worker与本机HTTP传输端执行，使用每次独立临时model key，不调用外部模型；测试通过PG定义配置真实 `maxRetries:0`、`firstTokenMs:150`、`totalMs:500`，不是假时钟，也不改变生产默认超时。每个场景紧接着再输入成功一轮，核对实际下一次HTTP请求messages，既不含用户看到的error全文，也不含原始503 body。每source结果槽与实际消息数均严格为一。

| 场景 | 实际唯一结果 | 原输出摘录 |
|---|---|---|
| HTTP503 | error：云端模型调用失败：上游返回 HTTP 503 | 摘录："oneResult": true, / "laterPromptExcludesError": true, |
| 空回答 | error：云端模型调用失败：模型返回空回答 | 摘录："oneResult": true, / "laterPromptExcludesError": true, |
| first token真实超时 | error：云端模型调用超时，包含150ms原因 | 摘录："oneResult": true, / "laterPromptExcludesError": true, |
| 即时message_send后HTTP503 | message_send对本轮来源返回真实不支持；最终只有HTTP503 error，没有提前正常回复 | 摘录："oneResult": true, / "laterPromptExcludesError": true, |

四项输出均声明oneResult/laterPromptExcludesError/keyAbsent通过。这里的keyAbsent只证明这些传输的日志和native commits不含临时key；上游反射Authorization值的专门路径另行测试，不用普通错误结果替代。worker离线/暂停/超额/通道断开已经由cloud真实后端检查覆盖；运行中断线的Runtime取消/close、cron逐出唤醒仍待核验。monorepo app的实际error组件尚未完成，故此时A7仍为部分通过。

## 请求凭据在原生持久化前脱敏

沿既有共享 `buildModels` / `withCredentialMark` 处理当前请求实际 apiKey 和认证头值，在错误流或同步抛错进入pi之前精确替换，不另建日志/错误框架，保留HTTP503原因。Node与PG共用该边界。

- TS9新增test缺UserMessage.timestamp，1诊断；补真实timestamp后TS10退出0。
- `摘录：Test Files  1 passed (1) / Tests  1 passed (1)`：本机HTTP503反射临时Authorization，测试1通过/0失败/0跳过，487ms。仅布尔断言，不打印凭据。
- `摘录："oneResult": true, / "laterPromptExcludesError": true,`：独立真实PG/Redis/server/Worker的503-reflect场景通过；source只有一条HTTP503 error，下一轮真实请求不带错误；Worker日志和全部PG native commits均不含反射的临时key。不是仅在显示层遮住日志；也不是以真实key做反射测试。
- 通过后才启动真实GLM验收，实际key仍不进入日志、快照或提交。

## A6：真实GLM首轮未通过

root执行 `agent-network run -- node scripts/cloud-worker/verify.mjs --live`，退出1。真实RightAPI/GLM响应通过“非error”断言，但回复不含测试预先写入PG SOUL的source token，失败于verify.mjs:210。原始日志仅记录脱敏布尔断言，不包含回复正文，因此尚不能区分上下文没有装配与模型未遵从。空载RSS142,524,416 bytes，Worker正常finally清理。不得据收到非error宣称A6通过，下一轮须增加装配/真实session profile的证据并检验新假设，不把token改塞进用户消息。

## 实际在途与排队输入的断线收尾

`摘录："pendingSources": 0,`：真正的第一个HTTP模型请求被hold；同Bot第二条用户source已进入队列后中断Worker。运行中source和排队source各有唯一error，实际模型请求总数仍1，排队source没有偷偷开始。`worker.close()`实测33ms，未触发10秒强杀，说明不是只补server错误而遗留模型/队列。脚本使用临时凭据与真实PG/Redis/server/通道，源处理项在排队前建立，stop通过真实Runtime.abort取消，不以Promise.race伪装任务已停止。

### A6根因：共享组合缺少默认主系统段

新增只读provider调用观测（仅agent/profile/model与markerPresent布尔，不读取headers/credentials）后，回环确认实际session为default/main，非outsider，但provider消息中markerPresent=false。共享createBot只将promptOptions用于prepareInput的turn；此前主系统sections由宿主PreparedBot.runtimeOptions.sections单独提供，本机configRuntimeSections有，cloud没有，因此遗漏全部SOUL/AGENTS主系统段。

按共享根因修复：createBot默认以同一systemPromptParts/systemPromptKeys构造Runtime.sections，保留本机原sections扩展/覆盖与诊断，不新增云专用装配。实现与后续验证仍在进行。上述首次100Bot资源“通过”测量对应缺主系统段的开发版本，只保留原始数据，不能作为最终A12证据；修后必须重新负载。A3零环境/两租户回环也须在正确装配后复核。

### 共享修复后的装配与100Bot负载复验

首次回环同样失败：PG SOUL token没有进入provider messages。共享默认sections修复并TS12通过后，`摘录："rssPeakBytes": 206159872, / "rssPeakMB": 206.159872,`通过：两个owner都为main/default且provider markerPresent=true；真实public visitor DM为outsider，实际请求不含owner私密SOUL；反向Store.get该实际visitor局部ID返回undefined。

root重新执行 `node scripts/cloud-worker/verify.mjs --load`，退出0，日志 `摘录："rssPeakBytes": 312459264, / "rssPeakMB": 312.459264,`。输出摘录：`"rssPeakBytes": 312459264`。同一个worker PID89960，100不同Bot + 暖轮1，100次真实owner provider调用都带有各自PG SOUL marker（仅布尔观测，不捕获鉴权头），101轮完成，pendingSources=0；文件/生产Store会话/插件数据隔离仍通过。此时主系统段实际生效，可作为阶段8 A12资源证据；最终full gate尚待完成，后续导入/常驻行为变更按影响复测。

| 修后测量 | 实际结果 |
|---|---|
| 空载RSS | 136,134,656 bytes（136.135 MB），≤150,000,000 |
| 负载后RSS | 305,233,920 bytes（305.234 MB），≤350,000,000 |
| 50ms采样峰值RSS | 312,459,264 bytes（312.459 MB），≤350,000,000 |
| active / highWater | 20 / 20 |
| PG连接 / TCP资源 / Timeout资源 | 空载与负载都为2 / 3 / 2 |
| cold100轮Client.query | min161 / max162 / mean161.8 |
| warm同实例一轮Client.query | 83 |

计数包括Worker的原生持久化与冷启动装配，不含server进程SQL；相较遗漏系统段的旧版本每轮多6次，属于实际读取人格上下文，不为降低数字跳过IO。资源未用强制GC，测量平台为这台Mac，不冒充生产2核主机实测。少量真实GLM轮次仍须独立通过。

### A6修后真实GLM：通过

root依据明确的新假设（共享默认sections遗漏已修、实际provider markerPresent从false变true）重新执行 `agent-network run -- node scripts/cloud-worker/verify.mjs --live`，退出0。真实本机PG/Redis/server + Worker经RightAPI `https://api.site/v1`、唯一`glm-5.3-flash`完成两个不同owner/Bot的首轮，以及第二Bot暖轮，合计3轮真实调用。两个Bot回复均精确含各自仅写入PG SOUL的独有token；用户消息没有token，实际provider输入的布尔观测为true。原始首轮失败仍保留，未弱化断言。

原输出摘录：`"keyAbsentFromLogsAndTranscript": true`。全部Worker日志和PG native commits经过只输出布尔的密钥存在性检查，`keyAbsentFromLogsAndTranscript=true`。没有输出真实key、鉴权头或完整请求；没有生产访问。脚本finally关闭临时Worker/PG/Redis/HTTP，退出0。

实际worker PID89922；空载139,247,616 bytes、50ms采样峰值195,280,896 bytes、结束97,910,784 bytes。没有主动GC，实际等待/系统回收可能使RSS低于启动值，不将此差值解释成可推广的节省。两次cold query196/200、暖轮87；计数包括真实模型调用期间的Worker维护IO，不能与回环stub短轮当作纯SQL性能对照。两租户文件/生产Store会话/插件隔离继续通过。

## 修后失败路径与真实cron生命周期

共享主系统段修复后，再顺序运行6个真实回环场景：`摘录："oneResult": true, / "laterPromptExcludesError": true,`，全部退出0。HTTP503/空答/真实150ms超时/同源即时发送拒绝后失败仍各唯一error，下一轮实际请求不含error正文；临时Authorization反射不进显示/日志/native commit；双source在途/排队断开只调用模型一次，各error一次，最终close36ms，未强杀。此前开发失败计数保留，不以新成功抹除。

实际 `cron_manage` → PG插件存储/deadline → LRU → 程序模型 → channel sent 的检查在 `摘录："rssPeakBytes": 280674304` 通过，脚本 `scripts/cloud-worker/cron.mjs`：

- 实际创建任务，激活20个其他Bot后原Bot被逐出；到期从PG计划重新激活，只执行一次。
- 真正hold模型HTTP，并施加LRU压力；真实program session为running，目标Bot不被逐出。再hold channel sent ACK并施加压力，仍不逐出；busy包含执行与投递，不将cron launch返回当完成。
- 程序主动投递持久deliveryId只有一条，用户首轮与program共用owner桶，计数为2。
- 同PG/Redis停机跨过第二个missed:skip的due后重启，跳过的任务不调用模型，第一项done不重跑。最终2条cron run（一次done、一次skip）/1次delivery/owner quota3，重启1次。实测采样峰值280,674,304 bytes，不代替100Bot负载数据。

原始cron1失败在脚本line294：捕获请求未清理，误将创建任务的tool result当成真正program请求。只清理旧捕获请求，保留due/激活/LRU/ACK原断言。cron2因state.busy只统计enqueue lease，错误用它断言程序整体忙而失败；修为真实PG running + held HTTP证据，并保留模型/ACK两次真实LRU竞争不逐出。没有为了夹具每50ms向生产state添加PG查询，未削弱真实行为检查。原始cron1/2失败原因及计数保留在上文。

修后本机A3重跑退出0（无标准输出），仍是实际openKernel/createBot/Runtime、FS/单SQLite、显式loopback一轮完成且file/exec拒绝。

## 阶段8最后聚焦与文件门槛收口

`摘录：Test Files  1 failed \| 101 passed \| 11 skipped (113) / Tests  1 failed \| 405 passed \| 26 skipped (432)`：文件101通过/1失败/11跳过；测试405通过/1失败/26跳过，合计432，25.79秒。唯一失败为普通device原来应返回Card send rejected，却透传了worker新增的forbidden文本。保留原测试断言，只对worker透传已鉴权服务端错误，普通device恢复原语义；protocol重跑23/23通过。

后续typecheck退出0，Biome69文件0error/73warning/1info（修正13处格式）。size检查发现models536、background511、channel603、SDK types514四处超500；只机械移既有helper/type，不扩baseline、不增加策略抽象。最终size/layer与默认完整gate待收齐。

## Root最终完整gate与提交前状态

命令严格按CONTRIBUTING顺序：`npm run build && npm run typecheck && npm test && npm run lint`。源码冻结后完整build/typecheck退出0；默认测试 **2703通过/0失败/112跳过**，文件506通过/0失败/67跳过（573文件、2815测试），105.13秒。没有真实Luna凭据，默认跳过仍如实保留，真实GLM为前述独立验收。

首轮lint退出1：3个root新写验证JSON仅格式不符（live、旧load、修后load），源码没有新增Biome错误。使用已有Biome仅格式化这3份文档数据；`npm run lint`重跑退出0，2022文件、0error/1322warning/34info；size923生产TS、layer108、两者基线0。格式不影响源码/编译/测试，未重复未变化的全套测试。原始输出摘录为 `Test Files  506 passed \| 67 skipped (573) / Tests  2703 passed \| 112 skipped (2815)`、`摘录：Found 3 errors.`、`摘录：Formatted 3 files in 2ms. Fixed 3 files.`、最终 `摘录：Found 1322 warnings. / Found 34 infos.`。

最后机械拆分后定向63通过/0失败/1跳过，文件11通过/1跳过，19.28秒，日志摘录：Test Files  11 passed \| 1 skipped (12) / Tests  63 passed \| 1 skipped (64)。size不提高baseline；原消息类型移SDK现有messages.ts并保留公开exports；model合并helper移model-overrides，background可取消sleep复用现有background-tools，channel纯消息/映射/响应解析移既有work/message模块。之后只排序import/移unused，typecheck与对应Biome/size/layer均退出0。open-file limit本轮实际1048575。

此阶段未推送、部署、连接zeth-root、运行安装器、截图或操作桌面。完整原始失败/跳过与通过分别保留；root报告仍不提交。临时PG/Redis/HTTP/Worker均由各脚本或既有测试finally关闭。
