# N02 MCP 控制插件

**状态**：进行中；N01 基础边界检查通过，按冻结契约实施。

**负责人**：Codex。

**依赖**：N01。

**功能依据**：11 §1–2；10 §3。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-mcp/
- 根 package.json、package-lock.json、tsconfig.json 的 workspace 接线
- packages/sdk/src/、packages/core/src/plugins/ 中本任务证实必需的适配缺口，先记问题再处理
- 对应插件与 MCP 实际客户端检查

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

实现 MCP 包与真实控制链，插件仅经 SDK 调业务 API；Codex 能从 MCP 提交、观察、取结果和中止。

## 验证与交付

标准 MCP 客户端实际列工具，真实 Luna 工具运行与事件/转录核对，明确 abort；边界检查不使用假模型。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

