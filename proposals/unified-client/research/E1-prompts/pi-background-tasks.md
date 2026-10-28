> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-background-tasks — 注入模型的提示词原文

- 包: `pi-background-tasks` 2.6.10
- License: ISC — `/Users/zoran/.pi/agent/npm/node_modules/pi-background-tasks/LICENSE`
- 仓库: https://github.com/ismailsaleekh/pi-background-tasks
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/pi-background-tasks/dist/src/extension.js`（`pi.registerTool` 的 description/promptSnippet/promptGuidelines）；`BACKGROUND-TASKS-INSTRUCTIONS.md` 是包内维护者 AGENTS 网关，**不进模型上下文**
- 注入方式: 每个 bg_* 工具的 description + promptSnippet + promptGuidelines 进系统提示词 rules 段；`createShellPolicyGuidanceHandler` 另在 `before_agent_start` 注入 shell 策略段落

## 工具定义

```js
name: 'bg_run',
        label: 'Background Run',
        description: `Start a named long-running shell command in the background and return immediately with a task ID and output path. By default, completed, failed, or killed terminal state is delivered automatically as <background-task-notification> and starts a follow-up agent turn; do not sleep or poll merely to wait. Output is written to .pi/tasks and model-visible logs are bounded to ${formatSize(MAX_LOG_BYTES)}.`,
        promptSnippet: 'Start a named long-running shell command; default terminal notification wakes a follow-up turn, so yield instead of polling',
        promptGuidelines: [
            'Use bg_run instead of bash for commands expected to run for a long time, such as test suites, dev servers, watchers, or builds.',
            'Always set isAgent: true only when the background task launches an LLM/agent process; set isAgent: false for scripts, tests, dev servers, sleeps, and ordinary shell commands.',
            'When using bg_run, always set name to a concise 2-6 word human-readable label for the footer task dock; do not use the raw command as the name unless it is already short and meaningful.',
            'bg_run returns immediately. With notifyOnCompletion:true and triggerOnCompletion:true (both defaults), completed, failed, or killed terminal state is delivered as <background-task-notification> and automatically starts a follow-up agent turn.',
            'After a default bg_run launch, continue only independent useful work that does not merely wait for the task; otherwise briefly acknowledge it if useful, then end the current turn. Do not call sleep, bg_status, or bg_logs merely to wait; the terminal notification will wake you.',
            'Treat <background-task-notification> as durable terminal truth. Do not call bg_status to reconfirm it; call bg_logs only when the task output is needed.',
            'Use bg_status/bg_logs only when the user explicitly requests an update, automatic notification or wake-up was deliberately disabled, there is concrete evidence the task is hung, or a terminal notification arrived and output details are needed.',
            'Do not set notifyOnCompletion:false or triggerOnCompletion:false unless intentionally opting out of automatic completion handling.',
        ],
```

```js
name: 'bg_status',
        label: 'Background Status',
        description: 'Inspect one background task or list all running/recent background tasks. This is a point-in-time inspection tool, not a waiting primitive.',
        promptSnippet: 'Inspect point-in-time status for one or all background tasks; never poll it as a wait loop',
        promptGuidelines: [
            'Use bg_status for deliberate point-in-time inspection, not as a waiting primitive.',
            'A running result is not an instruction to poll again. Do not repeatedly call bg_status while an automatic terminal notification is pending.',
            'Use bg_status when the user explicitly requests an update, automatic completion handling was disabled, or concrete evidence suggests a task is hung; terminal notifications do not need reconfirmation.',
        ],
```

```js
name: 'bg_logs',
        label: 'Background Logs',
        description: `Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated.`,
        promptSnippet: 'Read bounded task output when needed; never tail it repeatedly as a wait loop',
        promptGuidelines: [
            'Use bg_logs with a modest maxBytes value only when task output is needed, without flooding context.',
            'Do not repeatedly call bg_logs to wait for completion while an automatic terminal notification is pending.',
            'Use bg_status first only when a deliberate inspection requires the current task state; do not reconfirm a terminal notification.',
        ],
```

```js
name: 'bg_kill',
        label: 'Background Kill',
        description: 'Stop a running background task by ID. Fails loudly if the task is unknown or already finished.',
        promptSnippet: 'Stop a running background task by ID',
        promptGuidelines: [
            'Use bg_kill when the user asks to stop a background task or when a bg_run command is no longer needed.',
        ],
```