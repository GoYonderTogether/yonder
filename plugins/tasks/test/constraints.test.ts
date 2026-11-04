import { rm } from "node:fs/promises";
import type { ToolContext } from "@yonder/sdk";
import { createFilePluginStorage, tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";

const content = {
	title: "Verify task ledger",
	objective: "Persist task changes and recover their history",
	acceptance: ["Events preserve the original history", "Reopened store returns latest state"],
	nonGoals: ["Model evaluation"],
};
const caller = (agent = "main", session = "1"): ToolContext => ({
	agent,
	session,
	profile: "owner",
	capabilities: ["read", "write"],
	env: {} as never,
	signal: new AbortController().signal,
});
const makeStore = (root: string) => new Store(createFilePluginStorage(root).open());
const temporary = () => tempHome("yonder-tasks-constraints-");

test("parent chains stop at two levels and reject cycles", async () => {
	const root = await temporary(),
		store = makeStore(root),
		ctx = caller();
	try {
		const parent = await store.open(content, ctx);
		const sub = await store.open({ ...content, parent: parent.id }, ctx);
		const nested = await store.open({ ...content, parent: sub.id }, ctx);
		expect((await store.get(nested.id, ctx)).task.parent).toBe(sub.id);
		await expect(store.open({ ...content, parent: nested.id }, ctx)).rejects.toThrow(
			"Task nesting is limited to 2 levels",
		);
		await expect(store.open({ ...content, parent: "missing" }, ctx)).rejects.toThrow("Parent task not found");
		await expect(store.update(parent.id, { parent: sub.id }, ctx)).rejects.toThrow(
			"A task cannot be nested under itself",
		);
		await expect(store.update(sub.id, { parent: nested.id }, ctx)).rejects.toThrow(
			"A task cannot be nested under itself",
		);
		await expect(store.update(sub.id, { parent: sub.id }, ctx)).rejects.toThrow("A task cannot be nested under itself");
		expect((await store.get(parent.id, ctx)).task.parent).toBeNull();
		await store.update(nested.id, { parent: parent.id }, ctx);
		expect((await store.get(nested.id, ctx)).task.parent).toBe(parent.id);
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("blocking a task requires a note saying what blocks it", async () => {
	const root = await temporary(),
		store = makeStore(root),
		ctx = caller();
	try {
		const task = await store.open(content, ctx);
		await store.update(task.id, { state: "active" }, ctx);
		await expect(store.update(task.id, { state: "blocked" }, ctx)).rejects.toThrow(
			"Blocking a task requires a note saying what blocks it",
		);
		await expect(store.update(task.id, { state: "blocked", note: "   " }, ctx)).rejects.toThrow(
			"Blocking a task requires a note saying what blocks it",
		);
		expect((await store.get(task.id, ctx)).task.state).toBe("active");
		await store.update(task.id, { note: "Missing required-input.txt" }, ctx);
		await store.update(task.id, { note: "Missing required-input.txt" }, ctx);
		expect((await store.update(task.id, { state: "blocked", note: "Missing required-input.txt" }, ctx)).state).toBe(
			"blocked",
		);
		expect((await store.update(task.id, { objective: "Reworded objective" }, ctx)).state).toBe("blocked");
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("a batch of updates commits all of it or none of it", async () => {
	const root = await temporary(),
		store = makeStore(root),
		ctx = caller();
	try {
		const first = await store.open(content, ctx);
		const second = await store.open({ ...content, title: "Second ledger" }, ctx);
		const before = await Promise.all(
			[first, second].map(async ({ id }) => {
				const { task, history } = await store.get(id, ctx);
				return { state: task.state, title: task.title, events: history.length };
			}),
		);
		await expect(store.updateMany([], ctx)).rejects.toThrow("updates requires at least one entry");
		await expect(
			store.updateMany(
				[
					{ id: first.id, title: "Renamed" },
					{ id: second.id, state: "review" },
				],
				ctx,
			),
		).rejects.toThrow("Invalid task transition: open -> review");
		await expect(
			store.updateMany(
				[
					{ id: first.id, state: "active" },
					{ id: "missing", state: "active" },
				],
				ctx,
			),
		).rejects.toThrow("Task not found for caller");
		const after = await Promise.all(
			[first, second].map(async ({ id }) => {
				const { task, history } = await store.get(id, ctx);
				return { state: task.state, title: task.title, events: history.length };
			}),
		);
		expect(after).toEqual(before);
		const applied = await store.updateMany(
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
		expect((await store.get(first.id, ctx)).task.state).toBe("review");
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("contract defaults to the acceptance points and lightweight children persist", async () => {
	const root = await temporary(),
		store = makeStore(root),
		ctx = caller();
	try {
		const derived = await store.open(content, ctx);
		expect(derived.contract).toBe(content.acceptance.join("; "));
		const explicit = await store.open({ ...content, contract: "Ship only when the ledger replays cleanly" }, ctx);
		expect(explicit.contract).toBe("Ship only when the ledger replays cleanly");
		const child = await store.open({ ...content, parent: derived.id, lightweight: true }, ctx);
		expect(child.lightweight).toBe(true);
		const reopened = makeStore(root);
		expect((await reopened.get(child.id, ctx)).task).toMatchObject({
			parent: derived.id,
			lightweight: true,
			contract: content.acceptance.join("; "),
		});
		await reopened.close();
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});
