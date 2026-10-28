> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# @juicesharp/rpiv-todo — 注入模型的提示词原文

- 包: `@juicesharp/rpiv-todo` 2.15.0
- License: MIT (Copyright (c) 2026 juicesharp) — `/Users/zoran/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/LICENSE`
- 仓库: https://github.com/juicesharp/rpiv-mono (packages/rpiv-todo)
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/todo.ts` — `DEFAULT_PROMPT_SNIPPET`、`DEFAULT_PROMPT_GUIDELINES`、`pi.registerTool` 的 `description`；`config.ts` 的 `guidance.promptSnippet/promptGuidelines` 可在用户配置里覆盖

## 默认 promptSnippet / promptGuidelines（DEFAULT_*）

```text
export const DEFAULT_PROMPT_SNIPPET = "Manage a task list to track multi-step progress";
export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
	"When starting a task from the todo list, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task in_progress at a time.",
	"Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
	"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
	'To change a task\'s status, call update with the task id and the target status, e.g. {"action":"update","id":3,"status":"completed"} or {"action":"update","id":3,"status":"in_progress","activeForm":"writing tests"}. status is the field that changes the task; an update without a mutable field (status or another) is rejected.',
	"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
	"To create several independent tasks at once, pass create with tasks: [{subject}, ...]. Do not also pass subject. tasks[] cannot blockedBy each other (ids do not exist until the call commits); create the prerequisite first, then the dependent with blockedBy. Dependency chains stay single-create.",
	"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
	"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];
```

## todo 工具 description + 生效的 snippet/guidelines

```text
export function registerTodoTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadConfig().guidance);
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description:
			"Manage a task list for tracking multi-step progress. Actions: create (new task, or several independent tasks at once via tasks[]), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
```

## 用户配置覆盖层

```text
promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
```
