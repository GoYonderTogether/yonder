# N10 GitHub issue 到 PR 与 Codex 合并

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Yonder maintainer 开发；Codex 授权接线、发 issue、审查合并。

**依赖**：N09。

**功能依据**：10 §1/5；11 §6。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-github/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 安装 home 的 GitHub 实例和 maintainer 绑定
- 本项目任务分支、实际 issue/PR；不操作无关仓库

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

Yonder 开发 GitHub 插件，经用户浏览器授权，按 10 §2.1 安装启用后接真实 issue；完成一项真实维修和 PR，Codex 亲自审核后合并。浏览器授权可用 gh/系统打开 URL，不依赖 N06/N07。

## 验证与交付

保存 issue URL→输入事件→会话→方案→commit→检查→PR→Codex 审查/合并；去重、重启游标和自身评论不循环。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

