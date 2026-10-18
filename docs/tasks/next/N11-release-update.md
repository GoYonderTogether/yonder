# N11 发布事件与 operator 更新

**状态**：待审核，尚未实现。

**负责人**：Yonder maintainer 开发；operator 执行；Codex 审查发布。

**依赖**：N10。

**功能依据**：10 §2/6；11 §6；原 09/T14。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-github/ 的发布事件与更新工具
- packages/core/src/release/、packages/cli/src/index.ts 的批准安装/一次性更新接线
- 安装 home 的 operator 绑定与发布策略
- 本任务独立更新 launchd 作业、安装目录、T14 结果

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

复用 GitHub 客户端接发布，唤醒 operator；实现不随被更新服务退出的一次性更新和重启后的结果核对。

## 验证与交付

真实审核版本发布→一次 release 事件→更新→服务重启→版本/路径确认；失败保留旧安装与真实原因；无用户渠道时不能记已通知。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

