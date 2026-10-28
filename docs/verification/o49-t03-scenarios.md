# O49 T03 连续输入场景矩阵

范围：默认 steer、同一会话的原生队列及显式停止/策略；期望不等于已实现或已实测。以下真实验证使用临时 HOME 和 `siliconflow/deepseek-ai/DeepSeek-V3.2`，基于验证当时的 dist，**不是本次新改代码的验收**。证据：`/tmp/yonder-o49-t03.hooona/home/.yonder/state.db`；临时路径可能被清理。

| 状态 | 单条及连发的期望 | 本次验证 |
|---|---|---|
| 空闲 | 首条接纳并启动运行；之后到达的输入按当时状态处理，不承诺时间窗口内必然合并 | CLI 回复 27，通过 |
| 忙碌、生成中 | 同会话默认 steer，已排队输入按原生 all 消费，旧生成中止并接入当前运行；不把已显示内容当作可撤回 | gateway 同会话四条均记录在 `run.end.inputs`，但首 token 超时、终态 `error`，未确认输入时处于生成阶段，未验证成功回复 |
| 工具执行中 | 默认 steer 不取消工具，工具结束后并入待处理输入；显式 interrupt 请求取消，已产生的外部副作用不能回滚 | 连接错误，未进入工具；行为未测 |
| 等待审批 | 不绕过或自动批准审批；新消息接纳、响应时机及取消边界需通过真实审批场景核实 | 未测；尚不能断言能立即响应 |
| 后台任务中 | 新输入按所属会话的实际运行状态处理；后台结果沿已有续办路径接纳，不把后台任务完成当作已验证 | 未测；任务能否在回复后继续需实测 |

| 来源组合 | 期望 | 本次验证 |
|---|---|---|
| 同渠道、同会话连发 | 待处理输入按 all 消费，不添加定时收集窗口；不能保证已经消费的消息与后到消息同批 | gateway 四条均记录在 `run.end.inputs`；首 token 超时、终态 `error` |
| 跨渠道、同会话 | 仅实际路由到同一会话的输入可合并；保留各输入来源和回复目标 | 未测 |
| 跨会话（含同渠道） | 各会话独立运行和排队，不跨会话合并 | 两个独立 run；一条 `A-319` 成功，另一条超时 |
| 显式 followup / interrupt 或停止 | 遵循显式模式和取消操作，不把普通输入当停止命令；分别检查工具取消及结果 | 未测 |
| `wake: write` 或不匹配绑定 | 不因默认 steer 越过绑定、权限或唤醒策略 | 未测 |

源码依据：`packages/core/src/runtime/index.ts` 固定两个原生队列为 all，并把缺省 busy 映射为 steer；`packages/core/src/routing/index.ts` 对绑定缺省使用 steer；`packages/core/src/kernel/console.ts` 的隐式 console 绑定继承 main 的 profile，但不继承其 busy，显式 console 绑定优先；`apps/app/src/ui/Composer.tsx` 中网页 task 默认 steer，经 `sessions.submit` 提交，Bot 输入经 `bots.send` 和 console 绑定；`packages/core/src/sessions/index.ts` 对提交缺省使用 steer；`packages/cli/src/terminal.ts` 普通提交使用 steer，另有 followup 动作。本次新改代码的入口覆盖及端到端行为仍须实测。

历史证据另见 [continuous-input.md](continuous-input.md)：其中记录了 2026-10-21 隔离真实模型测试及微信真人连发验收，也列有未覆盖项；这些旧结果不能替代本次矩阵逐项验收。
