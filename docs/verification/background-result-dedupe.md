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
- 其余检查和发布记录待补齐。
