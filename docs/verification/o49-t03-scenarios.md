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

## 第 2 轮补充（2026-10-28）

原始超时保留为失败：隔离库 `/tmp/yonder-o49-t03.hooona/home/.yonder/state.db` 中 run 28 的 generation 29、38 因 steer 中止，generation 45 于 14:34:51.695 开始，14:35:11.837 首 token 超时；14:35:11.863 run 终态 error，四条输入均 unanswered。跨会话 run 75 同样首 token 超时，run 69 成功。配置为首 token 20 秒、`retry.maxRetries=0`；这些记录表明运行以错误结束而非一直卡在队列，但不能区分模型慢与网络慢。延长首 token 时限并恢复重试的复验未完成。

以下每格分别表示本轮实际证据，不以其他入口的通过替代本格。未测不代表产品行为失败；此前 CLI 空闲单条回复 27 基于旧 dist，不计为本轮通过。

| 状态 | 单条 | 连发 | 跨渠道（console + CLI + 模拟渠道） |
|---|---|---|---|
| 空闲 | 未测：本轮未完成真实入口验证 | 未测 | 未测 |
| 忙碌、生成中 | 未测：未确认输入发生时处于生成阶段 | 失败：旧 dist 的 gateway run 28 四条记录后首 token 超时，详见上文；新代码未复验 | 未测 |
| 工具执行中 | 未测：上一轮连接错误，未进入工具 | 未测 | 未测 |
| 等待审批 | 未测：未建立真实审批场景 | 未测 | 未测 |
| 后台任务中 | 通过：隔离 HOME `/tmp/yonder-t03-bg-8Xr39L`，真实 siliconflow V3.2；16:11:18.616 bash 后台 task 22 为 running，16:11:18.619 发送 steer，16:11:20.548 run 10 done 且 inputs 含两条，assistant 回复 `STEER_RECEIVED`；此时 task 仍 running、`abortRequested=false`。vitest 1 通过、0 失败。 | 未测 | 未测 |

后台单条测试前两次插件配置启动失败、一次调用不存在的 runtime API 后中断，均未进入有效场景；关闭 kernel 后后台任务被标记 interrupted，因此不能据此认定后台任务最终正常完成。跨会话旧 dist 结果为一条成功、一条首 token 超时，本轮未复验。显式 followup/interrupt、停止及 wake=write 亦未测。

网页登录流程（源码核对，浏览器实测未完成）：隔离 HOME 执行 `yonder start --home <dir>`，再执行 `yonder ui --home <dir>`，打开其一次性票据 URL，由 303 换取 HttpOnly cookie；不要记录 URL 或 token。直接访问裸 gateway 地址会跳转 `/login`。Vite 默认代理端口 18787 与 gateway 默认端口 7690 不同，且只代理 `/api`、不代理 `/login`；直接打开 Vite 不能证明登录成功。浏览器复验受共享 dist 缺少 `projectRulesFor` 导出阻塞。
