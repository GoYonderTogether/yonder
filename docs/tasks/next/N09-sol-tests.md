# N09 Sol 测试与原契约缺陷修复

**状态**：补测试任务未实施，按用户最新要求留后轮。已知实现缺陷拟并入待审计划 C1/C3；不把 N09 测试完成作为新计划中 GitHub/飞书源码开发的门槛。见 [能力补齐计划](../capability-completion-plan.md)。原验收和下文模型证据保留。

**负责人**：Yonder maintainer（用户指定 Sol）；Codex 审查与介入。

**依赖**：N05、用户指定 Sol 在 Yonder 中实际可用。不等待 N06–N08。

**功能依据**：10 §1/4/7；原 T02–T14/T12 验收。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/cli/test/ 与现有包内测试目录
- packages/core/src/config/、sessions/、prompt/、skills/、tools/、delivery/ 的审查缺陷
- packages/sdk/ 与 runtime/ 仅本任务确认的契约实现缺陷
- 原 T 任务结果、T12 记录、CHANGELOG.md

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

承接 N00/N03 的模型验证，使用真实 Sol 补齐并执行当前具备条件的原验收，修复剩余原契约缺陷；跨任务按原领域分提交。修复按 10 §2.1 进入安装版，再执行依赖它的验收。新增插件各自验证，不让其外部授权推迟核心验收。

## 验证与交付

保留 build/typecheck/test/lint 原始结果及真实模型证据；依赖未来 GitHub/发布/飞书的验收列未完成，在 N14 收尾，不预报通过。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- N04 安装版检查发现 pi 的 section 渲染异常不会直接使 submission 失败，检查程序的故障注入假设因此失败；N04 未为满足检查修改产品行为。N09 需对照上下文契约，核对必需 system/上下文读取失败时的实际报告与执行语义，区分规范空白和实现缺陷。

## 结果

尚未开始。


### N00 前置探测（2026-10-18）

- pi 1.3.0 模型目录包含 openai/gpt-6.1-sol。使用当前 core/dist Runtime、本项目授权凭据与 /tmp 隔离 home 发起真实请求：session=2、status=done、text=yonder-sol-ready，input=167/output=8。未调用工具；这不是安装版或 N09 测试任务已通过。
- 准备脚本首次误从 runtime/index 导入 openDatabase，模型请求尚未发出即失败；修正为 runtime/db 后真实请求通过。临时证据 /tmp/yonder-sol-probe.json。

### N03 安装版模型检查（2026-10-18）

- 独立 home 完成独立 OAuth 后，通过安装版 0.1.3 的 MCP 输入 01M57G0KZYRYDVJ4W80056S6K0，maintainer 的 sol 配置档会话 35 实际调用 bash，工具输出 yonder-sol-installed-ready，原生 run.end 的 model=openai/gpt-6.1-sol/status=done。证据 /tmp/yonder-n03-sol-transcript.json；对应来源 commit=3a154973c958218fd4bccbf8775bf02d91b26119。Sol 在 Yonder 内可用；N09 全部测试仍未开始。
