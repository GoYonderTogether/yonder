# 定时唤醒与任务状态：只读研究建议

日期：2026-10-19。此文是待审建议，不是规范或实施授权；未实现插件、未运行模型、未操作服务或正式 home、未提交。

## 判断

先补一个可选的 cron 插件；暂不做专用 goal 插件。cron 必须是真正由运行中的服务按时间产生事件，不能只在提示词里告诉模型“记得稍后做”。模型负责运行内规划，文件/会话负责保存进度，时钟负责运行结束后的再次唤醒；三者不能互相替代。

长上下文、压缩能减少专用任务系统的必要性，却不能证明持久任务事实已经不需要。建议先让模型用现有文件工具维护用户指定的任务文档，保留目标、下一步、完成事实、阻塞与停止要求；不统一强加新的 TODO 文件名或 schema。只有实际出现跨会话查询、并发修改或机器可查询状态的需求，再做可选的任务插件，不加入核心第二条运行循环。

## 官方来源及其支持范围

- [Hermes cron 用户指南](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)：支持一次性和循环作业、管理工具、独立会话及投递；cron 运行内禁用 cron 管理工具以限制递归。skill 是可附带的工作指引，不是调度器。
- [Hermes Persistent Goals](https://hermes-agent.nousresearch.com/docs/user-guide/features/goals)：在每轮后用judge判断并追加继续输入，有预算和暂停。说明它是额外控制机制，不是更长上下文本身。当前Yonder架构明确模型终答结束、内核不追加确认轮；若以后引入目标循环，只能另审可选插件及取消/有限预算，不能照搬成核心默认。
- [Hermes cron 内部设计](https://hermes-agent.nousresearch.com/docs/developer-guide/cron-internals/)：作业持久化到 jobs.json，默认后台按 60 秒 tick 检查到期并执行；调度提供者只控制何时触发，执行路径另有归属。本文仅取其责任分离，不照搬其托管、租约、恢复及投递系统。
- [OpenClaw 当前自动化原理](https://docs.openclaw.ai/automation/cron-jobs/how-it-works)：调度在 Gateway 内，必须保持 Gateway 运行；作业与运行历史持久化。原 cron 页面当前已重组为 Automations，不能引用旧版本 jobs.json 布局当现状。
- [OpenClaw 时间表](https://docs.openclaw.ai/automation/cron-jobs/schedules)：有 at/every/cron；cron 支持 IANA 时区，采用 croner，日与星期的匹配使用 OR。借鉴标准时间表达，不照搬其事件脚本、动态节奏和 heartbeat 机制。
- [Anthropic 长时 agent 实验](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：在跨上下文编码实验中使用功能清单、进度文件和 Git 交接来降低重新理解成本。它支持“外部进度文件可有用”，不证明所有模型、所有任务必须使用 goal 数据库。
- [Anthropic 上下文工程](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：压缩与外部笔记是不同办法，压缩可能丢失后来才显出重要性的细节。本文据此建议先复用文件，不据旧模型实验断言当前强模型无法自行规划。

## 当前仓库证据

- `docs/architecture.md` §5：只经绑定唤醒；模型最终回复即结束；每次运行必须有限；pi 独占转录状态。cron 或 goal 均不能反转这些不变量。
- `docs/spec/02-sessions.md` §2 已给出 `trigger-cron.fired` → `conv:trigger-cron:daily-brief` → 绑定、配置档与 deliver 的示例；busy 使用原生 followup/steer。
- `packages/sdk/src/types.ts`：已有 Trigger.start/stop、events.emit/query/on、tools、contexts 和 paths.data；Hook 只有工具前后及请求前，没有 run-end veto。EventInput 没有调用方指定事件 ID/幂等键。
- `packages/core/src/plugins/index.ts`：启动/停止 trigger 已实装；插件事件必须使用自己的命名空间；data 为插件私有目录；events.on 是观察而非拦截，不应在每次 run.end 无条件再 emit。
- `packages/core/src/runtime/index.ts`：compaction 配置交给 pi；原生 generation hook 执行轮数与时间预算，工具 hook 执行能力和重复上限。无需为 cron 重建模型循环。
- `plugins/context-files/src/index.ts`：现有贡献固定为 AGENTS/USER/SOUL/MEMORY.md，不能宣称任意任务文件已自动注入。任意任务文件可由模型经已有文件工具显式读取；如以后需要自动注入，可选 context 贡献即可。
- 根 package.json、package-lock.json 当前没有 cron-parser/croner/node-cron/rrule 依赖。Node timer 可承载等待，但不解析 cron/IANA 日历规则。

## 最小 cron 形态（待审）

一个独立插件贡献 trigger 与作业管理工具；私有目录保存作业定义、启停和下次时间。计时只计算何时到期，触发 `trigger-cron.fired` 并带作业 ID、原计划时间及任务正文。agent、会话、配置档、busy、投递继续由现有绑定决定；默认建议使用 ephemeral + followup，用户需要连续对话时再绑定 main。插件不直接 submit agent 会话，不自行调用模型，不运行第二个 executor。

实际接线限制：`kernel/index.ts`的配置校验只将真实渠道实例及agent视为有效match.channel，不能直接填trigger-cron。当前可用的最小绑定是显式`match.type: trigger-cron.fired`并用`match.conv: conv:trigger-cron:<job>`限定计划，省略channel/kind/from；现有router按type/conv匹配即可，无需为此改SDK或内核。

时间表达建议仅 `at`（带时区/偏移的 ISO 时间）和五字段 cron + 显式 IANA timezone，暂不加 RRULE、自然语言解析器、事件条件脚本或工作流。相对“20 分钟后”由模型换算成 at；若批准 cron 日历语义，复用一个成熟解析库比自写 DST/日星期规则更小，croner 是现成参考，版本与许可待实施时确认。计时用 Node timer，唤醒后重算墙钟；服务停机或机器睡眠期间不保证准时，更不等于唤醒 macOS 硬件。

调度计划本身是持久状态；一次模型运行是否正常结束仍用现有 run.end，不等于业务目标达成。定时下一次发生由用户授权的 schedule 决定，不由“模型觉得没完成”决定。暂停/删除阻止后续发生，已进入原生队列的工作如何撤销必须说明；取消当前运行与取消整个未来计划不能混为一谈。不要利用 run.end 观察器无限续跑，也不要用自动重建计划来绕过用户取消或运行上限。

## 实施前必须明确的少数语义

1. 离线错过时间：建议循环计划跳过旧发生、仅计算未来；一次性计划明确标为 missed，让用户决定重排，避免启动后突发旧任务。需要补跑则另行批准。
2. 崩溃边界：插件文件与 events.emit 非同一事务，EventInput 又无稳定幂等键，不能声称 exactly-once。若要求不漏且不重复唤醒，须审核最小幂等接纳契约；不能在插件里复制队列/会话数据库。较简模式可在不确定时保留 unknown 并不自动重放，但须让用户知晓可能漏一次。
3. 计划管理权限：管理工具沿用 capability + level；需明确谁能修改哪个作业及目标绑定，不能把已安装可信插件的全局 API 当成模型的任意权限。cron 输入不得悄悄改变自己的计划；首版可在定时配置档中不提供管理工具。
4. 有工作未结束时的同作业后续发生：建议合并/跳过重叠发生，不能按分钟向繁忙会话无限堆 followup。需用既有事件/run 事实关联，不能新增模型队列。

以上是范围内的契约空白，留给审核，不通过默认实现自行补设计。此研究未证明当前运行版存在调度缺陷：当前根本没有通用 cron 插件。
