# Agent、预设与提示词模板：最小方案

日期：2026-10-19。状态：待用户审核。本文是方案，不修改冻结规范，不代表插件已实现。用户明确不增加通用编码、修bug、GitHub教程或通用技能包；LLM保留任务规划和工具选择。

## 1. 已有的三种对象，别再加一种

- 常驻Agent：有id、owner、工作区、SYSTEM、profiles和bindings。主Agent和持久助理是同一种对象，只是职责不同；进程常驻不等于模型一直运行。
- profile：同一个Agent的模型/工具/权限配置，不是另一个有身份的Agent。main会话不能靠换profile偷偷切权限。
- preset/task：preset是无身份的配置模板，task是按它创建的原生会话。task_run创建父子任务、等待结果并传播父取消；不是注册常驻Agent。

main/persistent/ephemeral/task是会话生命周期，不是四种人格。persistent表示保留会话，不会自动唤醒；ephemeral按事件独立。task的manual策略可连续交互，默认run-end在一轮结束后关闭。

当前本机：

| 对象 | 实际用途与入口 |
|---|---|
| main，Luna | CLI/主人飞书共用main，owner可执行；其他飞书来源observer仅写入背景、不唤醒 |
| maintainer，Sol | GitHub issue按会话持续处理；Agent内部询问默认ephemeral；专项控制会话仍保留原验收历史 |
| operator，Luna | Release和更新结果使用受限release-updater档；五个指定工具，不是通用Bash管理员 |
| preset default，Luna | standard、plugins=[]、instructions为空；没有已经完善的研究员/编码员/审查员任务模板 |

这些是该机home配置。产品init只创建main和default，不自动复制该机的三Agent配置。

## 2. 创建路径：复用文件和原生调用

1. 临时分工：从已有preset调用task_run；无需创建Agent、owner或新工作区。
2. 连续但无独立身份的任务：创建manual task，再submit/续聊；退出客户端不关闭任务。
3. 有独立身份、长期接收事件的助理：创建工作区的agent.yaml和真实职责SYSTEM，登记yonder.yaml.agents，设好身份/绑定及必要权限。现无agents create工具/命令，不编造。
4. 新注册Agent需服务外重启并核对；单改已有agent.yaml或新增preset可热重载，当前run保留原配置。自管理skill说明事实，不自动越权或承诺在自停后继续完成。
5. 常驻Agent互问走agent_ask，目标要有匹配内部agent消息的绑定；preset没有Agent身份，不能用agent_ask冒充另一个助理。当前只有task_run的父子任务具有原生所有权和取消关系；常驻Agent不另建父子树。

## 3. 一个可选模板插件

建议名称`agent-templates`，复用现有contexts + presets槽和随包Markdown/YAML资源，不写新模板引擎，不加角色数据库、模板管理工具或Agent调度器。

拟提供的内容（以下名字均为待冻结候选，不是现有注册名）：

- `agent-templates.base`上下文：接住任务/补充/纠正/停止；授权内完成并核对；真实结果与未知分开；长任务在需要时留简短交接。只写行为契约，不教编码和调试算法。
- `agent-templates.soul`上下文：默认与用户语言一致、直接自然交流；闲聊简短、工作有交付；不编造身份、经历或权限。可不选，不创建虚构人设。
- 四个职责资源：assistant（接话/协调/交付）、executor（完成明确子任务）、researcher（材料与来源）、reviewer（独立审查和具体结论）。职责/输入/产物范围不同，不是四份通用能力教程。
- 对应职责上下文供常驻Agent选择；对应preset用同一份base+职责文本生成instructions。模板文本只维护一份。

重要接线：preset没有Agent工作区，不渲染agent contexts，也不读取SYSTEM。不能仅给preset填contexts而声称角色已生效；它必须带真实instructions。

模板作为可选择的默认内容，不覆盖现存SYSTEM、SOUL或其他用户文件。主Agent启用base、assistant和可选soul；用户继续选用context-files管理自己的AGENTS/USER/SOUL。个人设定不做成通用skill，工具权限不靠角色文字授予。

模型、插件、工具和权限继续使用现有Profile字段；不硬编码该机账号、owner、ChatGPT凭据或未安装插件。具体profile默认值在审核后冻结；模板不能使子任务突破调用方能力交集。研究/审查默认少写权限；真正需要浏览器、执行命令或发消息时由所选profile明确提供。当前标准级别包含exec，不宣称它隔离于宿主。

随包保存可读取的模板资源；自管理skill指导用现有文件工具把所选配置落实到home，用户可修改自己的preset和Agent。插件setup仅注册，不联网、不生成工作区、不自动启用所有角色，不改模型循环。新增插件启用需既有安装/配置/重启流程。

预计源码路径：`plugins/agent-templates/`（manifest、src/index.ts、模板资源、契约检查、README）；根workspace/lock/tsconfig及选用配置只做必要接线。具体允许路径写实施任务，不在此提前搭框架。

## 4. 与其他前置能力的关系

- 自管理skill已创建：仅补Yonder目录/权限/配置/创建和委派事实；正文按需读，不注入所有Agent。
- 媒体：一个media-tools候选插件，通过已配置services调用图片/ASR/TTS/视频，见[核实报告](media-capability-review.md)。无端点不写成功或用聊天模型盲试；首个真实协议和参数需随服务选定后冻结。
- cron：一个trigger-cron候选插件，管理计划、按时间发事件；复用绑定/会话/权限/投递，见[研究](scheduling-goal-review.md)。目前无cron，不把trigger槽冒充功能。建议首版at+五字段cron/IANA时区、管理工具只给获准配置档；循环停机错过项跳过，一次性错过记missed，不启动后突发旧任务；重叠发生跳过，不重复排队；取消计划不暗中撤销已接纳运行。崩溃结果未知保留unknown、不自动补投，不为没有提出的exactly-once要求新增SDK或第二队列。上述建议审核后才冻结。
- goal/task：本轮不加专用插件或skill。模型内规划、已有压缩和用户任务文件足以先用；运行停止后的未来唤醒由cron解决。若以后确有跨运行目标循环需求，再设计可选插件，不在每次run.end默认加judge或续跑。

## 5. 建议下一轮顺序（待审核）

A. 冻结新插件条款及默认职责/权限；不重写pi的运行边界。
B. media-tools与trigger-cron可由两个Sol并行，分别独占插件目录。媒体无真实端点时明确阻塞，只推进已确定部分，不虚构适配完成。
C. 主路负责agent-templates、SDK/CLI共享接线、真正主Agent的选择配置；若A确认现有SDK够用，不为插件额外开接口。
D. 只做各插件必须的契约检查和最小真实链：安装版选择模板→委派一个子任务；定时事件→绑定→一次运行→来源回执；有实际授权媒体端点才做该能力调用。不重跑全仓功能矩阵、不顺手扩大场景。

新插件尚未实现，也未改变本机角色、调度和媒体配置。本方案不自动授权新增费用、凭据、服务权限、安装或发布；已有明确授权仍有效。
