# N08 grep、Bash、Tavily 与 Web Fetch

**状态**：待审核，尚未实现。

**负责人**：Yonder maintainer；Codex 审查核心适配。

**依赖**：N07。

**功能依据**：11 §5；原 05/07 的文件与工具约束。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/ 的 grep、能力表和 Bash 必要适配
- plugins/web-tools/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 对应检查与原任务记录、安装 home 的批准凭据引用

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

复用 pi Bash，增加真正只读 grep，移植 Web 工具并接通 Tavily Search/Extract；Codex hosted search 沿用 N06。

## 验证与交付

实际文件检索与路径边界、Bash 取消/退出码/输出；真实 Tavily 搜索和 Extract、文章读取/登录提示；与 hosted search 分别记录。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

