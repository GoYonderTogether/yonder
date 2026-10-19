# 独立后台聚焦检查

只新增 `packages/core/src/runtime/background.test.ts` 与本文件，没有修改生产实现。

## 检查边界

使用真正的 Runtime.open、pi Harness/defineTask 调度、独立SQLite、local env、bash子进程、原始工具registration及Yonder后台wrapper。测试native task driver只选择工具名/参数，通过真实tx.createTask转交原生子任务；没有模拟模型、替代工具结果、fake timers或复制OAuth。没有调用模型，因而不能代表模型选工具、task_run模型子会话、完整beforeTool/afterTool链或渠道通知验收。

## 实际结果

- 短bash保留真实stdout/stderr、exitCode=7、isError、details/fullOutputPath及实际日志文件。
- 真实sleep16命令在约15秒返回后台ID，检查当时仍在运行，原命令继续到真实finished；process.wait读到native terminal与持久原始结果，完成回调归原session，running清空。
- 原生管道read接收process.write输入；process.log offset读取增量输出。另session尝试kill拒绝且原任务仍活着，原session kill成功。
- 原生TaskRecord的conversationId等于调用session、owner不存在（conversation-owned）、background=true。
- Runtime.abort(session)与Runtime.close/shutdown取消自有后台工作；测试读取真实shell/其sleep子进程PID，确认都不再存活，running清空。

执行记录（保留原始结果）：

1. 首跑：1文件1失败，16.61秒。测试误读不存在的TaskRecord.ownership字段；官方类型实际为conversationId/owner/background。修正测试读取真实契约，未改生产实现。
2. 第二跑：1文件1通过，0失败/跳过，16.42秒。
3. 补durable结果与Runtime.abort断言后：1文件1通过，0失败/跳过，16.47秒。
4. shell+sleep PID共同清理最后聚焦复跑：1文件1通过，0失败/跳过，16.56秒。

`tsc -b packages/core --pretty false`在第三跑前通过；最后复跑时主路并行改动出现`kernel/index.ts:814 EventInput不支持routes`，已报告主路，测试文件无TS诊断。局部Biome通过（首轮测试let隐式any与断言风格已修）。

## 未测

- 真实模型连续工作/steer/后台完成自动续跑、task_run原生模型子会话ownership：交主路统一真实模型验收。
- 系统重启/进程崩溃恢复与真实飞书输出通知未在该聚焦检查覆盖。

## 软阈值契约与原子JobPointer适配（2026-10-19）

修改限于background/boundary/limits三个测试文件与本文，没有修改生产代码。

- background native driver补`api.commit`，真实委托当前pi task.commit事务并返回change回调结果；JobPointer与background Task由生产代码在同一原生事务创建。native失败保持完整outcome JSON错误，未用mock替代commit。
- boundary原先等待maxMinutes自动abort的两个测试改为真实160ms延迟后抛明确自定义Error。60ms软阈值触发maxMinutes warning一次，延迟结束signal仍未abort、usage.cost=0，随后按原生失败终止，避免调用模型。prepare错误原文在真实SQLite保留；sections错误公开reason为model_error、原始文字未在检查的任务/entry/submission记录保留，测试验证具体Error确实抛出及公开reason，不宣称有详细持久错误。
- 新增独立explicit abort测试：实际Runtime.abort在context rendering时取消signal，结果aborted/aborted、cost=0，保留显式取消能力。
- limits与boundary真实模型测试maxTurns改为done、reason未设且warning一次；工具拒绝原因、继续轮次、排队后配置生效断言保留；repeatStop硬停和副作用断言未改。本分路不运行真实模型测试。

实际执行（保留失败）：

1. 首次三文件运行：1文件通过/1文件失败/1文件跳过，1测试通过/2失败/3跳过，16.49秒。后台原子路径已通过；两项失败是新测试错误地假设公开reason直接包含自定义Error。
2. boundary首次单独诊断：2失败/2跳过；纠正公开reason后SQLite详细错误断言：2通过/1失败/2跳过（两次）。剩余失败说明sections错误细节未持久保留，并非阈值取消；按真实契约保留公开reason与具体抛出Error校验，已告主路。
3. 最终同三文件：2文件通过/1文件跳过，4测试通过/0失败/3跳过，16.56秒。三个跳过均为默认未启用真实模型条件（limits 1项、boundary 2项）。

最终`tsc -b packages/core --pretty false`与三个测试文件局部Biome均通过。真实模型execution-live由另一分路验收，本结果不代替它。
