import { expect, test } from "vitest";
import { applyTodo, emptyTodos, type TodoArgs, type TodoList, todoEvent } from "./todo.js";

const run = (list: TodoList, ...calls: TodoArgs[]) =>
	calls.reduce((current, args) => applyTodo(current, args).list ?? current, list);

test("create, update, get, list, delete and clear follow the rpiv-todo state machine", () => {
	let list = run(
		emptyTodos(),
		{ action: "create", subject: "Research tool" },
		{ action: "create", subject: "Write tests", blockedBy: [1] },
	);
	expect(list.tasks.map((task) => [task.id, task.status, task.blockedBy])).toEqual([
		[1, "pending", []],
		[2, "pending", [1]],
	]);
	list = run(list, { action: "update", id: 1, status: "in_progress", activeForm: "researching tool" });
	expect(applyTodo(list, { action: "get", id: 1 }).text).toContain("activeForm: researching tool");
	expect(todoEvent("s1", list)).toEqual({
		session: "s1",
		done: 0,
		total: 2,
		items: [
			{ id: "1", text: "researching tool", state: "doing", order: 0 },
			{ id: "2", text: "Write tests", state: "todo", order: 1 },
		],
	});
	list = run(list, { action: "update", id: 1, status: "completed" }, { action: "delete", id: 2 });
	expect(applyTodo(list, { action: "list" }).text).toBe("#1 [completed] Research tool");
	expect(applyTodo(list, { action: "list", includeDeleted: true }).text).toContain("#2 [deleted] Write tests");
	expect(applyTodo(list, { action: "list", status: "deleted" }).text).toContain("#2");
	expect(todoEvent("s1", list)).toMatchObject({ done: 1, total: 1 });
	expect(applyTodo(list, { action: "list" }).list).toBeUndefined();
	const cleared = run(list, { action: "clear" });
	expect(cleared).toEqual(emptyTodos());
	expect(run(cleared, { action: "create", subject: "Again" }).tasks[0]!.id).toBe(1);
});

test("invalid calls are rejected and leave the list unchanged", () => {
	const list = run(
		emptyTodos(),
		{ action: "create", subject: "A" },
		{ action: "create", subject: "B", blockedBy: [1] },
	);
	const snapshot = structuredClone(list);
	expect(() => applyTodo(list, { action: "update", id: 1, addBlockedBy: [2] })).toThrow(/cycle/u);
	expect(() => applyTodo(list, { action: "update", id: 1, addBlockedBy: [1] })).toThrow(/itself/u);
	expect(() => applyTodo(list, { action: "create", subject: "C", blockedBy: [9] })).toThrow(/#9 does not exist/u);
	expect(() => applyTodo(list, { action: "update", id: 1 })).toThrow(/field to change/u);
	expect(() => applyTodo(list, { action: "get" })).toThrow(/requires id/u);
	const deleted = run(list, { action: "delete", id: 1 });
	expect(() => applyTodo(deleted, { action: "update", id: 1, status: "pending" })).toThrow(/deleted/u);
	expect(() => applyTodo(deleted, { action: "create", subject: "D", blockedBy: [1] })).toThrow(/deleted/u);
	const done = run(list, { action: "update", id: 1, status: "completed" });
	expect(() => applyTodo(done, { action: "update", id: 1, status: "pending" })).toThrow(/completed to pending/u);
	expect(run(list, { action: "update", id: 2, removeBlockedBy: [1] }).tasks[1]!.blockedBy).toEqual([]);
	expect(list).toEqual(snapshot);
});

test("only one task may be in_progress at a time", () => {
	const list = run(
		emptyTodos(),
		{ action: "create", subject: "First" },
		{ action: "create", subject: "Second" },
		{ action: "update", id: 1, status: "in_progress" },
	);
	expect(() => applyTodo(list, { action: "update", id: 2, status: "in_progress" })).toThrow(
		"Task #1 is already in_progress; complete or reset it before starting #2",
	);
	// Re-asserting the active task is not a second start, and finishing it frees the slot.
	expect(() =>
		applyTodo(list, { action: "update", id: 1, status: "in_progress", activeForm: "working" }),
	).not.toThrow();
	const done = run(
		list,
		{ action: "update", id: 1, status: "completed" },
		{ action: "update", id: 2, status: "in_progress" },
	);
	expect(done.tasks.map((task) => task.status)).toEqual(["completed", "in_progress"]);
});

test("a task with unfinished blockers cannot start, and starts once they finish or are deleted", () => {
	const list = run(
		emptyTodos(),
		{ action: "create", subject: "Design" },
		{ action: "create", subject: "Build", blockedBy: [1] },
	);
	expect(() => applyTodo(list, { action: "update", id: 2, status: "in_progress" })).toThrow(
		"Task #2 is blocked by #1; finish those first",
	);
	expect(list.tasks[1]?.status).toBe("pending");
	const finished = run(list, { action: "update", id: 1, status: "completed" });
	expect(applyTodo(finished, { action: "update", id: 2, status: "in_progress" }).list?.tasks[1]?.status).toBe(
		"in_progress",
	);
	const dropped = run(list, { action: "delete", id: 1 });
	expect(applyTodo(dropped, { action: "update", id: 2, status: "in_progress" }).list?.tasks[1]?.status).toBe(
		"in_progress",
	);
});
