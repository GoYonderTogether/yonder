# N05 输入、运行恢复与投递归属

**状态**：待审核，尚未实现。

**负责人**：Yonder maintainer；Codex 主持架构并介入阻塞。

**依赖**：N04。

**功能依据**：10 §3–4；审查 R1–R3/R6–R7；原 T05/T07/T09/T11。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/、routing/、sessions/、delivery/
- packages/sdk/src/types.ts 与对应契约检查，仅恢复/取消闭环证实必需的兼容字段
- packages/core/src/prompt/index.ts、kernel/index.ts、store/index.ts 中本闭环必需的关联接线
- 以上模块对应检查和原任务记录

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

按统一 pi 运行事实修接纳、恢复、来源、流式和终结，删除被替代的重复状态；不新建任务队列或转录。

## 验证与交付

真实进程中断/重启，已接纳输入可追踪；提交不重复；followup/steer 来源、取消和完成收尾；发送不确定窗口如实保留。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

