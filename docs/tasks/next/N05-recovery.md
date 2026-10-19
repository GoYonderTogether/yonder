# N05 输入、运行恢复与投递归属

**状态**：进行中；D29（29bc8ec）已获用户批准，Codex 放行 Sol 实施最小原生回执与 N05 核心闭环；保留前轮证据，安装版中断验收尚未完成。

**负责人**：Yonder maintainer；Codex 主持架构并介入阻塞。

**依赖**：N04。

**功能依据**：10 §3–4；审查 R1–R3/R6–R7；原 T05/T07/T09/T11。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/、routing/、sessions/、delivery/
- packages/sdk/src/types.ts 与对应契约检查，仅恢复/取消闭环证实必需的兼容字段
- packages/core/src/prompt/index.ts、kernel/index.ts、store/index.ts 中本闭环必需的关联接线
- patches/pi-durable-1.3.0.patch、scripts/apply-pi-patch.mjs（仅应用必要修改）
- packages/core/src/tools/index.ts 及检查（仅 task_run 唯一终结入口和真实来源接线）
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

### 原生关联探针（Yonder，等待 Codex 审查）

- 新增 `packages/core/src/runtime/recovery-probe.test.ts`；仅该检查文件 import pi。真实检查直接使用 pi-durable 公开 `Harness`、conversation/submission、`watchEvents`、`LiveDoc`、`SqliteStorage.scanSubmissions` API，配真实 `openai/gpt-6-luna`、SQLite 与 `/tmp` 临时 home；没有模拟模型/模型服务器。没有修改产品源码、SDK、规范、依赖或配置。
- 真实验证命令：`YONDER_TEST_REAL=1 YONDER_TEST_AUTH="$YONDER_TEST_AUTH" pnpm exec vitest run packages/core/src/runtime/recovery-probe.test.ts`（本机凭据未输出）。运行通过：1 test passed，约 24 秒。关闭 Harness、DB、watcher 并清理临时目录。
- 可复核结果：A 的 submission ID 9，先排入 followup 的 C 为 14，后排入 steer 的 B 为 15；原生 `run_end.inputs` 明确为 `[9,15]`、随后 `[14]`。因此本次实际证明 B 跟 A 归为同一轮、C 是 successor；该证明来自 pi run 事件及 answer 关联，不使用 submission ID 顺序推算。pi 实际 usage 记录模型 `openai/gpt-6-luna` 的 input 580、output 36 tokens（真实值仅作本次运行证据）。
- 状态/恢复：A 在执行中原生 status 为 `placed`；C/B 在队列中为 `queued`；结束后 A/B/C 均 `done`。显式 abort 的未放置输入在重开后仍为 `unanswered/aborted`，未再提交。重开后 requestId 查找恢复 A/B/C/abort 四条原记录；done submission 分页在 page size 2 时提供下一页。重开后的只读 inspect 与 status/query 没有启动 scheduler（仍 `paused`）；对已完成 A 再 submit 相同 requestId 返回原 submission ID 9/status done，没有新增 admission。提交该 duplicate submit 后 scheduler 转为 running，符合显式 submit 会启动调度的行为。
- 边界：探针直接构造 pi Harness，不运行 Yonder `Runtime`，因此没有真实 Yonder `RunDoc` 的配置快照/usage baseline，也没有证明产品 runtime 的结束记录投影、等待者/渠道归属、发送不确定窗口、重启时在途模型行为。pi `UsageDoc` 可读到本次模型用量，但不能替代 RunDoc baseline。非成功、无 answer 的整组归属也未测。以上为明确未完成项，不据此放行产品源码改动。
- 待 Codex 审查探针与结论；当前不提交。

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


### Sol 会话 35 最终核对（2026-10-18，产品源码未放行）

本轮只修改本任务与 `runtime/recovery-probe.test.ts`，保留 Luna 既有结果；未改产品、SDK、共享根文件、冻结规范、依赖或安装服务，未 commit。已读本工作树入口、07、10 §3–4、上述模块当前完整调用链；复用 Codex 已读参考快照证据，没有重读参考项目或跑全仓检查。

#### 新增的唯一真实场景

- 命令：`/Users/zoran/.local/bin/agent-network run -- env YONDER_TEST_REAL=1 YONDER_TEST_AUTH=<既有授权路径> npx vitest run packages/core/src/runtime/recovery-probe.test.ts -t 'real Luna unanswered'`。实际 **1 passed / 1 skipped**，新场景 54.432 秒；skip 是刻意不运行已通过的旧场景，不是模型失败。模型真实 `openai/gpt-6-luna`，临时 SQLite/home，使用原生 coding bash，没有模型模拟、私有 API 或第二队列。受信任凭据程序按授权使用运行 home 的凭据，未复制或输出值。
- A9 执行第一条 bash 时先 queued C14 followup、后 queued B15 steer；等到 B 原生 placed，`LiveDoc.run.inputs` 为 `[9,15]`，显式 `Harness.abortTask(live.run.taskId)`（不是 conversation.abort，保留 C）。原生 run_end 为 `[[9,15],[14]]`。
- 关闭并重开后，公开 `storage.submission`：A9 `{entry:8,status:unanswered,reason:aborted}`，B15 `{entry:17,status:unanswered,reason:aborted}`，C14 `{entry:19,status:done,answer:25}`，均保留原 requestId，无 answer 的两条没有被重交。只读后 scheduler 仍 paused，LiveDoc 已无 run。
- 公开 entries：A entry8 无 byTaskId；B entry17 的 byTaskId=10；C entry19 的 byTaskId=18。generation10 terminal completed/result.entryId12（第一轮工具调用 assistant）；generation18 terminal aborted；generation20/24 为 successor 的后续模型工作。所有 generation 的持久 input 都是 `{}`，terminal 不保留 checkpoint。**byTaskId 指“谁写下 entry”，不等于稳定运行 ID，也不能把 byTaskId 相同/不同直接当作同组/分组。** C 仍能看到先前工具指令并执行第二条 bash，所以场景约 54 秒；本测试不对 C 的精确最终文本或工具选择作额外产品结论。
- 探针清理：凭据默认已改为 `YONDER_TEST_AUTH ?? resolve(".yonder/auth.json")`；删除影子 RunDoc 定义/查询/输出，明确 bare Harness 没有 Yonder Runtime.beforeAgent，因此此探针不证明产品 RunDoc、配置恢复或 usage 隔离。close 不再 `.catch(() => {})`，清理通过 finally 继续且错误传播。

#### source 核对与关键缺口（不能以“原则上够用”放行）

已完整阅读当前安装依赖 `@earendil-works/pi-durable@1.3.0/dist/harness/{live,inbox,submissions,generation}.js`，公开 `types.d.ts` 的 submission/entry/task/document/storage/Tx 契约、LiveDoc 定义、usage.js；并读 events.js 的 acquisition、翻译及 overflow 契约、tool.js 的 intent/recovery，固定补丁和现有 RunDoc 全部写入/使用路径。

1. `live.endRun` 在同一次原生事务中 settle 实际 inputs 并删除 live.run。`generation.answer` / abort / finishToolRound 可在该次事务中放置 successor 并替换 live.run。LiveDoc 是 history:latest；公开 snapshotAsOf 只允许 rewindable doc，不能事后向 latest 文档索取旧 inputs。
2. `SubmissionRecord.unanswered` 保留可选 entry/reason/detail，但没有 answer、runKey、settledSeq 或结束时 usage；`EntryRecord.byTaskId` 是写入者；`GenerationTask.input={}`，terminal TaskState 不保留 checkpoint。成功时同一 answer 是可靠归组凭据；**不能把成功归组证据外推到无 answer 的所有路径**。entry ID 的实际放置顺序比 submission ID 强，但仍不是公开运行边界回执；不能按相邻 entry、相同 reason 或首末 submission ID 猜组。
3. `watchEvents` 的 run_end.inputs 来自当前进程保留的 before/after LiveDoc，不是持久 run_end 记录；watch overflow 会替换为最新 snapshot。异步 listener 再写 RunDoc，即使通常及时，也有“pi 已 settle/替换 LiveDoc，宿主尚未持久投影就崩溃”的真实窗口。同步 subscribeCommits 是只读观察（不能阻塞/调用 Session API），也不是可向同一次 Tx 增加 RunDoc 写入的钩子。
4. 现有 `Runtime.prepareRun` 只在 beforeAgent 写开始配置；已有 state 时立即 return，既不持久写 actual inputs，也不封存终态。即使改为每次 beforeAgent 保存 inputs，仍有 **postTools 已 place steer + handOver → 新 generation 尚未调用 beforeAgent → abort/崩溃** 的窗口。abort invocation 不保证先调用 agent 解析。现有补丁只增加 beforeAgent 和 abort 的 final boundary，没有同事务结束投影点。
5. 现有 `submit`/`runTask` 在 wait 返回后再读 UsageDoc；这时 successor 可能已产生 usage，按会话 totals 减旧 baseline 会串轮。UsageDoc 同样 latest，晚到的观察者不能查询结束时 totals；后台 compaction/tool usage 也不能仅靠 assistant 文本条目求和冒充全部会话差值。

**精确阻塞**：当前公开的 settled input + entry + latest LiveDoc 加上仅存开始配置/预算的 RunDoc，尚无被证明可跨上述窗口重建非成功整组及结束 usage 的完整持久事实。需要一个与 pi 原生边界同事务的最小 Yonder 关联/结束投影能力（actual inputs、runKey、结束 usage），或等价的已证明公开持久回执；不是新模型重试、第二队列或新转录。当前 API 没有可直接在 endRun 的同一 Tx 中挂宿主写入的入口。此处是原生持久公开数据的缺口，不是“裸 fixture 没 RunDoc”的产品缺陷。修改固定依赖补丁不在本轮两文件授权内；由 Codex 审查这一缺口及最小原子接线后再授权，不擅改规范/patch 或引入存储拦截框架。

#### 最少具体实施清单（原子接线解决后可审查，不把阻塞写成已通过）

- **接纳**：`routing.prepare/dispatch` 为每个成功 route 落库必要可选兼容字段 `busy?: "followup"|"steer"`、`waiting?: boolean`，连同已有 session/wake 同一 y_events append；新事件总是明确写值。`sessions.runTask` 的 session.input 也保存对应等待意图/会话关联（显式预设入口不经绑定）。老记录字段缺失时，不从重载后的 binding 或当前连接猜历史值；已存在 pi submission 可照其持久事实恢复，未提交老记录缺信息须显式报告。普通提交固定会话内 `requestId=event:<event.id>`；task-owned 保留 `task:<taskId>`。不加 request UUID 或 invocation 协议。
- **准备结果**：`prompt.prepareInput` 的规范化附件按 event/session 稳定关联保存到提交 entry 的应用元数据（连同 event ID；queued 时由 pi inbox 保存，placed 后 entry 保存），下载使用可稳定找回的文件关联；不能重启后只保留原远程 URI。版本确认移到原生 admission 被证明成功之后；不在渲染时提前 setVersion。输入正文/附件仍由 pi 保存，Yonder 不复制转录。
- **RunDoc 最少增量**：仍以 `(conversation, first actual submission)` 为 runKey，保留原 config/started/turns/previous/repeats/reason/usageBefore；只增加必要的 `inputs`（原生 submission IDs）、终结凭据（status/reason、成功的 answer 引用或无 answer、usageAtEnd、实际模型）。event ID/来源通过原生 submission→entry.data.event 和 route 取，不另存一份文本/队列。需在实际成员变化和终结边界保持原子一致；开始快照仍在 beforeAgent、模型请求前固定，恢复不重置预算。开始配置、成员/结束事实、Yonder run.end 是三个不同阶段，不声称跨 y_events admission 与 pi submit 是一个事务。
- **唯一终结点**：runtime 依据原生持久边界构造一次完整 RuntimeRun；将 `routing.complete`、`sessions.runTask`、task_run 的结束分支接到同一 kernel 组装的完成入口；`delivery.onRun` 只做回复规划/执行，不再负责模型结束。`store` 在共享 DB 的一个 y_ transaction 内按 `(session,runKey)` 查重并追加 run.end（data 保存稳定 runKey），不使用长期完成 Set。先持久保存实际 inputs/status/reason/model/usage 和确定的回复选择，再结算等待者/关闭临时会话/释放该轮 runtime watcher、timer、state；渠道完成可在后面等待，不占会话模型执行权。
- **串轮修复位置**：`Runtime.prepareRun/saveRun/runState/attachSubmission/submit/runTask/context/contextForAttachment/currentConfig` 都围绕稳定 runKey 和已持久实际来源工作。旧轮清理仅删除它的 state/submission/watcher；删除 session→configured 时必须确认仍指向旧 run，不能抹掉 successor。终结结果使用结束凭据的 config/usageAtEnd，而不是当前 `resolveSession` / 当前会话 UsageDoc。活跃 Map 可以留，长期 `router.handledRuns` 与 `delivery.completed` 两个 Set 删除；并发完成仅用活跃 Promise 合并，finally 删除，跨重启凭持久 run.end 判重。
- **逐输入 waiting / busy**：输出目标筛选先逐输入排除它自己的 waiting，再按目标去重；同组其他来源不能被一个 ask 的 waiter 抑制，error/aborted/limit 同样结算与说明。busy 只用于恢复原接纳策略，不从它推断实际分组，actual inputs 永远由原生边界决定。`ToolContext` 为兼容保留 event，同时仅增实际来源集合所需可选字段，附件读取与 message 能力豁免检查整个实际来源，不能仅取首个 find(Boolean)。SDK 不加配置 CRUD、任意会话旁路或 invocation 身份。
- **流式**：`delivery.onStart` 不在到达时占 active；在原生 run_start/placed 归属明确后按 runKey/target 开流。所有已开流都正常 end，即使该来源后来出现 waiter；释放仅本轮 slot，不碰 successor 的流。恢复不能对已开始但结果未知的流静默新开一条。
- **发送断点**：`delivery.send`、最终 channel.send、stream 的首次外部调用前先 append 私有尝试事实，最少 attemptId、来源 runKey（主动发送则对应调用来源）、resolved target、方式、关联输入；真正调用渠道必须在尝试持久成功之后。message.out 带同 attemptId 作为返回结果确认；若已有 attempt 无确认，恢复列为 unknown 而不是 unsent，不自动重发。run.end/回复规划到 attempt 之间也不能被直接当“未发可重试”；没有完整尝试凭据的历史数据只报告不可判定。明确失败与抛错造成的外部结果不明要区分，不把所有异常伪装为明确未送达。只使用渠道真实稳定幂等能力，不造通用 outbox 或供应商重试平台。
- **启动接线**：`kernel.openKernel` 在 Runtime.open（paused）之后、`loaded.start(router)`/任何 submit/wait/resume 之前，扫描原事件 routes、原生 submissions/entries、RunDoc 和 run.end，先投影已结束、恢复活跃来源及观察者；之后才 admission 尚未接纳的输入与 resume。duplicate submit 虽不重复输入，也会启动 scheduler，所以恢复查询不能用 submit 代替。已经证明终结的结果绝不再次请求模型。
- **agent_ask**：保留 `Runtime.adapter` 默认 unsafe；原生 tool intent 之后重启走 `ToolTask.execute` 的 interrupted / may-have-partially-run，不自动重放 ask。只有 task_run 仍 replay:safe 并沿用原生 task 子会话与 requestId。不要为假设重放新增 SDK invocation 协议。

#### 本轮检查 / 未完成

- `npx tsc -b packages/core --noEmit` 失败：TS6310（project reference 的 SDK 不可 disable emit）；如实保留。改用仅本包检查 `npx tsc -p packages/core --noEmit`，实际通过。
- `npx biome check packages/core/src/runtime/recovery-probe.test.ts` 通过；`git diff --check` 通过。仅该文件格式化，无全仓测试/lint/build。
- 未验证：产品 Runtime 的 RunDoc 原子来源/结束投影、旧轮/successor 配置及 usage 隔离、渠道确认/unknown、安装版中断重启。新原型只证明原生 abort 同组和公开持久数据形状，不能替代这些验收。
- **结论**：成功归组与 queued abort 的既有证据继续有效；新增非成功场景通过。但完整恢复所需的原子成员/终结回执仍有上述精确缺口，本轮不能诚实给出“仅改现有异步观察者即可完整恢复”的放行结论。提交 Codex 审查原子接线点后再写最小产品实现，不继续堆探针或猜测落代码。

### D29 实施授权

用户批准最小原生终结回执，Codex 于 29bc8ec 冻结设计后放行本轮产品修改。采用上述最少清单与原生 doc family 原子回执，不加存储拦截器、第二队列或重试。当前独占路径如上；本轮一个中文本地 commit，不 push/发布/更新服务。此前“不能放行”结论保留其历史归属，原生缺口由 D29 解决，不删除既有失败。
