import { rm } from "node:fs/promises";
import type { PluginFiles, ToolContext } from "@yonder/sdk";
import { createFilePluginStorage, tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";
import { readAllHistory, readProjection, writeProjection } from "../src/store/ledger.js";
import { replay, type Task, type TaskEvent } from "../src/store/project.js";

const content = {
	title: "Projection parity",
	objective: "The read model must equal a full replay",
	acceptance: ["Same task state", "Same history"],
	nonGoals: ["Timing"],
};
const caller = (
	agent: string | null = "main",
	session = "1",
	capabilities: ToolContext["capabilities"] = ["read", "write"],
): ToolContext => ({
	agent,
	session,
	profile: "owner",
	capabilities,
	env: {} as never,
	signal: new AbortController().signal,
});
const makeStore = (root: string) => new Store(createFilePluginStorage(root).open());

async function savedEvents(root: string): Promise<TaskEvent[]> {
	return readAllHistory(createFilePluginStorage(root).open());
}

function observed(files: PluginFiles, reads: string[]): PluginFiles {
	return new Proxy(files, {
		get(target, key) {
			if (key === "read")
				return (path: string) => {
					reads.push(path);
					return target.read(path);
				};
			if (key === "transaction")
				return (change: (files: PluginFiles) => Promise<unknown>) =>
					target.transaction((tx) => change(observed(tx, reads)));
			return Reflect.get(target, key, target);
		},
	});
}

async function seed(store: Store) {
	const main = caller(),
		child = caller("child");
	const active = await store.open(content, main);
	await store.update(active.id, { state: "active", note: "working on it" }, main);
	await store.update(active.id, { state: "waiting-user", note: "need the fixture" }, main);
	await store.update(active.id, { state: "active" }, main);
	const parent = await store.open({ ...content, title: "Parent" }, main);
	const nested = await store.open({ ...content, parent: parent.id }, child);
	await store.update(nested.id, { state: "active" }, child);
	const done = await store.open({ ...content, title: "Finished" }, main);
	await store.update(done.id, { state: "active" }, main);
	await store.update(done.id, { state: "review" }, main);
	await store.done(done.id, "Delivered", ["one", "two"], main);
	const cancelled = await store.open({ ...content, title: "Cancelled" }, main);
	await store.update(cancelled.id, { state: "cancelled" }, main);
	await store.render({ agent: "main", session: "1", profile: "owner", workspace: { read: async () => undefined } });
	await store.render({ agent: "main", session: "1", profile: "owner", workspace: { read: async () => undefined } });
	return { main, child, active, parent, nested, done, cancelled };
}

function progressFromReplay(events: TaskEvent[], task: Task): string | null {
	const rows = events.filter((event) => event.task === task.id).map((event) => event.data);
	const stateIndex = rows.findLastIndex((data) => data.state !== undefined);
	const relevant = ["waiting-user", "blocked"].includes(task.state) ? rows.slice(stateIndex) : rows;
	const latest = relevant.findLast((data) => data.note?.trim() || data.deliverable?.trim());
	return latest?.note ?? latest?.deliverable ?? null;
}

test("projection rows equal a full replay of the same event history", async () => {
	const root = await tempHome("yonder-projection-");
	const store = makeStore(root);
	try {
		const { main, child } = await seed(store);
		const events = await savedEvents(root);
		const expected = replay(events);
		expect(expected.size).toBe(5);
		for (const [id, projected] of expected) {
			const owner = projected.task.ownerAgent === "child" ? child : main;
			expect((await store.get(id, owner)).task).toEqual(projected.task);
		}
		const tasks = await store.list(main);
		const progress = await store.progress(tasks);
		for (const task of tasks) expect(progress.get(task.id)).toBe(progressFromReplay(events, task));
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("rebuild restores a damaged projection and first use backfills an empty one", async () => {
	const root = await tempHome("yonder-rebuild-");
	const files = createFilePluginStorage(root).open();
	const store = new Store(files);
	try {
		const { main, active, done } = await seed(store);
		const before = await store.list(main);
		await files.transaction(async (tx) => {
			const projection = await readProjection(tx);
			delete projection.tasks[done.id];
			await writeProjection(tx, projection);
		});
		expect((await store.list(main).then((tasks) => tasks.map((task) => task.id))).includes(done.id)).toBe(false);
		expect(await store.rebuild()).toBe(5);
		expect(await store.list(main)).toEqual(before);
		expect((await store.get(active.id, main)).task.state).toBe("active");

		await store.close();
		await files.transaction((tx) => tx.remove("projection.json"));
		const reopened = makeStore(root);
		try {
			expect(await reopened.list(main)).toEqual(before);
		} finally {
			await reopened.close();
		}
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("execution source metadata survives reopen, is replaced without stale inputs, and ignores ledger ticks", async () => {
	const root = await tempHome("yonder-task-source-");
	const first = makeStore(root);
	const ctx = caller();
	try {
		const task = await first.open(content, ctx, {
			executionOwner: { session: "1", agent: "main", profile: "owner", inputs: ["native-event-1"] },
			resources: [{ deviceId: "local", paths: ["/workspace/first"] }],
		});
		await first.close();
		const reopened = makeStore(root);
		try {
			expect((await reopened.get(task.id, ctx)).task).toMatchObject({
				executionOwner: { session: "1", agent: "main", profile: "owner", inputs: ["native-event-1"] },
				resources: [{ deviceId: "local", paths: ["/workspace/first"] }],
			});
			await expect(
				reopened.update(task.id, { objective: "Rejected instruction" }, ctx, {
					executionOwner: { session: "1", agent: "main", profile: "owner" },
					resources: [{ deviceId: "local", paths: ["/outside"] }],
				}),
			).rejects.toThrow("No shared execution resources");
			expect((await reopened.get(task.id, ctx)).task).toMatchObject({
				objective: content.objective,
				executionOwner: { inputs: ["native-event-1"] },
				resources: [{ deviceId: "local", paths: ["/workspace/first"] }],
			});
			await reopened.update(task.id, { objective: "Revised instruction" }, ctx, {
				executionOwner: { session: "1", agent: "main", profile: "owner" },
				resources: [{ deviceId: "local", paths: ["/workspace/first/revised"] }],
			});
			await reopened.spend(task.id, 12, false);
			expect((await reopened.get(task.id, ctx)).task).toMatchObject({
				objective: "Revised instruction",
				executionOwner: { session: "1", agent: "main", profile: "owner" },
				resources: [{ deviceId: "local", paths: ["/workspace/first/revised"] }],
			});
			expect((await reopened.get(task.id, ctx)).task.executionOwner).not.toHaveProperty("inputs");
		} finally {
			await reopened.close();
		}
	} finally {
		await first.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("batch instruction updates replace only the updated task source", async () => {
	const root = await tempHome("yonder-task-source-batch-");
	const store = makeStore(root);
	const ctx = caller();
	const original = {
		executionOwner: { session: "1", agent: "main", profile: "owner", inputs: ["captured-event-old"] },
		resources: [{ deviceId: "local", paths: ["/workspace/shared"] }],
	};
	try {
		const revised = await store.open({ ...content, title: "Revised task" }, ctx, original);
		const statusOnly = await store.open({ ...content, title: "Status-only task" }, ctx, original);
		await store.updateMany(
			[
				{ id: revised.id, objective: "New instruction" },
				{ id: statusOnly.id, state: "active", note: "Progress only" },
			],
			ctx,
			{
				executionOwner: { session: "1", agent: "main", profile: "owner" },
				resources: [{ deviceId: "local", paths: ["/workspace/shared/narrow"] }],
			},
		);
		expect((await store.get(revised.id, ctx)).task).toMatchObject({
			objective: "New instruction",
			executionOwner: { session: "1", agent: "main", profile: "owner" },
			resources: [{ deviceId: "local", paths: ["/workspace/shared/narrow"] }],
		});
		const statusResult = await store.get(statusOnly.id, ctx);
		expect(statusResult.task).toMatchObject({
			state: "active",
			executionOwner: original.executionOwner,
			resources: original.resources,
		});
		expect(statusResult.history.at(-1)?.data.note).toBe("Progress only");
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("list and get read the projection and only the requested task history", async () => {
	const root = await tempHome("yonder-projection-reads-");
	const reads: string[] = [];
	const store = new Store(observed(createFilePluginStorage(root).open(), reads));
	const ctx = caller();
	try {
		const tasks: Task[] = [];
		for (const title of ["One", "Two", "Three"]) {
			const task = await store.open({ ...content, title }, ctx);
			await store.update(task.id, { state: "active", note: `Progress ${title}` }, ctx);
			tasks.push(task);
		}

		reads.length = 0;
		expect(await store.list(ctx)).toHaveLength(3);
		expect(reads).toEqual(["projection.json"]);

		reads.length = 0;
		const target = tasks[1]!;
		const result = await store.get(target.id, ctx);
		expect(result.history).toHaveLength(2);
		expect(reads.sort()).toEqual([`history/${target.id}.json`, "projection.json"].sort());
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("panel progress reads one projection without per-task history scans", async () => {
	const root = await tempHome("yonder-panel-progress-");
	const reads: string[] = [];
	const store = new Store(observed(createFilePluginStorage(root).open(), reads));
	const main = caller();
	try {
		const tasks: Task[] = [];
		for (const title of ["One", "Two", "Three"]) {
			const task = await store.open({ ...content, title }, main);
			await store.update(task.id, { state: "active" }, main);
			await store.update(task.id, { state: "waiting-user", note: `waiting for ${title}` }, main);
			tasks.push(task);
		}
		reads.length = 0;
		expect(await store.progress(tasks)).toEqual(new Map(tasks.map((task) => [task.id, `waiting for ${task.title}`])));
		expect(reads).toEqual(["projection.json"]);
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("a rejected batch leaves the persisted event history unchanged", async () => {
	const root = await tempHome("yonder-event-transaction-");
	const store = makeStore(root);
	const ctx = caller();
	try {
		const first = await store.open(content, ctx);
		const second = await store.open({ ...content, title: "Second" }, ctx);
		const before = await savedEvents(root);
		await expect(
			store.updateMany(
				[
					{ id: first.id, title: "Changed" },
					{ id: second.id, state: "review" },
				],
				ctx,
			),
		).rejects.toThrow("Invalid task transition");
		expect(await savedEvents(root)).toEqual(before);
	} finally {
		await store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("a closed store reads and writes again on its next use", async () => {
	const root = await tempHome("yonder-reopen-");
	const store = makeStore(root);
	const main = caller();
	try {
		const { active } = await seed(store);
		await store.close();
		expect(await store.list(main)).toHaveLength(5);
		expect((await store.get(active.id, main)).task.state).toBe("active");
		await store.update(active.id, { title: "Updated after close" }, main);
		expect((await store.get(active.id, main)).task.title).toBe("Updated after close");
		await store.close();
		await store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
