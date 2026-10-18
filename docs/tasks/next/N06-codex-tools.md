# N06 Computer Use 与 hosted search 连接

**状态**：待审核，尚未实现。

**负责人**：Codex 核实本机连接；Yonder maintainer 实现适配。

**依赖**：N05。

**功能依据**：11 §3；10 §5。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/codex-tools/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 本任务获准的外部运行程序安装与插件配置，不复制专有实现到源码

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

先验证可调用后端和实际 app-server 协议，固定一种桌面路径；再由 Yonder 实现插件工具、状态和说明。替代后端仅在原路径真实不可用时选定。

## 验证与交付

Yonder 读取获准桌面应用并完成可逆动作；一条真实 hosted search 具有 native webSearch 记录及来源；权限失败单独记录。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

