# 共享最终回复卡片：阶段10验证

Yonder源基线e938a35a，Cloud源保持80e92a6；阶段10无Cloud产品源码变更。源码与测试冻结后由root执行完整gate，末尾记录最终结果。真实模型、组件、原生账本、失败/恢复和配置来源分别记录，不用其中一种替代另一种。

## 实际最小实现

官方channel-card_reply_card与原card_push人工名片草稿分开。参数为标题/正文/按钮及应用内链接，需要message，只作用于当前真实Agent/current Card来源。session/runId单文档存在插件私有PluginFiles，FS与PG同实现；同run最后成功保存的卡片生效。工具只回报prepared/尚未发送，正常完成后由同一最终消息投递，无假消息ID、额外发送队列或全事件扫描。

SDK runId由真实native输入确定并在后台冻结；autoReplySource只在原run仍活动时，按匹配route ID和冻结binding.reply提供当前同conv最后真实message.in。未知binding、reply:none、waiting/caller、console优先或已换run都不给候选。事实不是新授权，插件仍核对来源agent/session/conv/msgId/channel scope。独立元数据测试保留旧runId用于追踪，但不能拿下一轮来源准备卡片。

共享sender先prepare候选，再判断内容/目标与持久run.end，sendPrepared不重跑hook。每次新send/prepare管线调用一遍beforeSend；既有retry直接使用持久outgoing，不重跑hook，不宣称全局exactly-once。Card hook只在成功最终metadata匹配时替换同一条OutMessage。有效card+空final/NO_REPLY仍发送；失败优先真实error，intent按失败run.end清除。message.attempt存完整interactive后清意图，原attempt重试仍有全部按钮与原幂等信息。未知投递不盲重试。

原普通文本run.end到首attempt已有崩溃窗口，没有自动补发；卡片保持此边界，不新增outbox或声称自动补发该窗口。选择文件可保留，不能被称作待发队列。完整attempt恢复、普通文本/卡片同窗口行为与原card_push断言均保留。

通用runtime.environment原首段重写为本机/云worker与工具目标分离；Cloud只用原override资产和实际tool.guidelines，不新造装配机制、人格或few-shot。Cloud客户端只是访问入口；设备能力必须另由真实设备/授权工具证明，不能把模型Card body提到的设备种类当执行验收。

## 开发原始失败与窄修

| 检查 | 原始事实 |
|---|---|
| TS1 | 2条：YEvent内容字段收窄与后台测试exactOptional属性赋undefined；窄修，TS2退出0 |
| 第一集中 | 84通过/1失败/1跳过，9文件（8通过/1失败），31.57秒；新增回归直接改正在跑的LiveDoc导致原background full30秒超时。原full恢复不改断言/时限，独立helper验证旧41/新99与来源时效 |
| 第二集中 | 115通过/7失败/2跳过，18文件（15通过/3失败）；7失败均是新hook漏manifest.contributes.hooks，与真实worker启动失败同根因 |
| 补实际hook清单后插件聚焦 | 36通过/0失败/1跳过，8文件通过，4.01秒；不跳checkRegistrations、不改旧card_push断言 |
| Cloud SSR错误命令1 | root cwd找不到tsx，0通过/1失败，未执行组件断言 |
| Cloud SSR错误命令2 | server cwd未给frontend tsconfig，React undefined，0通过/3失败 |
| 正确Cloud SSR命令 | server cwd，TSX_TSCONFIG_PATH=../tsconfig.json node --import tsx --test ../scripts/chat-render.test.tsx，3通过/0失败 |

原始日志stage-10-focused-{typecheck-development-1,typecheck-development-2,delivery-development-1,suite-development-2,card-plugin-verified}.log；SSR三份日志stage-10-focused-client-ssr*.log已从Cloud验证目录复制到本目录。保留失败，不以最新成功覆盖。

回环脚本开发日志stage-10-focused-card-loopback-development-1至7：

1. 新hook未声明，真实激活error；补清单。
2. 成功interactive没有text，验收assert message却提前对undefined调用redactError；只修验收诊断，不让产品formatter默默接受无效类型。
3. 失败期望503未满足；发现transport.clear复用call ID，改为独立单调序列。但该修复没有解决全部根因，不把下一轮失败抹掉。
4. repeatStop真实保护触发：fixture用最后user判断，误认实际追加的user形态运行段而反复调用同tool；按本次明确输入与实际tool_call_id关联结果，未修改生产repeat保护。
5. 第二turn等待DB结果超时；纯transport负向case需像阶段8一样在首次激活前设retry0/hold0，不改真实GLM默认定义。
6. 配置提早到Worker迁移前，bot_files不存在（42P01）；只移到真实Worker ready/迁移后、首次Bot激活前。
7. 退出0：空final得到同条interactive，tool后真实HTTP503只error且清意图。后续warm/历史过滤另以verified日志确认。

这些是实际夹具/接线问题；没有放宽503、唯一结果、清理、原重复调用保护或word budget来制造通过。

## A8真实GLM：默认定义与自然请求

`agent-network run -- node scripts/cloud-worker/verify.mjs --card --live`退出0。没有指定tool名/schema、没有改默认offer或PG YAML，也没有server手工造卡。自然请求为接入设备与安装客户端的两按钮卡片；真实GLM通过原生tool调用得到唯一interactive/pending结果，独立actions为/connect、/download。native转录含reply_card调用，attempt后意图消失；日志及全部native commits不含真实key，检查只输出includes布尔。未用真实key做反射测试。

[完整真实卡片结果](shared-bot-card-live-20261103.json)，原始stage-10-card-live-first.log。只验证卡片机制、真实工具执行和链接，不为模型生成body中的设备执行描述背书；真实设备能力见阶段11。临时PG/Redis/server/worker均由脚本finally关闭，不是生产或安装验收。

两端实际组件：Cloud原SSR含/connect与/download和旧卡fallback；App在同一fixture保留/get legacy fallback并明确增加/download独立按钮。阶段9App原覆盖是独立link优先和旧fallback，不能倒写为当时已验证两个目标。UI页面/路由/红色实际CSS沿[阶段9](shared-bot-app-20261103.md)有效证据，未重复Chrome或截图。

## 空final、失败与后续对话

`node scripts/cloud-worker/verify.mjs --card`最终退出0，真实PG/Redis/server/worker、明确HTTP传输stub（不是模型通过证据）：空final仍发一张interactive；下一轮真实reply_card后HTTP503只产生唯一error、不发卡且意图清除；随后warm请求不含错误正文或原HTTP503 body、正常markdown不复用旧卡。包括原source槽与实际消息count断言，不只检查API返回ID。

[完整回环结果](shared-bot-card-loopback-20261103.json)，原始stage-10-focused-card-loopback-verified.log。本机FS存储/作用域/覆盖/最终匹配/清理及共享attempt完整card重试分别由已有Vitest夹具覆盖；没有本机真实Luna卡片调用，凭据仍缺。

## 实际reply:none挂起缺口与修复

root只读追踪确认：worker收到合法wake=run后等source.done，但原onRun一开始过滤reply:none；native结束不等于channel回执，因此同Bot后续队列永久等待。不是假设中的防御。规范先明确单结果渠道应报告系统状态，随后只修共享最终路径：waiting=false且singleResult来源保留；native失败先真实原因，done+none只发“本轮来源关闭自动回复，未投递模型回复”，不发送正常模型text，不说动作没执行，绕过beforeSend改卡，仍沿原ledger/source ID/sent。普通本机none与ask/caller静默不变，不由worker外层竞态补发。

- 单元新增4个当前边界：done none、aborted实际失败、local none、ask；delivery整文件44通过/0失败，12.71秒。
- scoped typecheck通过。真实PG/Redis/server/worker连续两输入均唯一固定error，completed2/pendingSources0，后请求不含先前系统error，队列没有挂住。原始stage-10-reply-none-{focused-typecheck,core-typecheck,core-test,worker-verified,focused-biome}.log。

## Root完整gate历史

1. 首次build/typecheck退出0；默认2713通过/2失败/112跳过，文件507通过/1失败/67跳过，104.81秒。两失败是原resident golden应随授权prompt变更更新，以及内置words7309超过7300。lint因&&未执行。
2. 只将既有environment首段72词压到60，整体7297，保原7300上限，按实际纯装配重算golden为7fa0fe0c984b6e2cf18bda4ab334f98523ea13e829aeb177210470f76d05cb16。首次focused用了旧dist仍失败；实际编译bot-core后prompt15/15通过（stage-10-focused-prompt-corrected.log）。此段被Cloud整段override替换，故未改变已通过A8的Cloud prompt。没有删断言或抬上限。
3. corrected完整build/typecheck/lint退出0；2715通过/0失败/112跳过，508文件通过/67跳过，127.04秒；Biome2026文件0error/1325warning/34info，size924/layer108、基线0。随后因确认并修复reply:none真实源码缺口，再次完整gate，最终结果见下。

原始日志shared-bot-core/stage-10-final-*、stage-10-corrected-*及stage-10-complete-*分别保留。后两次完整重跑均有真实源码变化，不拿前一轮成功冒充后一版本。Cloud产品源码未变，本阶段未重跑完整206后端（阶段9证据仍有效）；真实server/worker的卡片/失败/none场景与SSR3项独立运行。未推送、部署、安装、截图或操作桌面，真实Luna仍缺凭据。

### reply:none收口后的最终完整gate

Root执行CONTRIBUTING完整build/typecheck/test/lint，全部退出0。默认 **2719通过/0失败/112跳过**，508文件通过/67跳过（575文件、2831测试），89.51秒。Biome2028文件、0error/1325warning/34info；size924/layer108、两者基线0。日志shared-bot-core/stage-10-complete-{build,typecheck,test,lint}.log。

此结果对应最终源码，包括7297词环境段/golden、真实来源metadata、最终卡片、reply:none源回执修复和44项delivery回归。成功完整后未再变更源码；真实GLM A8与组件证据按上文区分，不把默认测试当模型验收，也不将设备执行描述当已完成A9。无push/部署/原目录写入，root交付报告保持未提交。
