import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";
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

/** 记录真实执行的 SQL，用来证明读路径没有退回全表扫或 N+1。 */
function probe() {
	const seen: string[] = [];
	const original = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string) {
		seen.push(sql);
		return original.call(this, sql);
	};
	return {
		seen,
		clear: () => {
			seen.length = 0;
		},
		restore: () => {
			DatabaseSync.prototype.prepare = original;
		},
	};
}

function ledger(root: string) {
	const db = new DatabaseSync(join(root, "tasks.sqlite"));
	try {
		return db
			.prepare("SELECT * FROM events ORDER BY seq")
			.all()
			.map((row) => ({ ...row, data: JSON.parse(String(row.data)) }) as unknown as TaskEvent);
	} finally {
		db.close();
	}
}

async function seed(store: Store) {
	const main = caller(),
		child = caller("child");
	const active = store.open(content, main);
	store.update(active.id, { state: "active", note: "working on it" }, main);
	store.update(active.id, { state: "waiting-user", note: "need the fixture" }, main);
	store.update(active.id, { state: "active" }, main);
	const parent = store.open({ ...content, title: "Parent" }, main);
	const nested = store.open({ ...content, parent: parent.id }, child);
	store.update(nested.id, { state: "active" }, child);
	const done = store.open(content, main);
	store.update(done.id, { state: "active" }, main);
	store.update(done.id, { state: "review" }, main);
	store.done(done.id, "Delivered", ["one", "two"], main);
	const cancelled = store.open(content, main);
	store.update(cancelled.id, { state: "cancelled" }, main);
	// wake 事件只在 replay 里影响 wakeups，投影必须跟上。
	store.render({ agent: "main", session: "1", profile: "owner", workspace: { read: async () => undefined } });
	store.render({ agent: "main", session: "1", profile: "owner", workspace: { read: async () => undefined } });
	return { main, child, active, nested, done, cancelled };
}

test("projection rows equal a full replay of the same ledger", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-projection-"));
	const store = new Store(root);
	try {
		const { main, child } = await seed(store);
		const expected = replay(ledger(root));
		expect(expected.size).toBe(5);
		for (const [id, projected] of expected) {
			const owner = projected.task.ownerAgent === "child" ? child : main;
			expect(store.get(id, owner).task).toEqual(projected.task);
		}
		// 面板进度必须与逐任务读历史算出来的完全一致。
		const tasks = store.list(main);
		const progress = store.progress(tasks);
		for (const task of tasks) {
			const history = store.get(task.id, main).history;
			const stateIndex = history.findLastIndex((event) => event.data.state !== undefined);
			const relevant = ["waiting-user", "blocked"].includes(task.state) ? history.slice(stateIndex) : history;
			const latest = relevant.findLast((event) => event.data.note?.trim() || event.data.deliverable?.trim());
			expect(progress.get(task.id)).toBe(latest?.data.note ?? latest?.data.deliverable ?? null);
		}
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("rebuild restores a damaged projection and backfill fills an empty one", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-rebuild-"));
	const store = new Store(root);
	try {
		const { main, active, done } = await seed(store);
		const before = store.list(main);
		const raw = new DatabaseSync(join(root, "tasks.sqlite"));
		try {
			raw.prepare("DELETE FROM task_current WHERE id = ?").run(done.id);
		} finally {
			raw.close();
		}
		expect(store.list(main).map((task) => task.id)).not.toContain(done.id);
		expect(store.rebuild()).toBe(5);
		expect(store.list(main)).toEqual(before);
		expect(store.get(active.id, main).task.state).toBe("active");

		store.close();
		const wipe = new DatabaseSync(join(root, "tasks.sqlite"));
		try {
			wipe.prepare("DELETE FROM task_current").run();
		} finally {
			wipe.close();
		}
		// 首次打开发现投影为空而账本非空，自动回填一次。
		const reopened = new Store(root);
		try {
			expect(reopened.list(main)).toEqual(before);
		} finally {
			reopened.close();
		}
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("list and get read the projection, never the whole ledger", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-scan-"));
	const store = new Store(root);
	const spy = probe();
	try {
		const { main, active } = await seed(store);
		spy.clear();
		expect(store.list(main)).toHaveLength(5);
		expect(spy.seen.some((sql) => /FROM events/.test(sql))).toBe(false);

		spy.clear();
		const { history } = store.get(active.id, main);
		expect(history[0]!.kind).toBe("open");
		expect(spy.seen.some((sql) => /FROM events\s+ORDER BY seq/.test(sql))).toBe(false);
		expect(spy.seen.some((sql) => /FROM events WHERE task = \?/.test(sql))).toBe(true);
		expect(spy.seen.some((sql) => /FROM task_current/.test(sql))).toBe(true);
	} finally {
		spy.restore();
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("panel takes progress in one query instead of one get per task", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-panel-n1-"));
	const store = new Store(root);
	const spy = probe();
	try {
		const main = caller();
		for (const title of ["One", "Two", "Three"]) {
			const task = store.open({ ...content, title }, main);
			store.update(task.id, { state: "active" }, main);
			store.update(task.id, { state: "waiting-user", note: `waiting for ${title}` }, main);
		}
		const tasks = store.list(main);
		spy.clear();
		const progress = store.progress(tasks);
		expect(tasks.map((task) => progress.get(task.id))).toEqual([
			"waiting for One",
			"waiting for Two",
			"waiting for Three",
		]);
		expect(spy.seen.filter((sql) => /FROM events WHERE task IN/.test(sql))).toHaveLength(1);
		expect(spy.seen.some((sql) => /FROM events WHERE task = \?/.test(sql))).toBe(false);
	} finally {
		spy.restore();
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("a closed store reopens on next use", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-reopen-"));
	try {
		const store = new Store(root);
		const { main } = await seed(store);
		store.close();
		const tasks: Task[] = store.list(main);
		expect(tasks).toHaveLength(5);
		store.close();
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
