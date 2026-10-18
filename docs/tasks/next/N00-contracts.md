# N00 设计锁定与旧规范对齐

**状态**：完成；规范已对齐，产品功能尚待实现。

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

前置探测中一处临时脚本导入错误已修正；记录在 N09。未用宿主成功替代 Yonder 插件验收。

## 结果

- Codex 对齐 architecture、01–09、10、index、AGENTS 和 decisions，删除冲突条款；冻结提交由本次 N00 规范提交确定，具体 hash 在后续任务进度中登记。
- R1–R3：运行所有权/持久关联/快照/终结归 N01/N05；R4：重载引用归 N01/N09；R5：预设输入/状态归 N04/N09；R6–R7：来源和 steer 归 N05；R8–R10：附件、通知、模板、skill 和任务查询归 N09。
- D1–D5 已在 01–09 与 10 明确；D6 的 type 剥离已统一，Mac 为本轮平台，远程接口验收留后续，卡片走渠道工具。
- Computer Use/hosted search/Sol 前置探测写 N06/N09；均未伪称安装版已接通。
- 仅文档变更；链接与 diff 检查通过后提交，直接进入 N01。

