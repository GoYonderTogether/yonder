# tasks — P1 + P2 + P3a renderers

可选任务账本插件 `@yonder/plugin-tasks`，id `tasks`。运行接口只依赖 `@yonder/sdk`，图片转换使用 `@resvg/resvg-js`；在插件 `<paths.data>/tasks.sqlite` 追加事件，回放得到当前任务、历史及唤醒计数。插件记录模型给出的交付和证据，不判断验收是否通过。

在 `yonder.yaml` 的 `plugins` 加入 `{ use: "@yonder/plugin-tasks" }`，再在目标 profile 选择：

```yaml
plugins: [tasks]
contexts: [tasks-turn]
capabilities: [read, write]
tools:
  offer: [tasks_*]
  search: []
```

合并进已有配置，不替换其他选择。工具写操作要求 `write`，读操作要求 `read`。管家 profile 额外选择 `cross-agent`，可读取并催办其他 Agent 的进行中任务；普通 Agent 可读自己的任务及其 parent 链下的子任务，不能修改子 Agent 的任务。预设会话的任务归该 session。

- `tasks_open`：title、objective、acceptance（2–5 条）、nonGoals；可选 budget、parent、origin。归属取真实 ToolContext。
- `tasks_update`：id 及要修改的内容、state、deliverable 或 note；保留完整历史。
- `tasks_done`：id、deliverable、evidence；evidence 按 acceptance 的顺序逐项对应，条数必须相等且每项非空。
- `tasks_list`：列出调用方可见的任务，保持数组返回；每项增加 `recentlyDone` 布尔值（postRetain 开启且 done 未满 30 分钟时为 true）。
- `tasks_get`：id，返回任务及完整事件历史。
- `tasks_nudge`：id、say，要求 `cross-agent`；通过 `sessions.submit(..., {busy: "followup"})` 提醒目标任务的 owner session，拒绝不存在或已关闭的任务。NUDGE_INPUT 的 from 使用真实调用方 Agent 名（无 Agent 时用 session 引用）；持久输入事件的真实程序来源仍为 `plugin:tasks`，不携带人类授权。

`tasks-turn` 首次或内容改变后提供完整任务，其余输入只提供维护者的一行文本；每个 session 分别跟踪渲染版本，同一入站事件重复渲染不重复计数，重启后保留。budget 只记录，无硬限制。模型文本位于 `src/prompts.ts`，Biome 只对此文件停用格式化。

## Moments（P2）

`tasks-moments` Trigger 启动时检查一次，之后每次检查结束约 60 秒再检查。到期从 SQLite 账本时间推导；触发前追加 `moment` 行，随后追加 `moment-result`（回执/结果或错误），重启不重复触发已记录窗口。无需模型做定时判断。

- **stall** 默认开启：active 任务连续 30 分钟无账本活动时，向它的 owner session 提交 STALL_NOTICE，busy 为 followup。下一次至少间隔另一个 stallMinutes。open / waiting-user / blocked / review / done / cancelled 不触发 stall。
- **user-wait** 默认开启：waiting-user 持续 120 分钟后，程序直接用 `api.messages.send` 把 USER_WAIT_NOTICE 发到任务 origin，不唤醒模型；locale 以 zh 开头时中文。每个 userWaitMinutes 窗口一次，无 origin 静默跳过。
- **postCompact** 默认关闭：done 满 15 分钟后调用一次 `sessions.command(session, "compact")`，记录真实返回或错误。现有会话能力检查照常生效；提交压缩的回执不代表压缩完成。
- **postRetain** 默认关闭：开启后，done 未满 30 分钟的可见任务在 tasks_list 中带 `recentlyDone: true`。从持久 done 时间推导，不新增清理作业，也不删除历史。

插件配置仅接受以下键（正数分钟，开关为布尔值）；省略即取默认值：

```yaml
plugins:
  - use: "@yonder/plugin-tasks"
    config:
      stallMinutes: 30
      userWaitMinutes: 120
      moments:
        postCompact: false
        postRetain: false
```

SessionInfo 没有后台工作或已接纳 continuation 字段，**本期跳过“没有后台等待/已接纳 task_continue”的判定**，不会用运行状态猜测。完成后复盘仍未实现。

## 展示（P3-1）

- `tasks_show({target?, view?, id?})`：target 默认 `channel`，从本次输入或该 session 的事件账本取会话，程序发送 PNG；`json` 返回同一 TaskBoard。图片渲染失败时发送文字。view 默认 `board`，`detail` 必须给 id，包含目标、逐项证据、交付、完整事件时间线、子任务与来源。
- TaskBoard 是纯函数，输入已经按现有 own / parent / cross-agent 规则过滤的任务。四组固定为等你（waiting-user、review）、进行中（open、active）、阻塞、刚完成。done 满 30 分钟从总览及其子项省略，仍可显式查询 detail；不依赖实验 postRetain 开关。counts 统计所有可见任务，子任务也按自己的状态计数。
- 短编号 `T1`、`T2`…按本账本创建顺序持久保存；旧账本按不可变 open 行顺序恢复编号，无须改写旧行。所有接受任务 id 的工具及 parent 同时接受短编号和 UUID。
- `renderText(board, locale)` / `renderSvg(board, locale)` 为纯投影；locale 以 zh 开头时中文。验收 met 是已有 evidence 的非空项数，不判断证据质量。详情可读取 30 分钟以前的交付。
- 精确依赖 resvg 2.6.2，把 SVG 转成 PNG，文件保存在插件 data 目录，经现有 `Attachment {kind: image, mime: image/png, uri: file:...}` 发出。**resvg 安装、加载或渲染不可用时退化为文字**，不自制栅格器。PNG 文件保留供既有附件路径使用；无新增清理定时器。
- `tasks-digest` 在选择 tasks 的 profile 上默认开启；仅对有真实人类 message.in 记录的目标、sender 自己的任务追加。等你优先，其次阻塞、交付，最多五行；仅进行中且无新交付时不追加。相同状态版本/交付对同一目的地只展示一次，重启保留去重。附件无文本、Agent 等非人类目标、插件自身程序消息均不追加。
- 从 `events.query` 读取目标会话的人类输入时间，超过两小时间隔的首次回复使用“离开期间”措辞；不依赖模型记忆。配置只增加 `tailDigest: {enabled?: boolean, lines?: number}`，默认 true / 5，lines 为 1–5。

## Views

`tasks.board` 是按 session 限定的只读列表视图；任务打开、更新或完成时通知客户端刷新。`tasks-board` Trigger 在关闭时释放 SQLite 句柄。

## Questions for the maintainer

- §1 的箭头未列恢复路径：本实现 open → active，active → waiting-user / blocked / review；后三种可互转或回 active，并可 done；所有未关闭状态可 cancelled。done / cancelled 为终态，不重新打开；“reopen”指重开存储。
- §3 未指定预设会话的归属：ownerAgent 为 null 时按创建 session 隔离。同一常驻 Agent 的 profiles 共用归属，读写仍受各自能力限制。
- parent 由调用方提供已存在的任务 id；SDK 不提供“本次委派对应哪个账本任务”，因此不自动推断或验证调用链。
- §4 未指定跨 Agent 上下文或已关闭任务：turn 仅注入自己的未关闭任务；跨 Agent 与子任务通过工具读取。新 session 首次给完整内容；尚无交付时，“距上次交付”从创建时间算起。
- RenderContext 没有 run/write 标记或用量：按选中上下文的输入渲染计数，以 session + event id 去重；没有 event 时每次 render 算一次。仅旁观输入与真正模型唤醒无法由此接口区分。

- §5 的活动窗口未明确哪些行算活动：stall 使用最近的 open/update/done/wake 行时间，moment 及其结果不算进展；waiting-user 从最近一次写入 waiting-user 状态算等待时长，提醒里的 waitingFor 使用最近 note，缺省回退 objective。
- 触发行先于外部调用落盘，优先避免重启重复催办。若两者之间崩溃，可能只有触发行而没有送达；不猜测副作用、不自动补发。stall/user-wait 仍可在下一窗口再触发；postCompact 每任务仅尝试一次。
- P1 缺少渠道来源时仍保留 session:<id> origin；user-wait 不猜渠道，交现有 messages.send 处理，失败结果写账本。真正缺失/空 origin 不触发。
- §5 未规定 tasks_list 的刚完成输出结构：保留已有数组，在每项增加 recentlyDone 标记；保持原可见范围，不扩大跨 Agent 对已关闭任务的读取权限。

- 每账本使用稳定编号，`tasks_show` 支持 `channel` 和 `json`；桌面与网页通过 views 展示。
- SDK 无通用“收件人是人类”标记：以目的地实际 message.in 的 acct/person 来源为依据，Agent/plugin/system 来源不算人；owner 别名未解析为具体 Ref 时不猜目的地。渠道仍负责自身机器人消息过滤。
- 摘要的“无变化不出现”解释为每目的地按任务状态内容版本去重；waiting/review/blocked 改变后可再提示。发送前记录摘要，跟 P2 时点相同：发送失败/崩溃可能漏一次提醒，不猜测重发副作用。
- 旧任务只有 done 时保存逐项 evidence，所以现有工具写出的 met 通常为 0 或 total；P3-1 不另加写入协议。elapsed 在终态停止，idle 从 lastActivityAt 算；open 归入进行中，cancelled 不在总览展示。
- 详情保留完整 JSON 时间线；图片按固定字符数折行。未新增主题、模板、图片缓存或模型/后台日志字段；后者不在本次明确字段范围。

## Verification（历史记录，不能代表当前版本的验收）

P3-1：`npm run build`、`npm run typecheck`、`npm run lint` 最终 exit 0（lint 0 errors / 445 warnings / 14 infos）；`npm test -- plugins/tasks/test` 为 13 passed / 0 failed / 1 skipped；`npm test` 为 606 passed / 0 failed / 39 skipped。`YONDER_TEST_REAL=1 YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json agent-network run -- npm test -- plugins/tasks/test/moments.test.ts` 为 4 passed / 0 failed / 0 skipped，真实 Luna stall 已测。PNG 本地协议发送和文件头已验证。

原始失败：A 的手工工具上下文测试三次各 1 failed，改为既有内核投递协议测试后 11 passed；B 首次构建失败于可选 conv 类型，局部 Biome 两次各 2 errors，均修正。完整命令与每轮计数见 [docs/status.md](../../docs/status.md) 的“任务账本 P3-1”条目。真实用户渠道、resvg 缺失降级执行、n≥10 模型对照、干净 npm ci、安装/生产均未测。以下 P2 结果保留为历史记录。

P2 使用真实 SQLite、插件 loader、kernel 与本地测试渠道；协议测试在真实 beforeRequest 钩子暂停并取消请求，未替换模型。确定性时点直接调用 `tick(..., now)`，不 sleep。

最终检查：build/typecheck/lint 均 exit 0（lint 0 errors / 405 warnings / 14 infos）；`npm test -- plugins/tasks/test packages/core/src/kernel/plugin-input.test.ts` 为 10 passed / 0 failed / 1 skipped；`npm test` 为 601 passed / 0 failed / 39 skipped。实际命令、原始失败/修正及完整计数见 [docs/status.md](../../docs/status.md) 的“任务账本 P2”条目。新增一个 opt-in `openai/gpt-6-luna` stall 用例：`YONDER_TEST_REAL=1 npm test -- plugins/tasks/test/moments.test.ts`；缺少 worktree 测试凭据时跳过并记为未测。未接触生产 home、安装或服务，未推送、发布。

### 历史验证（P3a renderers）

`npm run build`、`npm run typecheck`、`npm run lint` 最终 exit 0；lint 0 errors / 461 warnings / 14 infos。`YONDER_BOARD_SCREENSHOT=/tmp/yonder-task-board-detail.png npm test -- plugins/tasks/test plugins/interaction/test plugins/channel-feishu/test` 为 93 passed / 0 failed / 1 skipped（11 文件）；`npm test` 为 608 passed / 0 failed / 39 skipped（103 文件通过 / 19 跳过）。`node plugins/interaction/test/state.mjs` exit 0。真实 loader/kernel、本地协议服务、实际 Chrome 页面已验证；截图为 `/tmp/yonder-task-board-detail-overview.png` 和 `/tmp/yonder-task-board-detail.png`。

原始失败保留：build 首次 4 个类型错误；聚焦前两轮各 91 passed / 2 failed / 1 skipped（首轮另有 1 unhandled rejection）；两插件 contract 5/2/0 后 6/1/0；UI 单文件 3/1/0 后 4/0/0。均修正测试夹具/计时器类型/Chrome 启动标签页导航竞争，未放宽断言或超时。完整命令、原因和每轮计数见 [docs/status.md](../../docs/status.md) 的 P3a renderers 条目。

未测：真实飞书平台与客户端、已安装 macOS 浮球及焦点、多屏/全屏、生产环境、resvg 缺失的文字降级、干净 npm ci。没有调用模型，本轮没有相关模型行为变更；未读取生产 auth。未推送、发布、安装或操作已安装服务。
