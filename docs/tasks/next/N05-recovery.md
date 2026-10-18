# N05 输入、运行恢复与投递归属

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

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

Codex 先完整追踪本项目和参考模块，在本任务记录运行事实来源、输入关联持久化、配置快照、终结/投递负责点、拟删除的重复状态与验证步骤，确认符合冻结规范后再交 Yonder 写代码。沿用 N01 的配置边界，统一修接纳、恢复、来源、流式和终结；不新建任务队列或转录。完成后由 Codex 按 10 §2.1 安装，再从 MCP 复核。

## 验证与交付

先完成工作树内检查，再验证安装版真实进程中断/重启，已接纳输入可追踪；提交不重复；followup/steer 来源、取消和完成收尾；发送不确定窗口如实保留。验收通过后即可进入 N09，不等待浏览器或搜索。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- Codex 在等待 N03 登录确认期间，已追踪本项目 kernel → router/sessions → runtime → delivery：路由事件落库后异步提交，但普通输入没有固定 requestId；崩溃后的“已落库／已提交”关联尚未补齐。
- runtime 的 states/submissions 仅在内存中关联实际输入；runState/context 从这些 Map 取来源，重启会丢失，steer 输入也不能仅以 dispatch 当前事件代表。N01 的 RunDoc 已保存配置与上限，但未完成来源恢复和终态收尾。
- router.handledRuns 与 delivery.completed 都用长期 Set 去重；既重复持有状态，也不能提供跨重启凭据。run.end 目前在等待渠道结束后记录，混淆模型完成与送达，应按冻结契约分开。
- waiter 当前被折叠为整轮布尔值，会把一条 ask 的抑制扩大到其他来源；stream active 也在输入到达时占用，而非跟随 pi 实际运行。应按本轮实际 inputs 逐个判定来源，再按目标去重。

## 结果

尚未开始。

### Codex 实施前核对（未交付最终方案）

- 原生 pi-durable 1.3.0 已有“打开后暂停调度”的 Harness、inspect、submission、事务 submissionByRequest/scanSubmissions 与显式 resume；无需为启动恢复再加原生回调或第二条队列。首次 submit/wait 会启用调度，恢复必须在此之前完成。
- 事实边界拟收敛为：y_events 保存输入与路由；pi submission/entry/LiveDoc 保存接纳、放入、实际运行来源和回答；既有 RunDoc 保存开始时配置与上限；单一终结入口记录 run.end 并释放活跃观察者；渠道只记录送达结果，未知发送不静默重试。具体持久关联与发送前后断点需完成参考模块阅读后确定。
- 已完整阅读 OpenCode 当前快照 packages/core/src/session/execution.ts 与 execution/restart.ts：借鉴持久 claim、恢复先于新执行和外部副作用非 exactly-once；不搬入它的 Effect、Job、协调器或重试预算。其余参考链尚未完整读完，不把这份核对称为最终架构方案，也尚未让 Yonder 开始 N05。

