# N03 独立安装与两个常驻 agent

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Codex。

**依赖**：N02。

**功能依据**：10 §1–2；11 §2；既有 09 安装规范。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/release/、packages/cli/src/index.ts 的必要安装接线
- README.md、README.zh-CN.md、对应 T14 记录
- 已批准安装目录 /Users/zoran/.yonder-harness
- 拟用运行 home /Users/zoran/.local/share/yonder-harness/home 与其 maintainer/operator 工作区
- macOS 本任务 launchd 配置；不修改其他应用服务

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

按 10 §2.1 从已审核本地标签实际安装，建立 maintainer/operator 与源码任务工作树绑定，保留默认 main 的用户交互入口；配置、独立登录、服务启动后经 MCP 使用安装版。完成一次由服务外部发起的阶段更新，后续由 Codex 复用此流程直到 N11 operator 接手。

使用本项目凭据验证 Luna 和用户指定 Sol 的实际 provider/model ID，Sol 结果写回 N09；缺模型或授权不冒充成功，也不阻塞可独立完成的 Luna 场景。

## 验证与交付

记录 executable realpath/version/commit/home/pid；独立于开发 cwd 启动，真实 Luna 调工具并返回，默认 main 可供用户交互；服务停止/启动后继续会话。对两个不同已审核本地版本验证切换后 MCP 调用来自目标安装版，同版本不更新如实记录；重启前没有仍在执行的维护任务。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

