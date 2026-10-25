# tasks — P1

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

合并进已有配置，不替换其他选择。工具写操作要求 `write`，读操作要求 `read`。管家 profile 额外选择 `cross-agent`，可只读其他 Agent 的进行中任务；普通 Agent 可读自己的任务及其 parent 链下的子任务，不能修改子 Agent 的任务。预设会话的任务归该 session。

- `tasks_open`：title、objective、acceptance（2–5 条）、nonGoals；可选 budget、parent、origin。归属取真实 ToolContext。
- `tasks_update`：id 及要修改的内容、state、deliverable 或 note；保留完整历史。
- `tasks_done`：id、deliverable、evidence；evidence 按 acceptance 的顺序逐项对应，条数必须相等且每项非空。
- `tasks_list`：列出调用方可见的任务。
- `tasks_get`：id，返回任务及完整事件历史。

`tasks-turn` 首次或内容改变后提供完整任务，其余输入只提供维护者的一行文本；每个 session 分别跟踪渲染版本，同一入站事件重复渲染不重复计数，重启后保留。budget 只记录，无硬限制。模型文本 `src/prompts.ts` 保持维护者原文，Biome 只对此文件停用格式化。

P1 不含 nudge、滞留/提醒定时器、tasks_show、投影、尾部清单或复盘时点。

## Questions for the maintainer

- §1 的箭头未列恢复路径：本实现 open → active，active → waiting-user / blocked / review；后三种可互转或回 active，并可 done；所有未关闭状态可 cancelled。done / cancelled 为终态，不重新打开；“reopen”指重开存储。
- §3 未指定预设会话的归属：ownerAgent 为 null 时按创建 session 隔离。同一常驻 Agent 的 profiles 共用归属，读写仍受各自能力限制。
- parent 由调用方提供已存在的任务 id；SDK 不提供“本次委派对应哪个账本任务”，因此不自动推断或验证调用链。
- §4 未指定跨 Agent 上下文或已关闭任务：turn 仅注入自己的未关闭任务；跨 Agent 与子任务通过工具读取。新 session 首次给完整内容；尚无交付时，“距上次交付”从创建时间算起。
- RenderContext 没有 run/write 标记或用量：按选中上下文的输入渲染计数，以 session + event id 去重；没有 event 时每次 render 算一次。仅旁观输入与真正模型唤醒无法由此接口区分。

## Verification

实际运行：

```sh
npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund
npm run build
npm run typecheck
npm run lint
npm test -- plugins/tasks/test/tasks.test.ts
npm test
```

原始结果及格式修正记录见 [docs/status.md](../../docs/status.md) 的“任务账本 P1”条目；本阶段没有模型调用或生产验收。
