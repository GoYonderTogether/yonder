# X5 真实模型执行链验收

2026-10-19；当前结论：**主路修复内部事件非法引用后，真实Luna单场景验收通过：15秒自动yield、后台期间独立write、自动完成续办与process查询、三软提醒不abort、原生task_run子任务完成。** 本文不把模型目录、接口或源码检查算作实际完成。

## 命令与环境

使用 `agent-network` 与 `credential-use` 规约。命令为：

```sh
agent-network run -- env YONDER_TEST_REAL=1 npx vitest run packages/core/src/kernel/execution-live.test.ts
```

测试须显式 `YONDER_TEST_REAL=1` 且仓库 `.yonder/auth.json` 存在，否则跳过。独立临时home由initHome生成；credentials仅用该auth的绝对路径引用，不复制OAuth、不输出秘密、不改正式home。模型固定 `openai/gpt-6-luna`、thinking=low。

网络无凭据健康检查：api.openai.com，显式HTTP代理来源configured（127.0.0.1:7897），curlExit=0、HTTP421。此项只证明网络响应；随后实际Luna调用证据来自下面的模型转录。

## 单场景与原始材料

父preset `execution-parent`，manual task，standard，提供bash/write/process/task_run；提醒阈值maxMinutes=0.05、maxTurns=1、maxTokens=1。子preset `execution-child`，同一真实模型、readonly、无工具。

完整原始prompt由测试保存为 `<home>/evidence/prompt.txt`：要求bash运行25秒命令（不显式background、不设置kill timeout），自动yield后立即write独立marker，再用task_run要求真实子模型回复SUBTASK_DONE；收到自动完成输入后process查询实际后台状态，最后回复EXECUTION_LIVE_DONE。

第一次 `/tmp/yonder-execution-live-67HbEy/evidence`，1 test failed，30.646秒。测试作者的观测缺陷：全文匹配DONE误命中原始提示词，且二次JSON编码令background字符串断言不匹配，导致提前收尾；不是运行链通过或生产故障结论。后台job21实际成功；independent.marker比background.done早3.719秒，child48已经打开，但被提前收尾中断验收。

第二次 `/tmp/yonder-execution-live-1jRTeZ/evidence`，1 test failed，30.153秒。修正JSON匹配时，旧最终回复匹配仍被已启动测试加载，process断言在续办前执行，再次提前收尾。两份失败原样保留，不计为真实功能通过。当前测试已改为精确pi.assistant最终文本匹配，ToolResult背景句柄按JSON解析。

第三次 **1 test failed，119.644秒**（等待最终回复90秒超时）；独立home：`/tmp/yonder-execution-live-9qzAIl`，证据目录 `/tmp/yonder-execution-live-9qzAIl/evidence`。

- 父session 2；原始session.input事件 `01M5AJBQ5T48V16VKJFD7E7M7W`。
- 自动后台句柄21；原始stdout/stderr文件 `/tmp/yonder-execution-live-9qzAIl/.yonder/background/21.log`。
- `runtime.tool-result`事件 `01M5AJCM1WSGN1W5HGC1YQJ194`：tool=bash、status=done、exitCode=0，真实输出START及BACKGROUND_DONE。
- 软提醒 maxMinutes、maxTurns、maxTokens 均已产生，后续bash仍实际完成，未按这些阈值abort。
- 父run.end事件 `01M5AJCZRQX5WK6K2DEBSR0DRD`：runId=10、status=error、reason=faulted，inputs包含原始输入与后台完成事件。
- 原生SQLite `pi_tasks` id43、kind=pi.generation：terminal.outcome.status=faulted，错误精确为 **`Invalid reference: system:yonder`**。

根因线索：后台完成事件由system:yonder生成；新generation在自动续办处理该输入时引用解析失败。主路需检查prepareInput/prompt/identity的事件from引用解析，不应改断言绕过。第三轮未自动重试；主路随后修复：runtime.tool-result/runtime.warning省略不合法from，保留runtime.*类型、真实parent/routes/conv。主路明确通知后才启动针对第四轮复跑，结果补记下文。

## 修复后的第四轮结果

命令相同，**1 file / 1 test passed，40.20秒**；没有放宽功能断言。独立home `/tmp/yonder-execution-live-HZDxzN`，完整证据 `/tmp/yonder-execution-live-HZDxzN/evidence`：

- 原始提示词：`prompt.txt`；输入回执：`receipt.json`；事件与run：`events.json`；会话：`sessions.json`；父工具/助手转录：`transcript-2.json`；子真实模型转录：`transcript-48.json`；断言事实：`checks.json`；native工具原始时间：`native-tool-timing.json`；测试结果/日志：`result.json`。
- 父session2、runId10，原始输入 `01M5AJFFG6KB5TR3KK9PFDD252`。
- bash后台job21，原生ToolResult entry23记录 **durationMs=15004** 后返回真实background句柄。完整实际stdout/stderr落盘 `.yonder/background/21.log`，原始bash命令与参数保存在父转录。
- 独立write entry39完成时间1792430054983ms，background.done实际mtime1792430060803.528ms：独立工作早 **5.820秒** 完成。
- 自动完成事件 `01M5AJGD85XG19H3MAJDVND0PB` 被父run输入接纳；模型随后实际调用process action=status id21（entry69），查询返回state=terminal、outcome=completed、isError=false、真实exitCode=0及START/BACKGROUND_DONE输出。
- 真实子session48、runId56，`run.end`事件 `01M5AJGDPDDJ6PCBQ7N3SXQ2E2` status=done，子助手实际回复SUBTASK_DONE，工具回传给父。
- maxMinutes/maxTurns/maxTokens三种提醒均记录；父最终助手entry74精确回复EXECUTION_LIVE_DONE，`run.end`事件 `01M5AJGNGWFCD38JV68S0HG7ZK` status=done，inputs同时包含原始输入与后台完成事件，未被软提醒终止。

前三轮失败原样保留：2次测试观测错误，1次真实生产引用错误；最后聚焦复跑通过不抹去这些失败。

## 检查与边界

测试文件经Biome check通过；修正测试log选项调用后整仓 `tsc -b --pretty false` 通过。第一遍测试代码曾把openKernel第二参数写成函数，typecheck准确失败，已改为 `{log}`，没有调整生产实现。

验收条件为：精确真实助手最终回复、process后台终态可查询、独立marker确实早于命令结束、三软提醒不abort、task_run原生子任务run.end=done。这些条件已在第四轮通过，第三轮失败现场仍保留。原始prompt、receipt、events、sessions、每个会话的transcript与测试result由测试保留在各独立home/evidence，不删除失败现场。本次仅覆盖该单场景，不代表所有插件长工具、重启/中断恢复或模型提供商矩阵通过。当前不涉及正式安装、外部消息或日用配置变更。

## afterResponse 单响应子任务通知补验

主路修复单响应结束时漏报用量后，子preset新增 `limits: {maxTokens:1,maxTurns:1}`，仅复跑同一真实Luna场景一次：`/tmp/yonder-execution-live-vZWsfr/evidence`。

原始Vitest结果为 **1 file / 1 test failed，38.676秒**：新增断言写死英文 `input/output tokens`，而真实程序通知已使用 `input/output/cache tokens`；不是缺失通知。该失败完整保留。父session2的真实transcript entry65/71已分别出现：

- `Subtask session 48: Task has used 1 model turns; continue if work remains.`
- `Subtask session 48: Task has used 3353 input/output/cache tokens. Preserve the goal and continue necessary work.`

实际child runId56终态done，事件 `01M5AKB9C7F92N566JHYTM6TXG`；父runId10终态done，事件 `01M5AKBGE8GW20T6WH5BF25S35`。子模型只产生一次最终回答，未为提醒追加模型轮次。

为避免文案脆弱性，最终测试断言关联真实 `runtime.warning` 的kind/session/id与父 `yonder.notification.event`，并要求通知来自 `Subtask session <真实childId>:` 前缀，不搜索原prompt。对本轮已落盘的真实证据执行同一断言重放通过（未再次调用模型）：maxTurns事件 `01M5AKB9C1QS0K7SWMWFZYENC7` 对应父entry65；maxTokens事件 `01M5AKB9C3PVQ8J000X9XQV0AG` 对应父entry71。重放结果保存 `after-response-check.json`。

修改后整仓tsc及该测试文件Biome通过。严格区分：本次原始真实Vitest为failed，事件关联断言在真实留存证据上重放passed；没有将原始失败改记为测试通过。
