# N04 Luna 首个真实自主修复

**状态**：完成；Yonder 自主源码提交经 Codex 审查整合，0.1.4 安装版的原生子任务转换已真实复验。完整内置工具/路由/投递验收继续由 N09 覆盖，PR 链由 N10 接通。

**负责人**：Yonder maintainer（Luna）；Codex 下发与审查。

**依赖**：N03。

**功能依据**：10 §5；原 T05 与审查 R5 的结果状态缺陷。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/index.ts 的 task_run 结果转换
- packages/core/src/runtime/ 对应该缺陷的检查
- docs/tasks/T05-runtime.md、本任务问题与结果
- 不修改功能规范或无关代码

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

经 MCP 下发一个明确任务，Yonder 自己读相关源码、比较参考模块、形成方案并完成修改和 commit；Codex 审查归因与结果，再按 10 §2.1 安装修复版，供后续任务使用。

## 验证与交付

保留输入事件、会话、模型、工具转录和 commit；检查 error/aborted/limit 的真实映射及原因，安装后经 MCP 复核对应行为与版本。不把 Codex 代写或仅源码检查算作安装版自主修复完成。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- 安装版生产 Runtime.runTask 的真实 error/aborted/limit 转换已复验；临时 SDK 工具驱动原生 task-owned 子会话，不模拟模型或 pi 终态。它不代替内置 task_run 的完整路由/投递验收。
- pi 原生 submission 状态只有 `done` / `unanswered`；模型错误及取消原因由 `unanswered.reason` 表达。运行上限仍由 Yonder 保存的 `state.reason` 判定，不能单凭 pi 状态推断。

## 结果

2026-10-18：Luna 在 `zoran/yonder-maintainer` 分支完成 N04 源码修复；Codex 已先审查只读方案。根因是普通 submit 与 `runTask()` 各自转换 pi `Submission.wait()` 结果，后者将所有非 `done` 且无上限原因的终态错误归为 `aborted`，并遗漏原生 reason。

在 `packages/core/src/runtime/index.ts` 内增加局部 `submissionOutcome()`，由普通 submit 与 `runTask()` 共用，保持普通 submit 原有状态判定，优先保留内核限额原因，并在 `unanswered` 时分类 abort/error、保留原生 reason。仅在 runtime 模块内可测试，不从 `packages/core/src/index.ts` 或 SDK 公共入口导出。

参考依据（按冻结快照）：OpenClaw `cafa09e50556e08c2a04a670f16ac815482c5489`：`src/agents/subagents/subagent-terminal-outcome.ts`、`subagent-run-outcome.types.ts`、`completion/subagent-completion-result.ts`；Hermes `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`：`agent/conversation_loop.py` 的 `_run_conversation_turn()`、`run_conversation()` 与失败终结；OpenCode `214fb7fdbab9ad13773629839f1178382400cf97`：`packages/core/src/session/execution.ts` 的 `terminal()`、settled 调用方及恢复/投影调用点。三者分别体现终态分类与完成文本区分、错误/partial 结果向统一封装保留、成功/中断/失败集中分类。未移植参考项目的架构。

pi-durable 1.3.0 安装依赖核对：`dist/types.d.ts`、`dist/harness/types.d.ts`、`dist/harness/generation.js`、`dist/harness/live.js`、`dist/harness/inbox.js`、`dist/harness/submissions.js`。`Submission.wait()` 的终态为 `done` 或 `unanswered`；取消 reason 为 `aborted`，模型错误/任务 fault 分别可由 `model_error` / `faulted` 表示；上限原因由 Yonder 状态保存。

实际检查：`npm ci --offline` 通过（依赖安装仅写入忽略目录）；`npm run build` 通过；`npx vitest run packages/core/src/runtime/runtime.test.ts` 通过，1 文件、2 测试；`npx biome check packages/core/src/runtime/index.ts packages/core/src/runtime/runtime.test.ts` 完成，无格式错误，报告 2 个原有 `noNonNullAssertion` 警告（index.ts:199、283）。首次 Biome 检查发现测试格式不符，已在允许文件内格式化后复查通过。首次 build 因测试中品牌 ID/终态 fixture 缺少 native envelope 类型报错，改为 native 形状字面值并在测试 fixture 边界作类型断言后 build 通过；未弱化状态断言。

未执行根 typecheck（既有 TS6310 留 N09）、全量测试、真实模型或安装版 MCP 场景；未读取或输出凭据。未创建 PR、未更新服务。

### Codex 源码审查与阶段安装

- 只读方案输入 01M57GB7R32SVG1SA5BECBT5K7；补齐参考/依赖路径后的核对输入 01M57GK7YN6KYWRFG782ZE4MYQ；放行实现输入 01M57GQT7SXQKT81V6FK8DC7J8。均由安装版 0.1.3 的 maintainer 会话 52、openai/gpt-6-luna 执行。
- Yonder 实际完成源码、检查及本地 commit=13ea8d447c3934863508eec6f75a3973446019b2；Codex 阅读四文件 diff、断言与原生工具转录后快进整合，没有代写修复。生产代码共用现有语义的单一转换，没有新依赖、配置、公共接口或模型执行机制。MCP 原始证据 /tmp/yonder-n04-{design,design2,implement}-result.json、/tmp/yonder-n04-implementation-transcript.json。
- 第一份只读方案未完成参考/依赖核对，原因是导航缺少本机检出路径、工作树尚未安装依赖；Codex 提供准确路径后由同一 Yonder 补读，没有伪称首次已完成。一次全 home find 超时，后续限制为指定参考目录。实现提交标题为英文，与本次要求的中文提交格式不符；代码与检查归属不受影响，未由 Codex 改写其提交冒充自主结果。
- 准备唯一版本 0.1.4 进入独立安装版；安装版真实 task_run 的失败、中止、限额验证尚未开始。

### 安装版第一次检查

- 0.1.4 来源 commit=99b019776ff891a0c4ab3403ae9d487d739ebf3d，服务 pid=11455；MCP 输入 01M57H864X3454J2WVGCQQT372、maintainer 会话 52 执行受信任临时程序，导入实际安装 Runtime，以真实 Luna 父运行驱动生产 runTask。
- 成功场景通过（隔离原生 parent=2/child=16，parent status:done、实际模型 openai/gpt-6-luna、input=186/output=27）。随后“上下文渲染抛错应导致原生 error”的检查假设不成立，实际仍为 done，断言失败；limit/abort 未执行。pi 的 section 渲染错误会被忽略，不是本次共享终态转换失效。不为满足检查修改产品行为；上下文错误处理语义另交 N09 核对规范。
- 下一检查改为必需的 resolveSession 解析真实失败，以触发原生 faulted；只重跑尚未通过的 error/limit/aborted，保留本次成功与失败。临时工具仅驱动生产 Runtime.runTask，不模拟模型或原生终态；这不代替完整内置 task_run/路由/投递的 N09 验收。

### 安装版剩余场景通过

- 同一 0.1.4 安装服务经 MCP 调用第二次受信任程序，三个尚未通过的场景全部通过：必需会话配置解析失败 → error/reason:faulted；真实 Luna 子会话执行工具达到一轮限额 → limit/reason:maxTurns；子会话 bash 已创建启动标记后，由原生 Runtime.abort 明确中止 → aborted/reason:aborted。三个真实 Luna 父运行全部 done，用量 input 分别为 191/191/192（output 26/26/25）。
- 每个场景使用独立临时 SQLite/home，原生 parent=2/child=16 是各自数据库中的 ID，不能当作同一常驻会话；测试目录已由程序 finally 清理，未替换真实 home 或复制 OAuth。真实常驻 MCP 控制会话仍为 maintainer=52。
- 完整证据：/tmp/yonder-n04-installed2-result.json、/tmp/yonder-n04-runtime-results.json，第一轮成功与错误假设保留于 /tmp/yonder-n04-installed-result.json。这次检查验证生产 Runtime.runTask 的实际返回和原因，并断言真实模型用量；没有把纯转换字面值检查当作模型验收。
- Codex 负责检查程序、审查、快进整合和本地版本安装；Yonder 负责首个修复源码、本地提交和通过 MCP 实际运行检查。未 push 标签、创建 PR 或 GitHub Release，后续自维护 PR 链属于 N10。

