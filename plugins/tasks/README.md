# tasks — P1 + P2

可选任务账本插件 `@yonder/plugin-tasks`，id `tasks`。只依赖 `@yonder/sdk`；在插件 `<paths.data>/tasks.sqlite` 追加事件，回放得到当前任务、历史及唤醒计数。插件记录模型给出的交付和证据，不判断验收是否通过。

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

`tasks-turn` 首次或内容改变后提供完整任务，其余输入只提供维护者的一行文本；每个 session 分别跟踪渲染版本，同一入站事件重复渲染不重复计数，重启后保留。budget 只记录，无硬限制。模型文本 `src/prompts.ts` 保持维护者原文，Biome 只对此文件停用格式化。

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

SessionInfo 没有后台工作或已接纳 continuation 字段，**本期跳过“没有后台等待/已接纳 task_continue”的判定**，不会用运行状态猜测。P2 不含 tasks_show、TaskBoard、渠道投影、尾部摘要或完成后复盘。

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

## Verification

P2 使用真实 SQLite、插件 loader、kernel 与本地测试渠道；协议测试在真实 beforeRequest 钩子暂停并取消请求，未替换模型。确定性时点直接调用 `tick(..., now)`，不 sleep。

最终检查：build/typecheck/lint 均 exit 0（lint 0 errors / 405 warnings / 14 infos）；`npm test -- plugins/tasks/test packages/core/src/kernel/plugin-input.test.ts` 为 10 passed / 0 failed / 1 skipped；`npm test` 为 601 passed / 0 failed / 39 skipped。实际命令、原始失败/修正及完整计数见 [docs/status.md](../../docs/status.md) 的“任务账本 P2”条目。新增一个 opt-in `openai/gpt-6-luna` stall 用例：`YONDER_TEST_REAL=1 npm test -- plugins/tasks/test/moments.test.ts`；缺少 worktree 测试凭据时跳过并记为未测。未接触生产 home、安装或服务，未推送、发布。
