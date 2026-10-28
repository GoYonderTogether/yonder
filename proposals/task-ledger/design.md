# 统一任务账本（task-ledger）：设计与执行计划（提案，待维护者批准）

状态：提案。不改 `docs/`、不改代码。采纳后按 AGENTS.md 第 7 条先改 docs、在 `docs/decisions.md` 记一条。
前置阅读：`proposals/goal-mechanism/design.md`（分支 yonder/goal-mechanism-design）、`proposals/context-keeper/design.md`（分支 yonder/context-keeper-design）。本方案建立在两者之上，不重复其论证。

## 1. 要解决的问题

维护者在飞书里同时面对 Jarvis 和 Hermes 两个窗口，十几条任务线：任务只存在于模型上下文里，上下文串了、压缩了、做一半停了，就没人知道；回头也没有清单；Agent 之间互不可见。

对照业界（调研结果）：
- OpenClaw：每个子任务有独立 session 和 run ID，是被追踪的 background task，完成后推送回发起的聊天。
- Codex：桌面应用每个任务是独立线程，有状态列表；CLI 另有持久 `/goal`（目标、预算、每回合注入 continuation、预算到期软收尾、完成前对照证据审计）。
- 反面证据：Codex 0.152 把 `update_plan` 改为默认关闭；Claude Code 的 todo 工具对新模型不再默认提供。**“强制先建计划”没有公开证据，“持久目标 + 每次唤醒重现 + 软预算”有。**

所以复刻的对象是 Codex 的 `/goal` 机制，不是 `update_plan` 清单；并且和 goal-mechanism 提案的结论一致：记录与提醒由系统做，完成的判定仍归模型（不变量 6）。

## 2. 分层

```
L3 投影层   桌面悬浮窗 / 网页 / 图片(IM) / 回复尾部清单     只读 TaskBoard，不含业务逻辑
L2 展示路由  tasks_show({target})：Agent 自己选在哪里呈现
L1 账本与工具 tasks 插件：任务对象、状态机、默认工具、可见范围、守护
L0 内核事实  事件账本、session、task_run/agent_ask（已有，不改）
```

### L1 账本（核心）

任务对象（追加式事件存储，不改旧事件，符合不变量 1）：
`id, ownerAgent, session, parent, title, objective, acceptance[], nonGoals, budget{wallMinutes, wakeups}, state, deliverable, origin(渠道/会话引用), lastActivityAt`。
状态：open → active → waiting-user | blocked | review → done | cancelled。进入 done 必须写 deliverable 与对照验收的证据（模型自己写、自己对照，内核不判定）。

默认工具（Codex goal 同构）：`task_open` / `task_update` / `task_done`（含完成前对照证据的提示语，复刻 continuation.md 的审计段）/ `task_list` / `task_get`。

可见范围（沿用能力模型，不新建权限体系）：
- 默认：Agent 只能读写自己的任务；
- 主 Agent 能读自己和自己 sub-agent（`parent` 链）的任务；
- 持有 `cross-agent` 能力的配置档（管家）能读全部 Agent 进行中的任务，并可 `task_nudge`。

每次唤醒的重现：`placement: turn` 的上下文贡献，“变更时完整、平时一行”（goal-mechanism §5 P1 已论证 token 开销），含已用时间、唤醒次数、距上次交付的间隔。目标存在账本而不是转录里，压缩不会吃掉（Codex #19910 的教训）。

### 守护（“不能中途中断”的现实做法）

不做硬拦截（抵触不变量 3/6/7，且 goal-mechanism 已论证不能打断无界目标）。做三条软机制，全部走既有事件通道：
1. **滞留催办**：任务 active 超过 N 分钟无进展、且没有后台等待或 `task_continue` 接纳的续办，账本向 ownerAgent 的会话投递一条带来源标记的输入（不是“你确定完成了吗”，而是“任务 X 已 N 分钟无进展，当前状态是…，继续/标记 blocked/标记 waiting-user 三选一”），有去重与频率上限。
2. **管家催办**：`task_nudge` 由管家主动调用，走同一通道，经目标 Agent 自己的绑定，不绕过权限。
3. **用户清单**：见 L3 尾部清单；`waiting-user` 超时由程序（不唤醒模型）提醒用户。
预算到期只改变提醒措辞为“汇总、交付或说明为何延长”，不截断（不变量 7）。

### L2 展示路由

`tasks_show({target:'desktop'|'web'|'channel:<ref>', view:'board'|'detail', id?})`。账本只产出一个 `TaskBoard` JSON；谁渲染由 target 决定：
- desktop / web：interaction 只做“渲染渠道”，接收 TaskBoard 渲染卡片列表（截图那种样式）；不再含任何任务逻辑。
- channel（飞书/微信/其他）：服务端把 TaskBoard 渲染成图片，经已有媒体出站发送。图片渲染选成熟方案（SVG 模板 + resvg），不自己写渲染器；不可用时退化为文字清单。
- 回复尾部清单：程序化附加（不经模型），每条面向用户的回复末尾给“进行中 / 等你 / 已完成待确认”。这需要一个出站钩子；**我尚未核实现有钩子槽是否支持出站追加，落地前必须核对**（见 §5 未决项）。

## 3. 与已有设计的关系

- context-keeper：不重复。账本只要求“压缩后目标仍在”，由 `turn` 贡献保证。
- task_continue / D46 任务恢复：不改语义；账本引用它判断“是否有后续责任”。
- cron 插件：滞留催办的定时由账本自己的 timer 或 cron 原语承担，不造新调度器。
- card-plugin（当前工作区未提交改动）已修改 `sdk/types.ts`（`agents.list`）与 `kernel/`，本方案的 SDK 追加会与之冲突，**必须在它合并后基于 main 开新 worktree 做**。

## 4. 执行计划与分工

分工依据：Sonnet 只规划与审判；机械实现交 Codex；提示词由我写（Codex 会误读/过度防御）；Haiku 只做完全机械的活。

| 阶段 | 内容 | 执行者 | 完成标准 |
|---|---|---|---|
| P0 | 批准本提案；写 `docs/spec/17-task-ledger.md`、decisions 一条、更新 index | 我写，维护者批 | 文档合入 |
| P1 | 账本存储 + 状态机 + 五个工具 + 可见范围 + 单测（真实存储，不模拟模型） | Codex | 构建/类型/lint/测试通过，原始结果入 status.md |
| P2 | `turn` 贡献、continuation/审计提示语、滞留催办、`task_nudge` | 提示语我写；代码 Codex | 真实模型 `openai/gpt-6-luna` 跑 goal-mechanism §7 场景 2、3 |
| P3 | `TaskBoard` + interaction 渲染渠道改造 + 图片渲染 + 回复尾部清单 | 代码 Codex；样式模板/文档同步/测试脚手架 Haiku | 桌面、网页、飞书图片三处实拍 |
| P4 | 发版（沿用既有 Release → 升级 → 核验链） | Codex 执行，我审 | 正式版本在生产 home 就绪 |
| P5 | 真实验收：经 MCP 通知 Jarvis、Hermes 复盘并把全部在办事项录入账本，我监督到全部完成或明确 blocked | 我 | 两个 Agent 的账本与对话审计一致 |

每个阶段一个提交；每步只记真实结果与未测项。P5 会向生产 Agent 发消息，发送前我给你看消息正文。

## 5. 需要维护者决定

1. 账本做成官方插件（我推荐；需要 SDK 追加：只读会话用量或自数唤醒二选一、向指定 Agent 会话投递带来源标记输入、出站追加钩子），还是进内核。
2. 是否接受“滞留催办”作为软机制（有来源标记的输入，去重限频，不阻断）。我认为不违反不变量 6、7，但它最接近线，请明确裁定。
3. 管家 = 持有 `cross-agent` 的配置档，不新增角色类型。
4. 是否先等 card-plugin 合并再开工（我推荐，避免 `types.ts` 冲突）。

## 6. 不确定与限制

- 出站钩子是否存在、`RenderContext` 能否拿到会话用量，我没有核实。
- Codex 当前 `/goal` 的 budget_limit.md 原文未读到，用 continuation.md 与二手说明。
- “任务一定不会中断”无法保证：模型可以无视提醒。能保证的是：任务一定被记录、滞留一定被发现、你和管家一定看得到。
- 本方案没有运行任何代码或模型。
