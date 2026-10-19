# P0–P5执行与交付记录

## 批准与边界

2026-10-19用户批准P0–P5，先打磨已有功能与真实验收闭环，不新增插件；cron与记忆后置。Sol/Luna并行，主agent负责核心和共享。先查事实再最小修复，不增加额外机制，保留原始失败和未测。用户批准可多测试群并行，采用固定短脚本/隔离原生会话，避免长期占用主会话。源码起点bc4b872；独立正式安装1902/65fa4db，数据与开发隔离。

## 分工与路径

- 飞书Sol：P0/P1，plugins/channel-feishu/；[分路结果](finishing-feishu-result.md)。
- 工具Sol：P3，plugins/browser-skill/、plugins/codex-tools/、plugins/web-tools/；[分路结果](finishing-tools-result.md)。
- 日用Luna：P2与P4证据核对，packages/cli/、既有skill说明/资源；[分路结果](finishing-daily-result.md)。
- 主agent：packages/core/、packages/sdk/、共享构建/安装接线、P4/P5和结果汇总；不改冻结功能规范。

## 当前状态

P0/P1、P2、P3并行检查中；P4复用E06/E07，P5待汇总。完整原验收映射在收尾前记录。所有“未测”保持可见，不以接口/源码/自动检查替代真实场景。

## 原始检查与问题

- 新增原生多CLI渠道验收首次1失败：guest只读配置首先命中能力拒绝（capability-denied），脚本误期望level-denied；前三路真实输入与同主会话回投已过。按实际能力优先契约修正期望，不放松拒绝断言。原日志 /tmp/yonder-p5-native-first.log；继续原脚本剩余场景。
- 飞书群历史真实HTTP400/code230027，缺im:message.group_msg；用户已单独批准补齐及必要应用配置发布。
- 原生多渠道验收第二次1失败：agent_ask已得到helper真实答复，但脚本误将包含no-binding的routes第一条当目标；按事件账本契约同时断言main被忽略及helper实际唤醒。原日志 /tmp/yonder-p5-native-second.log。
- 第一次build/typecheck因新增验收脚本读取可选route.session报TS2345；补实际session存在断言后继续，不放宽产品类型。原日志 /tmp/yonder-p5-build.log、/tmp/yonder-p5-typecheck.log。
- 更多分路原始失败见对应结果，不覆盖既有R/F失败。

## P0 实现修复：平台与本机时钟偏差

原生P1-final-A/B发现平台createdAt比准备时本机Date.now快约4.5秒，导致两次History start must not exceed end、0页背景；原输入和投递未丢失。负责点是conversationContext组装自动查询区间，不能放宽historyPage对用户非法区间的拒绝。

最小修复：固定cutoff取Math.max(Date.now(), ...有效原输入时间)，批量输入同时覆盖最晚已接纳时间，后续分页仍用同一截止；不加时钟同步、重试、等待或丢弃输入。已追全部historyPage调用：显式history工具保留参数校验；catchup水位由本机截止推进，并非这次start来自平台createdAt的根因，不改无实证路径。

回归先于修复失败：1失败/10通过（/tmp/yonder-p0-clock-before.log）；一行修复后11/11通过（/tmp/yonder-p0-clock-after.log）。真实原生失败保留在飞书分路记录。
