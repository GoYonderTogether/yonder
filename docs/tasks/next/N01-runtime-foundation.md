# N01 配置一致性与运行终止

**状态**：待审核，尚未实现。

**负责人**：Codex。

**依赖**：N00。

**功能依据**：10 §3–4；既有 05/07/08 修订后条款。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/
- packages/sdk/src/types.ts 与对应契约检查，仅本轮取消传播所需的兼容字段
- packages/core/src/sessions/index.ts
- packages/core/src/delivery/index.ts
- packages/core/src/config/、packages/core/src/kernel/index.ts 的配置接线
- 对应 T03/T05/T07/T09/T11 结果与检查

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

实现已批准的运行配置取值与上限，先消除影响安全运行的混用和失控路径；其余恢复工作留 N05。

## 验证与交付

build/typecheck；真实 Luna 运行、配置下一轮生效、工具被拒仍受 maxTurns 约束、重复副作用停止点；每个实际失败保留。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

