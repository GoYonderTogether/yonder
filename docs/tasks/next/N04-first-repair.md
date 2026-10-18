# N04 Luna 首个真实自主修复

**状态**：已实现（待验收）；源码修改与本地检查通过，待 Codex 审查、阶段安装及安装版真实 task_run 复验。

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

- 安装版 task_run 的真实 `error`、`aborted`、`limit` MCP 场景尚未执行；源码转换检查不替代该验收。
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

