# 共享Bot设备工具：阶段11验证（完整gate与A9/A12通过）

本页保留当时的命令、原始计数、失败原因与真实短摘录；原始日志与机器转储已按最终清理要求移除。

源基线Yonder 6bed1bc6800754401182eabb2344eded0a365a9b、Cloud 80e92a611938d611b20b9858cac25debb656a469。本文记录实际执行结果；设计或已有work-bridge不等于A9通过。

## 授权与边界

BRIEF §2.7授权设备工具，§2.3允许本仓pi-durable修改。先更新04/19/22规范、decisions与CONTRIBUTING有限overlay例外，再实施。沿真实worker服务身份、DB Bot owner、现work-bridge、设备已接纳Agent defaultProfile/ToolPolicy和原grant；无第二设备连接或模型运行循环。默认cloud不新增exec。owner DM或可核程序refs才有设备目录，访客/群无私密目录。精确行为见spec/19 §8。

## 实际验证

最终完整build/typecheck/test/lint均退出0；2733通过/0失败/112跳过，515文件通过/67跳过，106.11秒；size930/layer109、基线均0。A9真实GLM官方设备插件、A6两租户PG SOUL公开事实、A12新版100Bot均通过。A4真实Luna仍缺仓库规约凭据，未测。下文按执行顺序保留开发失败、修复与证据范围。

## Cloud独立段首轮检查

Root运行cloud根build/typecheck均退出0；server build退出2，唯一TS2304为新增work-bridge.ts调用field未导入。后续server typecheck/test未执行，不记为跳过通过。子Agent仅补已有auth.field导入，UUID校验不变；root重新执行server build/typecheck/test，结果待返回。该次编译失败与后续重跑结果分别按下文保留。

Cloud corrected server build/typecheck均退出0；完整server test为206通过/1失败/0取消/0跳过/0todo，207测试、22suites，51.120秒，退出1。唯一新增case在验证retired拒绝后未恢复mapping便请求unknown场景，生产真实拒绝、测试等不到work.request。修正夹具应先恢复实际mapping，保留retired403与unknown/no-replay全部断言；不增大超时、不变更生产授权。日志摘录：ℹ pass 206 / ℹ fail 1。

夹具修正后，子Agent在cloud/server执行`node --import tsx --test test/realtime.test.ts`：22通过/0失败/0取消/0跳过，3.067秒，日志摘录：ℹ pass 22 / ℹ fail 0。Root随后完整`npm --prefix server test`退出0：207通过/0失败/0取消/0跳过/0todo，22suites，48.889秒，日志摘录：ℹ pass 207 / ℹ fail 0。只改测试复位状态，生产build/typecheck沿已通过证据；Cloud无lint脚本。源码后续若变更须按影响补测。

此server段用真实PG/Redis/HTTP/WS与显式协议响应覆盖权限及帧生命周期；测试中的files_read/files_write响应只是桥传输夹具，不是官方插件、真实设备进程或GLM调用证明，不据此宣称A9通过。

## 原生适配层开发记录（尚未最终通过）

第一轮adapter TSC实际4诊断：toolsRemoved须pi-ai ToolReference[]而非直接string[]两条、program outcome.control判别一条、program args的JSON类型一条。子Agent已窄修并进入第二轮类型检查/原生程序聚焦；结果与完整命令/日志待交，不能据Biome静态通过宣称原生执行通过。

必要overlay先经规范授权：program根ToolTask沿原schema/hooks/intent/output/replay；beforeAgent后Agent解析用当时registry快照；scheduler将真实taskId传环境回调选本task/nested根快照；beforeRequest仅累积删除本次请求已offer工具，保普通调用兼容及原任务调度。确切文件以最终FORK清单为准，无外部fork/安装/发布变更。

一次委派向completed agent仅send_message而未followup启动，造成等待；发现后重新启动并核实际running状态。此段无类型检查或测试执行，未计作通过，也不是环境或架构阻塞。

### Native开发检查最终交付

六轮同命令`npx tsc -b packages/runtime-adapter/tsconfig.json --pretty false --force`，经tee保存。日志不保存进程退出码，下述通过/失败来自实际诊断/命令结果，不补造退出码。TSC1失败4诊断；TSC2/3无诊断通过；TSC4失败3条测试类型诊断（internals及两scope可能undefined），改真实收窄/固定Promise.all；TSC5/6通过。

| Focused轮次 | 实际计数 | 根因 / 修复 |
|---|---|---|
| 1 | 2files/2tests失败 | 两fixture缺必需defaultModel；补现有真实模型配置，程序入口本身不派模型 |
| 2 | 1file/1test失败 | SDK registration经background wrapper成为不支持executeTool的background任务；program改在原生ToolTask内调用原registration，并保留真实diagnostic |
| 3 | 1file/1test失败 | 改实际模型ID仍同失败，确认不是模型配置；原始失败保留 |
| 4 | 1file/1test通过、1file/1test失败 | program报Local execution environment was not provided by this host；openNodeRuntime fixture显式localEnvironment:true |
| 5 | 2files/2tests通过 | 当时聚焦通过 |
| 6 | 1file/1test通过、1file/1test失败 | 新增并发cwd/resources后旧调用计数只预期nested，实际还含cwd-a/cwd-b；保全部真实调用断言 |
| 7 | 2files/2tests通过 | 最终668ms |

Focused1/4–7命令`npx vitest run packages/runtime-adapter/src/runtime/program.test.ts packages/runtime-adapter/src/runtime/host-tools.test.ts`；2/3只program.test.ts。各轮原始计数与失败原因保留在本节。

最终实际断言：真实ToolTask执行nested及cap拒绝、幂等/冲突、SQLite重开不重复、不同scope不同conversation、并发cwd/resources隔离、hold+abort子signal，以及registry refresh不扩另一session冻结工具集或替换schema。相关Biome通过、limits两条既存non-null warning，diff-check0。EnvTarget.taskId seam未单独端到端断言；TS不能代替A9真实设备插件执行。

### 全仓开发类型检查

Root委派的architect执行首轮npm run typecheck退出2，共5条：recordSessionInput漏import、control schema arguments对象类型、profile channelInstances exactOptional、channel endpoint收窄、workspace setup缺capture。窄修后第二轮退出0，日志摘录：> tsc -b --force。

全仓来源相关首轮Vitest为17通过/2失败，8files（6pass/2fail），1.24秒。两个夹具修复：Agent补schema必需bindings:[]；SessionInfo expected误插运行时contexts Map，删除该不应持久字段，不改生产。首轮命令误用plugins/*/src而漏test目录，第二轮改完整plugins/cron和plugins/tasks；不能把首轮8文件当整个相关插件全套。原日志摘录：Test Files  2 failed \| 6 passed (8) / Tests  2 failed \| 17 passed (19)，第二轮17files通过/1skip、62tests通过/2skip，5.42秒。资源缺省/原子拒绝和host恢复更新后第三轮聚焦为19files通过/1skip、65tests通过/2skip，5.69秒，摘录：Test Files  19 passed \| 1 skipped (20) / Tests  65 passed \| 2 skipped (67)；全仓TS第三轮退出0，摘录：> tsc -b --force。

## A9开发回环（尚未通过）

architect执行`node scripts/cloud-worker/device.mjs --program`，使用临时模型key与明确HTTP传输stub（不是GLM验收）。首次退出1，脚本在worker启动迁移前调用ensureCloudDefinition，真实PG缺bot_files；未到设备目录/模型调用。只在建定义前调用现生产migrateCloudWorker(pool)，不改生产迁移逻辑，原输出摘录：`Device verification failed: relation "bot_files" does not exist`。后续运行待结果。

资源语义收口为SDK共用intersectResources：undefined保继承/旧上限，显式[]或实际空交集拒绝；cron/tasks不再先把缺省转[]。更新拒绝原子、混合batch仅改程序指令的条目替换来源，状态/备注保持旧refs。没有新授权流程。ProgramToolsRuntime改为Pick现Runtime三方法与实际descriptor类型，去除单实现重复接口。

A9 --program第二轮退出0：真实临时设备Card登录/mapping/workControl、官方memory plugin经原生ToolTask；owner DM与cron preset均读到实际文件，cron sourceMessageIds与原始平台消息UUID对应；离线下一轮未取得新增私有内容。此轮是明确loopback传输，不是真GLM。随后脚本仅补实际目录与凭据不存在的布尔证据，终态待重跑/真实live。

后续两个实际收口：Cron accessible允许admin访问其他Job，故只在payload更新时刷新source会让delivery/schedule改写仍借旧refs；规范先明确所有显式update/enable重捕获，B已做最小修并补group delivery-only/enable无inputs和无ctx断言，不新增授权平台。task_run相关core/tools首轮32pass/2fail/4skip，两个旧credential-slots Runtime fixture缺invocationContext/Config，补等价fixture方法不改断言。

全仓TS4退出0；最新Cron update构造TS5失败3诊断（ctx收窄2、exactOptional source/resources1），修窄构造、不用[]回退，TS6退出0。最新profile scope窄编译退出0；最新Cron/local-profile/credential-slots为3files/10tests通过，903ms，摘录：Test Files  3 passed (3) / Tests  10 passed (10)。日志摘录：> tsc -b --force及摘录：Test Files  1 failed \| 9 passed \| 2 skipped (12) / Tests  2 failed \| 32 passed \| 4 skipped (38)。

新增独立provider请求回归：host-tools-request.test.ts，真实Runtime/SQLite/ZAI现有glm元数据+明确loopback HTTP临时credential，首请求含动态device_status；实际工具执行后offline，同run次请求无该工具，后置messages-copy hook不能覆盖removal。1file/1test通过，671ms；adapter TS通过，未改生产。输出摘录：Test Files  1 passed (1) / Tests  1 passed (1)；typecheck 亦通过。不把它记为真实模型验收。

## Root真实GLM第一轮（总体未通过）

Root执行`agent-network run -- node scripts/cloud-worker/device.mjs --live`，退出1，输出摘录：Device verification failed: online provider catalogue did not include the frozen device tool schema。真实模型完成online官方memory读文件及offline新内容不可读；最后目录证据断言失败：online provider catalogue did not include the frozen device tool schema。不能只凭前面实际调用成功把整轮A9记通过；该轮凭据不存在断言在失败后尚未执行。模型key元数据0600、TEST_MODEL_BASE_URL未设置、open-file limit1048575已只读核实，不输出key。

排查保留生产源码：原采集器onlineEnd=结果时间+1s并选最新started，会把紧接的offline RunDoc选进online窗口；改为原平台source UUID→真实YEvent/路由session→RunDoc.hostToolInputs精确关联，复用生产PostgresStorage，不在脚本直接import pi/chord或重复生产prepareCommit回放。

共用采集器首次loopback新检查退出1，输出摘录：Device verification failed: loopback provider schema disagreed with committed RunDoc + actual - expected + [] - [ -   'device_28002abcdd76c0b3_memory_search', -   'device_b96a0b7ab59fc01d_memory_read' - ]：安全元数据确认online匹配1run/2工具，offline匹配1run/0工具，Native目录读取正确；失败在新增HTTP严格对比，callback按全history旧nonce分组，offline覆盖online桶。未删断言，改显式online/cronCreate/cronRun/offline阶段及当前最后user输入，采集每次HTTP目录，Cron循真实ExecutionOwner输入链。phase-fixed重跑待结果。此类采集失败不是生产设备/模型失败，也不计作测试通过。

## Root真实GLM修后通过

`agent-network run -- env -u TEST_MODEL_BASE_URL node scripts/cloud-worker/device.mjs --live`退出0；原输出摘录："workerCredentialAbsentFromPersistedCommits": true, / "modelCredentialAbsentFromPersistedCommits": true,。同真实临时PG/Redis/server/Worker和独立本机设备openKernel，实际Card邀请绑定/Agent映射，平台唯一GLM自然请求调用已安装官方memory插件，返回仅在设备独立记忆根文件中的随机内容；输入没有期望值或工具schema/name。设备正常关闭后下一真实模型run未读到新增私有内容。精确原source UUID关联RunDoc在线2个memory工具、离线0；RunDoc是冻结允许目录，不单独冒充HTTP实参。实际HTTP与目录严格相等另由下述同源回环证明。模型/worker凭据不存在于native commits和采集日志的布尔检查均true；不输出值/鉴权头/stack。所有临时服务finally关闭，无桌面操作/截图/生产。

最终传输回环`--program`退出0，摘录："workerCredentialAbsentFromPersistedCommits": true, / "modelCredentialAbsentFromPersistedCommits": true,。owner在线、cron-create、实际cron-run各精确匹配1RunDoc/2工具，offline1RunDoc/0工具；HTTP目录样本分别2/2/2/1次，逐次与对应冻结目录相等。原生cron_manage保存creator refs，真实cron preset自动复核并用原平台消息UUID调用设备官方插件；没有手写ExecutionOwner.inputs、假造SDK ToolContext或用户/assistant转录。这个程序链路为明确HTTP传输stub，不是额外真实GLM cron验收。

Root先行lint发现唯一新增organizeImports错误（sessions/index.ts），仅组织import后解决；warnings1322/info34保留。独立size930生产TS/layer109均通过、基线0；最终完整build/typecheck/test/lint仍待运行。输出摘录：Found 1322 warnings. / Found 34 infos.、摘录：✓ 通过：没有上行依赖。本次只读核验Luna auth env和默认文件仍不存在，真实Luna未测。

## 新版A6/资源真实模型复测

A9后root执行`agent-network run -- env -u TEST_MODEL_BASE_URL node scripts/cloud-worker/verify.mjs --live`首轮退出1。idle143048704 bytes达标；两个实际租户provider均markerPresent=true，Bot1返回PG独有值，Bot2将“Verification source token”理解为内部校验信息并拒绝透露，原拒绝保留。不是共享sections遗漏，也没有改生产prompt绕过。

A6要求回复体现PG SOUL事实，不要求提取内部token。仅重写测试临时PG SOUL追加行为“公开短标语：${marker}。此标语可以向用户公开。”，自然请求为“请告诉我你的公开短标语，只给出标语。”；原默认SOUL文件与全部生产提示词不变，随机PG-SOUL值仍只在PG中，实际provider presence与reply.includes(marker)断言全保，不改模型/retry/timeouts。根再次独占真实运行，结果待返回；输出摘录："rssPeakMB": 208.519168, / "keyAbsentFromLogsAndTranscript": true。该变化是验收事实分类调整，原失败不能删或算通过。

## 当前源码A6与A12通过

A6公开事实重验退出0，输出摘录：`"rssPeakMB": 208.519168`、`"keyAbsentFromLogsAndTranscript": true`。两个tenant各真实首轮均包含并回复仅存各自PG SOUL的公开标语，另有暖轮，共3run完成/pending0；虚拟文件、实际session get/find与插件文件隔离仍通过。idle143245312 bytes、采样peak208519168、末态103497728（自然GC/OS变化，无强制GC）；cold worker query195/209、warm94。模型凭据不存在原始日志和native转录的布尔检查true。此前内部token拒绝原样保留，不改生产prompt或塞期望值到用户消息。

SDK资源边界只读实际复现：base POSIX /workspace/a\b（字面反斜杠），ceiling /workspace/a/b/private原误用win32并错误放行。只把Windows判别收窄为明确根形状，新增POSIX拒绝与UNC保留断言；root SDK tsc退出0、1file/1test通过85ms，输出摘录：Test Files  1 passed (1) / Tests  1 passed (1)。该修复没有改普通路径、模型或业务流程。

A12最终`env -u TEST_MODEL_BASE_URL node scripts/cloud-worker/verify.mjs --load`退出0，输出摘录：`"rssPeakBytes": 318996480`。一个Worker，100不同Bot+1暖轮，active/highWater20、101完成/pending0；idle139362304 bytes（139.362MB），采样peak318996480（318.996MB），末态315015168。PG连接2、TCP3、Timeout2，idle/final相同；PipeWrap1→2，未按Bot增长。无手动GC/额外Bot进程或长连接，50ms采样peak不是全系统内存统计。

100个cold round的Worker Client.query为168–169，mean168.8；warm90。计数只含Worker PG调用，不含server SQL，不叠加Pool；维护查询按实际时间落在哪轮就计哪轮，不人工扣除。相对阶段8记录mean161.8/warm83的观测差值均+7，新来源复核已在当前路径，未把全平台SQL或账单当作此数值。负载用明确HTTP transport，真实GLM少量轮次由A9和上述A6独立完成。测量期间无并行构建/默认测试；测试服务均finally关闭。本机macOS结果不是2核2GB生产共存或长期驻留证明。

## Root最终完整gate与提交收口

| 检查 | 原始结果 |
|---|---|
| 首轮完整build/typecheck | 均退出0 |
| 首轮完整test | 2730通过/3失败/112跳过；513files通过/2fail/67skip，145.07秒；lint尚未运行 |
| 两旧scope fixture | Runtime缺invocationConfig；只补setup时冻结配置及Context方法，原no-model与scope断言保留，10/10定向通过2.48秒，core target typecheck0 |
| 网关contract | 新tools.catalog/call漏统一契约记录；补真实scope/params/result/可信来源与unknown语义，不加allowlist，7/7通过724ms |
| 修后完整build/typecheck | 均退出0 |
| 修后完整默认test | **2733通过/0失败/112跳过**；515files通过/67skip，582files/2845tests，106.11秒 |
| 修后完整lint | 退出0；Biome2048文件，0error/1322warning/34info；size930/layer109、基线0 |
| Cloud独立完整gate | 根/server build/typecheck0，207pass/0fail/0cancel/0skip，22suites48.889秒；无lint脚本 |

首轮输出摘录：Test Files  2 failed \| 513 passed \| 67 skipped (582) / Tests  3 failed \| 2730 passed \| 112 skipped (2845)，修后摘录：Test Files  515 passed \| 67 skipped (582) / Tests  2733 passed \| 112 skipped (2845)；scope定向摘录：Test Files  1 passed (1) / Tests  10 passed (10)，contract定向摘录：Test Files  1 passed (1) / Tests  7 passed (7)。最新Cron fixture开发原始15pass/1fail、9pass/1fail分别保留摘录：Test Files  1 failed \| 5 passed (6) / Tests  1 failed \| 15 passed (16)及第二轮9pass/1fail，均为owner refs陈旧预期/缺message能力的非法夹具；真实合法夹具修后3files/10tests pass见上文定向实际结果，不改变产品与断言目的。

相对固定a6a6c0b5基线无新增失败，不豁免新问题。最终默认skip112与基线相同；没有将源码、transport、真实GLM、实际本机设备进程、物理设备grant、生产部署混为一类。未push/部署/连接zeth-root，未截图/操作桌面；全部临时服务由测试finally/teardown关闭。本报告与结构化证据不包含模型key。
