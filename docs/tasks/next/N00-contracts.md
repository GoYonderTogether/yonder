# N00 设计锁定与旧规范对齐

**状态**：待审核，尚未实现。

**负责人**：Codex。

**依赖**：无。

**功能依据**：10 全文；11 全文。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- docs/spec/10-local-maintenance.md
- docs/spec/11-official-plugins.md
- docs/spec/01-events.md–09-cli-release.md 中受新契约影响的小节
- docs/architecture.md、docs/decisions.md、docs/index.md、AGENTS.md
- docs/tasks/next/、docs/tasks/README.md

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

审核后消除新旧规范冲突，记录范围、冻结 commit、明确允许的核心修复和官方插件边界；任务计划仅保留执行安排。

## 验证与交付

逐项对照用户要求、审查 R1–R10/D1–D6 与新规范，检查交叉引用和旧条款替换；不写产品代码。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

