# 17 任务账本（tasks 插件）

官方插件 `@yonder/plugin-tasks`，插件 id `tasks`。只使用 04 的工具、上下文、钩子、触发与事件槽，不运行模型循环，不改内核。设计依据与证据见 `proposals/task-ledger/design.md`、`proposals/goal-mechanism/design.md`。

目标：每个 Agent 的每条任务线都先被记录，状态不靠模型上下文记忆；用户和管家随时能看到全部在办事项；滞留被发现并被推动；“完成”仍由模型自己判定（不变量 6）。

## 1 任务对象

追加式事件存储（插件 data 下 SQLite，只追加，不改旧行）。任务字段：`id`、`ownerAgent`、`session`、`parent`（上级任务 id，sub-agent 的任务挂在发起方任务下）、`title`、`objective`、`acceptance[]`（2–5 条，每条能指向具体证据）、`nonGoals`、`budget{wallMinutes?, wakeups?}`、`state`、`deliverable`、`origin`（来源渠道/会话引用）、`lastActivityAt`。

状态：`open → active → waiting-user | blocked | review → done | cancelled`。进入 `done` 必须带 `deliverable` 与逐条验收证据；这是模型自己写、自己对照的记录，插件不判定“验收通过”。

## 2 工具

`tasks_open`、`tasks_update`、`tasks_done`、`tasks_list`、`tasks_get`、`tasks_show`、`tasks_nudge`。目标机制照搬 Codex `/goal`：持久目标、每次唤醒重现、软预算、完成前对照证据；不照搬 `update_plan` 清单（业界已将其默认关闭）。工具描述文本是唯一的使用指引，不另设上下文文件。

## 3 可见范围

沿用能力模型，不建新权限体系：
- 默认只读写自己的任务；
- 主 Agent 另可读自己 sub-agent（`parent` 链）的任务；
- 持有 `cross-agent` 能力的配置档（管家）可读全部 Agent 进行中的任务，并可调用 `tasks_nudge`。管家不是新角色类型。

`tasks_nudge` 以带来源标记的输入投递到目标 Agent 自己的会话，经其自己的绑定，不绕过任何路由。

## 4 每次唤醒的重现

`placement: turn` 的上下文贡献。任务新建或变更时给完整目标；其余唤醒只给一行：标题、状态、已用时间、唤醒次数、距上次交付的间隔。目标存放在账本里，不依赖转录，压缩后仍在。唤醒次数由插件自数（`RenderContext` 无会话用量，本版不改 SDK）。

## 5 时点机制（moments）

账本在任务生命周期的明确时点上，向 Agent 会话投递一条带来源标记的输入。投递复用现有事件通道，去重、限频，不阻断、不截断。

| 时点 | 做什么 | 默认 |
|---|---|---|
| 滞留 | active 任务超过 N 分钟无进展，且没有后台等待或已接纳的 `task_continue`：提示当前状态，请在继续 / blocked / waiting-user 中选一 | 开 |
| 用户待办 | waiting-user 超过 M 分钟：程序（不唤醒模型）提醒用户 | 开 |
| 完成后复盘 | done 后 15 分钟：让 Agent 在隐藏分支里整理记忆、技能与复盘（复用 hermes-experience 的静默复盘通道与 preset，不另造） | 关，实验开关 |
| 完成后留存 | done 后 30 分钟内，用户再提到该任务时仍可检索其交付 | 关，实验开关 |
| 完成后压缩 | done 后 15 分钟触发一次上下文压缩 | 〔本版不实现〕：SDK 无压缩接口，等 context-keeper 的 `sessions.compact` |

关闭的时点属于“待验证”：先实现，按 §9 在真实模型上对照，数据支持再默认打开。时点表可扩展，新增时点只加一行。

## 6 展示

账本只产出一份 `TaskBoard` JSON（分组：进行中 / 等你 / 阻塞 / 待验收 / 刚完成）。`tasks_show({target, view, id?})` 由 Agent 选择在哪里呈现：
- `desktop` / `web`：ui-companion 只做渲染渠道，接收 TaskBoard 渲染卡片列表，不含任务逻辑；
- `channel:<ref>`：服务端渲染成图片（SVG 模板 + resvg），经现有媒体出站发送；resvg 不可用时退化为文字清单；飞书优先沿用已有的 managed task status card（`channel-feishu/src/task-card.ts`）；
- 回复尾部清单：用 `beforeSend` 钩子给面向人的回复末尾程序化追加“进行中 / 等你 / 待确认”，只在存在未完成任务时追加，最多 N 行，不经模型。

## 7 配置

插件配置只含：`stallMinutes`、`userWaitMinutes`、`tailDigest`（开/关与行数）、`moments`（实验时点开关）。默认值写入代码，不写示例人设。

## 8 边界

不做硬拦截：不阻止任何工具，不因任务状态拒绝回复，不追加“你确定完成了吗”的轮次。账本保证任务被记录、滞留被发现、用户和管家看得到，不保证模型一定照做。

## 9 验收

构建、类型检查、lint、默认测试通过；真实模型 `openai/gpt-6-luna` 跑 goal-mechanism §7 的场景 2、3 和新增“多任务线并行 + 中途打断”场景（每条件 n ≥ 10，缺凭据标未测）。随后发版，经 MCP 通知生产的 Jarvis 与 Hermes 复盘并录入全部在办事项，核对账本与对话审计一致。完成后复盘 / 留存两个实验时点单独对照，结论写入 status.md。
