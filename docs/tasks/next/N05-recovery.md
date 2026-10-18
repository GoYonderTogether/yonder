# N05 输入、运行恢复与投递归属

**状态**：进行中；N04 安装复验通过，Codex 已记录事实与责任边界，先核对原生持久关联，尚未放行业务源码修改。

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

### Codex 实施边界与先行核对

1. **单一事实来源**：输入和路由仍在 y_events；接纳/排队/实际 inputs/回答仍由 pi submission、entry、LiveDoc 管理。普通输入使用会话内稳定的 event 身份作为原生 requestId；task-owned 请求沿用原生 task 身份。恢复先查询原记录，不靠文本相同判重，不加第二条执行队列或转录。
2. **接纳信息**：需要跨重启保留该条输入原来的 wake/busy、是否等待结果和归属会话。优先复用持久 routes 与原生 entry 元数据；SDK 只能增加恢复证实必需的兼容字段，不增加配置 CRUD 或旁路常驻会话 API。先证明这些信息足够恢复，再确定字段。
3. **恢复顺序**：Harness.open 保持原生暂停；先恢复接纳/运行关联、已结束但尚未投影的结果、观察者和必要的上下文快照，再启用原生调度和渠道。已结束的输入只恢复结果，不重新调用模型；尚未提交的原事件才按稳定 requestId 接纳。不要用新的服务或重试循环代替原生 API。
4. **运行边界**：实际 inputs 以原生运行边界/持久回执为准，包含 steer。RunDoc 保留既有配置与上限；ToolContext 的附件和发送豁免从实际来源集取得。内存只保留活跃运行；完成时仅清理该轮，不能清掉已开始的下一轮配置或尚未运行的 followup。
5. **唯一终结负责点**：收敛 router/sessions 的完成处理到同一入口，先持久记录 run.end 的实际输入、状态、模型和回复选择，再释放本轮观察者、结算等待者/临时会话；渠道等待不占住模型执行权。删除 handledRuns/completed 两个长期 Set，只留活跃完成 Promise 的合并与持久事实判重。
6. **投递边界**：每条输入的等待意图只抑制它自己的自动最终回复，之后按目标去重；已开启的其他流式正常收尾。流式所有权跟随实际运行，不在消息到达时占下一轮的位置。发送前保留必要尝试凭据，message.out 记录确认；崩溃后无法证明结果的发送标为未知，不自动重发。必要的私有投递确认元数据只服务这一真实断点，不做通用 outbox/任务编排或供应商重试平台。
7. **附属接线**：远程附件的已下载结果须能由原事件稳定找回，并把规范化附件关联持久输入；版本通知在 pi 真正接纳后确认。沿用已有 IO/取消预算，图片格式/全量工具验收仍由 N09 覆盖，不顺手重构。
8. **先行只读核对**：由 Yonder 在准确参考目录核对并验证原生公开读 API 能否重建“接纳后未投影、steer 合并后已结束、未放置输入被中止”三类关联；明确最少字段和写入原子边界，再交 Codex 审查代码方案。当前不新增依赖补丁或私有 API 绕行；不足就报告具体缺口。
9. **验收边界**：临时 source/home 的真实 Luna 中断检查先行，相关检查通过后才阶段安装；真实安装版的服务中断由 Codex 从服务外执行，Yonder 不杀死正在承载自己的维修进程。验证原事件/原生提交不重复、配置快照和上限保持、followup/steer/等待者归属、单次 run.end 与发送未知窗口；不动主人业务数据。

进一步已读参考：OpenCode 同一快照 store.ts 的 claim/release/listSuspended 及 session-execution.test.ts 的真实责任边界断言；Hermes 同一快照 agent/session_persistence.py 全文和 runtime_session_lifecycle.py 全文，关注持久消息身份、原子 flush 后才确认与生命周期分别结算；OpenClaw 同一快照 src/infra/outbound/deliver-queue-state.ts 全文，关注真实发送前尝试标记和结果未知不重新变成未发送。借鉴这些边界，不移植其额外框架、租约、备用存储或恢复重试。Yonder 还须阅读自己选用方案的必要调用链，不能把本节当作已完成原生关联证明。

### Yonder 首次方案审查

- 输入 01M57HP6MG0MS04R5MDPYAVPRM，由安装版 0.1.4 的 maintainer 会话 52/Luna 完成只读追踪。同步 MCP 客户端因 HTTP headers 超时退出，Codex 通过原始事件和原生转录条目 340 找回结果，没有重发输入；原始副本 /tmp/yonder-n05-progress-latest.json。
- 已证实同组成功 submission 可由同一 answer 归组；queued/placed/settled 可由只读 scanSubmissions/submissionByRequest 重开查询，inspect 单独不含已 settled。尚未实际证明结束旧轮与 successor 同时开始、非成功无 answer 的整组来源以及未放置中止窗口，不能凭“原则足够”放行业务源码。
- Codex 决定先只放行一个 runtime 内的真实原生 API 检查，验证稳定 requestId 重开去重、steer/followup 实际成员与 unplaced abort 回执；产品代码仍待核对结果。必须刻意覆盖 followup 比后到 steer 更早取得 submission ID 的情况，不用 ID 先后猜运行成员。
- 接纳时的 busy 与 waiting 需要随该条输入保存；不能重载后从当前 binding 推断原来的 busy，也不能从连接是否仍在推断原来的等待意图。候选仅为 Route 的必要可选兼容字段，最终字段待检查后确定。
- 原生工具适配当前仅 task_run 标为 replay:safe；agent_ask 默认 unsafe，pi 重启会返回 interrupted/可能部分执行，而非框架自动重放。先核对这一真实路径，不误把它直接描述成“重启必定重复 ask”；不在未证实缺口时新增 SDK 调用身份或更改重放策略。

