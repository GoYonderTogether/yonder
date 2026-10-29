import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";

// Real SQLite, no model calls: these are the schema and state constraints the tools enforce.
const content = {
	title: "Verify task ledger",
	objective: "Persist task changes and recover their history",
	acceptance: ["SQLite rows preserve the original event", "Reopened store returns the latest state"],
	nonGoals: ["Model evaluation"],
};
function caller(agent = "main", session = "1"): ToolContext {
	return {
		agent,
		session,
		profile: "owner",
		capabilities: ["read", "write"],
		env: {} as never,
		signal: new AbortController().signal,
	};
}
async function temporary() {
	return mkdtemp(join(tmpdir(), "yonder-tasks-constraints-"));
}

test("parent chains stop at two levels and reject cycles", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const parent = store.open(content, ctx);
		const sub = store.open({ ...content, parent: parent.id }, ctx);
		const nested = store.open({ ...content, parent: sub.id }, ctx);
		expect(store.get(nested.id, ctx).task.parent).toBe(sub.id);
		expect(() => store.open({ ...content, parent: nested.id }, ctx)).toThrow("Task nesting is limited to 2 levels");
		expect(() => store.open({ ...content, parent: "missing" }, ctx)).toThrow("Parent task not found");
		// 成环：父任务不能挂到自己的子孙下面，也不能挂到自己下面。
		expect(() => store.update(parent.id, { parent: sub.id }, ctx)).toThrow("A task cannot be nested under itself");
		expect(() => store.update(sub.id, { parent: nested.id }, ctx)).toThrow("A task cannot be nested under itself");
		expect(() => store.update(sub.id, { parent: sub.id }, ctx)).toThrow("A task cannot be nested under itself");
		expect(store.get(parent.id, ctx).task.parent).toBeNull();
		// 合法改挂：nested 挂到 parent 下面仍是两层。
		store.update(nested.id, { parent: parent.id }, ctx);
		expect(store.get(nested.id, ctx).task.parent).toBe(parent.id);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("blocking a task requires a note saying what blocks it", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const task = store.open(content, ctx);
		store.update(task.id, { state: "active" }, ctx);
		expect(() => store.update(task.id, { state: "blocked" }, ctx)).toThrow(
			"Blocking a task requires a note saying what blocks it",
		);
		expect(() => store.update(task.id, { state: "blocked", note: "   " }, ctx)).toThrow(
			"Blocking a task requires a note saying what blocks it",
		);
		expect(store.get(task.id, ctx).task.state).toBe("active");
		expect(store.update(task.id, { state: "blocked", note: "Missing required-input.txt" }, ctx).state).toBe("blocked");
		// 已经在阻塞态时补别的字段不再要求重复写原因。
		expect(store.update(task.id, { objective: "Reworded objective" }, ctx).state).toBe("blocked");
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("a batch of updates commits all of it or none of it", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const first = store.open(content, ctx);
		const second = store.open({ ...content, title: "Second ledger" }, ctx);
		const before = [store.get(first.id, ctx), store.get(second.id, ctx)].map(({ task, history }) => ({
			state: task.state,
			title: task.title,
			events: history.length,
		}));
		expect(() => store.updateMany([], ctx)).toThrow("updates requires at least one entry");
		// 第一条合法、第二条越级（open → review），整批回滚。
		expect(() =>
			store.updateMany(
				[
					{ id: first.id, title: "Renamed" },
					{ id: second.id, state: "review" },
				],
				ctx,
			),
		).toThrow("Invalid task transition: open -> review");
		expect(() =>
			store.updateMany(
				[
					{ id: first.id, state: "active" },
					{ id: "missing", state: "active" },
				],
				ctx,
			),
		).toThrow("Task not found for caller");
		expect(
			[store.get(first.id, ctx), store.get(second.id, ctx)].map(({ task, history }) => ({
				state: task.state,
				title: task.title,
				events: history.length,
			})),
		).toEqual(before);
		// 有序批：同一条任务的两步在一个事务里按顺序生效。
		const applied = store.updateMany(
			[
				{ id: first.id, state: "active" },
				{ id: first.id, state: "review" },
				{ id: second.id, title: "Renamed ledger" },
			],
			ctx,
		);
		expect(applied.map((task) => [task.state, task.title])).toEqual([
			["active", content.title],
			["review", content.title],
			["open", "Renamed ledger"],
		]);
		expect(store.get(first.id, ctx).task.state).toBe("review");
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("contract defaults to the acceptance points and lightweight children persist", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const derived = store.open(content, ctx);
		expect(derived.contract).toBe(content.acceptance.join("; "));
		const explicit = store.open({ ...content, contract: "Ship only when the ledger replays cleanly" }, ctx);
		expect(explicit.contract).toBe("Ship only when the ledger replays cleanly");
		const child = store.open({ ...content, parent: derived.id, lightweight: true }, ctx);
		expect(child.lightweight).toBe(true);
		const reopened = new Store(root);
		expect(reopened.get(child.id, ctx).task).toMatchObject({
			parent: derived.id,
			lightweight: true,
			contract: content.acceptance.join("; "),
		});
		reopened.close();
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});
