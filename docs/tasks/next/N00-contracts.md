# N00 设计锁定与旧规范对齐

**状态**：已批准，待执行；本任务负责对齐与冻结。

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

按已批准的 10/11 消除新旧规范冲突，记录范围与冻结 commit，明确核心修复和官方插件边界；包括 01/03 的自定义事件呈现、09 的阶段安装/正式 Release 与独立更新、架构中的阶段范围。逐项处置审查 R1–R10/D1–D6 的适用条款，不让已知空白变成实现者临场设计。

使用已安装入口尽早探测 Computer Use、hosted search 与 Sol 的真实可用性，结果写 N06/N09；只做可逆探测，不实现插件或新增后端。缺登录、权限或不可用时记录具体事实并继续对齐规范和 N01，不把入口存在写成调用成功。

## 验证与交付

逐项对照用户要求、审查 R1–R10/D1–D6 与新规范，检查交叉引用和旧条款替换；不写产品代码。记录冻结 commit 后直接进入 N01，不再请求整轮放行。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

