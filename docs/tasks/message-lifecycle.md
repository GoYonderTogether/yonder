# M43 消息生命周期与长任务交付

状态：完成，已合并main、推送并创建正式Release。授权：2026-10-20 用户要求修复全部已发现问题，完成后直接发版。

## 目标与依据

D43、spec/06 §3、spec/10 §3、spec/11 §7.3：每条模型消息独立气泡；阶段汇报及最终消息独立，工具/后台等待不悬挂旧流；后台完成自动继续且不依赖追问；去重、取消、unknown及CLI契约保留。

## 路径

packages/sdk/src/types.ts；packages/core/src/runtime/{index.ts,types.ts,stream.test.ts}；packages/core/src/delivery/；packages/core/src/store/；packages/core/src/kernel/{index.ts,message-lifecycle.test.ts}；plugins/channel-feishu/{src,test}/；必要CLI消费方packages/cli/src/index.ts；内置进度引导packages/core/src/prompt/content.ts与docs/prompts/builtin.zh-CN.md。设计方先修改spec/06、10、11、decisions及index；发行统一package.json/package-lock.json、CHANGELOG，结果留本文件。

## 验证

真实模型长工具：初始消息先关闭，工具和后台仍运行；无需新用户消息，阶段与最终分别出现，内容及回执不重复。协议回归覆盖多消息、空/NO_REPLY、steer所有权、慢渠道、取消/失败、恢复去重、飞书关闭及节流尾片段，工具参数说明。执行build/typecheck/test/lint，保留原始计数；真实外部飞书未执行则明确未测。

## 问题

现场任务未等待用户追问才发送：07:12:54已开始发送，07:13:32才追问；实际参数错误延迟投递。主要根因是整轮流式协议和生命周期，而非后台唤醒丢失。

## 结果

- 规范先行提交：`3ab394c`；无pi补丁、无新依赖、无新调度器或转录副本。
- 已修：原生消息边界透传、逐消息气泡与回执、最终去重/恢复、后台续办流式缺失、软阈值误用为流式超时、CardKit显式final收尾和节流尾字、长任务进度引导、完整to引用/file URI的schema与说明。空/NO_REPLY不建气泡；控制标记前缀的普通短消息在结束时正常释放。
- build、typecheck通过。默认全量：38文件通过、7文件跳过；167测试通过、12跳过、0失败。聚焦投递/存储/飞书协议：3文件22测试通过。旧真实用例默认跳过，未声称全量真实模型矩阵通过。
- 范围Biome：13文件0错误、36警告、1信息（保留已有断言等）；全仓lint实跑失败：203文件、49错误、101警告、2信息，含`.claude/launch.json`、`bp/`的SVG标题、按钮type及格式等既有问题，不顺手改BP或屏蔽规则。原始日志：`/tmp/yonder-m43-lint.log`；完整测试：`/tmp/yonder-m43-tests-final.log`。
- 真实Luna：独立home、真实pi/SQLite/本机bash及CLI渠道，一条用户输入，18秒后台命令；初始消息关闭早于后台完成，等待消息与后台完成后的阶段/最终消息分别发送，最终只一次，无需追问。首轮1文件1测试通过、45.62秒；证据`/tmp/yonder-message-live-R5ecu6/evidence.json`。最终源码复验同样1文件1测试通过、37.55秒，证据`/tmp/yonder-message-live-jRslmj/evidence.json`，日志`/tmp/yonder-m43-real-final.log`。
- 真实飞书：出站插件+真实CardKit/IM HTTP，独立临时数据目录，只替换接收连接的start以免启动第二个WebSocket；不读取日用对话、不改服务配置。第一条关闭后等待18秒，后续阶段/最终各自新气泡；3个不同message id、3次streaming_mode=false获平台成功确认。证据`/tmp/yonder-m43-feishu-2PcFdx/evidence.json`，执行脚本`/tmp/yonder-m43-feishu-live.mjs`。没有把API确认说成用户已读或桌面目视验收，也没有把接收通道隔离说成完整收发测试。
- 原始中间检查：首次编译报参数名遮蔽/可选字段和新测试onEvent不存在，均修正后build/typecheck通过；一次新测试unsafe optional chaining被Biome拒绝，已修，不改变规则。全量测试没有失败；全仓lint的既有失败仍保留。
- 正式Release：[v0.1.2026102001](https://github.com/zoran-xc/yonder-harness/releases/tag/v0.1.2026102001)，固定提交`cf672d6`（规范先行`3ab394c`，实现/版本统一`cf672d6`），非draft、非prerelease。main与tag已推送。本轮不手工覆盖日用安装，原有GitHub自动更新监听可按用户既定策略自行运行。
