# 后台结果身份与正式版整合验证

用户授权：修复同一飞书消息下连续多次委派的去重，核查新结果实际进入prepared模型上下文并自动续办；整合Claude已提交的提示词、durable内化/重试和beta升级修复，检查、干净克隆、隔离安装通过后发正式版，由现有apply策略自动升级日用版。

## 基线

main `335b188`，日用版`0.2.26102003`（`e177769`）。D45内置底座/两份Agent提示词相关源码已进入03，335b188补齐规范和测试。durable来源为GoYonderTogether/pi `eca1f259bb08f4fa14a96b93b456e4684fe3c450`，workspace 1.3.0，无postinstall补丁；重试配置/分类/恢复沿现有实现，不重新移植。

## 问题与修复

同一飞书msgId触发job5540、6206；6206完成时记录事件错误返回5540的旧事件。原始entry6622含新结果，但prepared entry6626重读旧事件正文，模型NO_REPLY。自动唤醒本身没有丢失。修在store公共入口：runtime.tool-result按(session,job)查重；渠道原消息及命令查重不变，msgId仅为后台事件来源。旧错误历史不覆写、不重新执行已完成副作用。

## 验证与结果

- 默认测试首轮：183通过/17跳过/0失败；全仓lint 0错误、108警告、1信息。
- 新增真实双委派回归首轮：1通过（87.92秒），只注入一条带Feishu msgId的渠道事件；实际两个Luna子Agent分别执行17秒命令生成随机UUID；父Agent通过自动完成输入逐项写回新结果。两次prepared edits包含各自实际UUID，最终DELEGATION_DONE投递。隔离home `/tmp/yonder-delegation-results-F8TLTI`，无真实飞书连接。新源码下全套真实运行中的同用例亦通过。
- 全套真实模型与隔离launchd首轮：199通过/0跳过/1失败（93.97秒），原始日志`/tmp/yonder-dedupe-full-real.log`。失败为原有message-lifecycle测试，模型只输出M43_START就stop，没有调用工具；不是完成通知丢失。实际home `/tmp/yonder-message-live-172RbK`。补明确同一助手消息的commentary+工具调用指令；原消息数、顺序、自动续办、无新用户输入、最终只一次的断言不变。
- 初始新增用例编写错误：store回调误传第三参数触发只读未建表；helper遗漏name触发配置校验；均已修。一次unsafe optional chaining被lint拒绝，已改为明确存在性检查，未放宽规则。
- 流式用例聚焦复验：1通过，34.58秒，`/tmp/yonder-dedupe-message-rerun.log`。随后同一最终源码运行真实模型与隔离launchd全套：60文件/200测试全部通过、0失败、0跳过，92.04秒；日志`/tmp/yonder-dedupe-full-real2.log`。包含重启、HTTP恢复/重试分类/耗尽/abort与timer、工作区fork验证、提示词装配、后台任务和连续委派。
- 新增回归红绿验证：在独立克隆中临时使用旧store源码，1失败/2过滤跳过；恢复修复后1通过/2过滤跳过。日志`/tmp/yonder-dedupe-red.log`、`/tmp/yonder-dedupe-green.log`。没有更改断言来制造通过。
- 最终源码构建/typecheck/lint通过（108 warnings、1 info），无屏蔽或削弱规则。干净克隆 `/tmp/yonder-dedupe-clean-kKUWxi/repo` 的npm ci/build/typecheck/默认测试/lint均退出0，默认183通过/17跳过/0失败。日志`/tmp/yonder-dedupe-clean-check.log`。clone不使用已有node_modules或安装补丁；durable保持固定fork来源、版本1.3.0。
- 原update机制完成独立安装 `/tmp/yonder-dedupe-clean-kKUWxi/install`，固定源码c69e3d3。首次离线home未启动过内核、无state.db，安装成功但更新结果落库给出ENOENT/eventError，未重复安装来伪造回执。之后从这份无.git安装启动隔离内核，doctor通过，真实Luna执行bash返回INSTALLED_DEDUPE_OK并正常done；子进程已停止，不触碰日用launchd服务。证据`/tmp/yonder-dedupe-clean-kKUWxi/installed-evidence.json`。没有把无日用service的安装标成verified自动升级。
- 提示词：内置content/index/home源码与日用03一致；贾维斯SOUL.md与docs/prompts/jarvis稿一致，日用AGENTS.md多出Standing Arrangements（中文回复、maintainer分工、更新职责、凭据不外显），原样保留；默认contexts选用soul-md与agents-md等已配置贡献。旧SYSTEM.md保留在磁盘，当前装配不再读取，不自动删用户文件。
- 版本与流程：03已经有真实release.update-result verified回执（e177769），当前GitHub instance为GoYonderTogether/yonder-harness、apply、approvedAuthors=[zoran-xc]、notifyUpdates=true；没有将组织名误当发布者帐号。旧03的CI run39537394358实际failure，不能照中途通知当成功。本轮等待新CI成功再创建正式04 Release，不创建beta或手工覆盖日用安装。
- 源码提交c69e3d3已合并并推送main，包含原本未推送的D45规范提交335b188；本机日用保留03，等待本次正式Release触发现有自动更新。
- 正式发行：[v0.2.26102004](https://github.com/GoYonderTogether/yonder-harness/releases/tag/v0.2.26102004)，固定提交`c69e3d3c41e7a90085c301c15b9673ff7d21bb57`，作者zoran-xc，isDraft=false/isPrerelease=false。发行提交CI [39538824789](https://github.com/GoYonderTogether/yonder-harness/actions/runs/39538824789) success；含验收文档的main提交743b38d CI [39542536292](https://github.com/GoYonderTogether/yonder-harness/actions/runs/39542536292)同样success。原03的CI失败保留，不冒充从未失败。
- 现有监听自动发现04，原apply作业升级日用03→04；没有手动运行日用update、restart或替换current。最终`release.update-result`事件`01M5EAGB57BKXJKZ7XD1F1CM5X`，updateId `fd0c9bde-3ebe-4357-afb1-637f2f391106`，status=verified、verified=true；服务PID86722、ready=true、version=0.2.26102004、commit=c69e3d3...、home吻合。飞书已连接且history recovery complete。
- 程序通知`01M5EAGEQ805BTSBBVVHA1ZE8E`由plugin:channel-github发送，文本“Yonder 0.2.26102004 已更新并核验。”；delivery.ok=true，飞书ID `om_x100b62b7f94bb4a4df7a91550104607`。这是平台送达回执，不声称用户已读。
- 日用安装中的store修复、内置content.ts和durable/FORK_SOURCE.json与发行源码字节一致；提示词与委派修复现在可在飞书日用测试。保留旧历史错误关联与历史无回执诊断，没有重写账本或重放已完成任务。其余完整渠道/硬件/历史迁移未验场景仍按status保留，不以本轮200测试声称全产品所有组合均已验收。
