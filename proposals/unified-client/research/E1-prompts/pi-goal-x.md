> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-goal-x — 注入模型的提示词原文

- 包: `pi-goal-x` 0.34.0
- License: MIT (Copyright (c) 2026 Lucas) — `~/.pi/agent/npm/node_modules/pi-goal-x/LICENSE`
- 仓库: https://github.com/tmonk/pi-goal-x
- 来源: `~/.pi/agent/npm/node_modules/pi-goal-x/extensions/goal-core-tools.ts`、`goal-task-tools.ts`、`goal-drafting.ts`、`goal-oracle.ts` 的 `pi.registerTool(defineTool({...}))`
- 注入方式: 工具 description/promptSnippet/promptGuidelines 进系统提示词；**目标状态本身不写系统提示词**——`registerGoalContext` 注册 `pi.on("context_with_system")`，在消息列表尾部按需追加 state/counters 段落（`liveRetention` 逐字保留旧尾部以维持前缀缓存），并由 `before_provider_request` 做 `cacheGoalHistory`。命令树由 `GOAL_COMMANDS` 配置生成，根命令为 `/goal` 与 `/goal-settings`

## goal-core-tools.ts

```ts
pi.registerTool(defineTool({
	name: "get_goal",
	label: "Get Goal",
	description: "Read focused goal state. Default: compact summary. Retrieve full objective/contracts, tasks, or history in 4000-character pages with section and cursor. verbose preserves full legacy output.",
	promptSnippet: "Inspect goal state or retrieve omitted requirements.",
	promptGuidelines: [],
```

## goal-core-tools.ts

```ts
pi.registerTool(defineTool({
	name: "create_goal",
	label: "Create Goal",
	description: "Create and focus a persistent goal only on explicit user request; other open goals remain unchanged.",
	promptSnippet: "Create a goal only when explicitly requested.",
	promptGuidelines: ["Never infer persistent goals, Sisyphus mode, or token budgets from an ordinary task. The objective must faithfully preserve all user requirements and ordered steps."],
```

## goal-core-tools.ts

```ts
pi.registerTool(defineTool({
	name: "update_goal",
	label: "Update Goal",
	description: "Update lifecycle status or optionally save continuation. New waits require strictExecutionContract opt-in. Wait: future ISO deadline; reuse wait_id/deadline without polling on recheck. Completion is audited.",
	promptSnippet: "Complete, block, pause, or optionally save a scheduling decision.",
	promptGuidelines: [],
```

## goal-task-tools.ts

```ts
pi.registerTool(defineTool({
	name: SET_GOAL_TASKS_TOOL_NAME,
	label: "Set Goal Tasks",
	description: "Set or restructure the task tree with user confirmation. Matching IDs retain progress; removed IDs are deleted. Confirmation stops the turn; continuation follows.",
	promptSnippet: "Set the goal task tree with confirmation.",
	promptGuidelines: ["Use tasks only for useful milestones. Restructure an existing tree only when the user asks or requirements structurally change. Input is a flat parent-linked tree, at most 50 tasks, within configured depth. lightweight_subtasks is valid only on parents."],
```

## goal-task-tools.ts

```ts
pi.registerTool(defineTool({
	name: UPDATE_GOAL_TASK_TOOL_NAME,
	label: "Update Goal Task",
	description: "Update task progress without stopping the turn. Use ordered updates for an atomic batch, or task_id/status for one task. An invalid update rejects the whole batch.",
	promptSnippet: "Start, complete, skip, or reopen tasks; batch related progress.",
	promptGuidelines: ["start requires pending and sets current task. complete requires evidence for contracted tasks and completed/skipped non-lightweight children. skipped requires a reason and explicit user direction or a hard contradiction; never skip to avoid work. pending reopens skipped tasks only; completed tasks are immutable. Completing/skipping the current task clears focus."],
```

## goal-drafting.ts

```ts
pi.registerTool(defineTool({
		name: QUESTION_TOOL_NAME,
		label: "Ask Drafting Question",
		description: "Ask one structured question during a user-started goal draft.",
		promptSnippet: "Ask the user one focused drafting question.",
```

## goal-drafting.ts

```ts
pi.registerTool(defineTool({
		name: QUESTIONNAIRE_TOOL_NAME,
		label: "Run Drafting Questionnaire",
		description: "Ask a short structured questionnaire during a user-started goal draft.",
		promptSnippet: "Ask only the questions needed to make the goal and task plan concrete.",
```

## goal-drafting.ts

```ts
pi.registerTool(defineTool({
		name: PROPOSE_DRAFT_TOOL_NAME,
		label: "Propose Goal Draft",
		description: "Present the drafted objective and agent-selected task plan for explicit user confirmation.",
		promptSnippet: "Confirm the proposed goal and any useful task tree in one dialog.",
		promptGuidelines: [
			commandInstructions("Use only during a /goal, /sisyphus, or /goal-tweak guided draft.", core.loadedCommands),
			"Clarify ambiguity before proposing. Include tasks when the work naturally decomposes into trackable milestones; omit them for genuinely simple work.",
			"Set token_budget only when the user explicitly asked for a token budget or a spend limit. Never invent, estimate, or infer one from the objective's size; omitting it creates a goal with no budget.",
			"Confirmation creates or revises the goal atomically. Continue Chatting leaves drafting active for refinement.",
		],
```