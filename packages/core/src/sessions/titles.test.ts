import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { createSessions } from "./index.js";
import { autoTitle, cleanTitle } from "./titles.js";

test("cleanTitle keeps the first line and limits Chinese to 10 characters or English to 7 words", () => {
	expect(cleanTitle("\n“整理本周的发票报销材料并提交财务部门审核”。\n多余")).toBe("整理本周的发票报销材");
	expect(cleanTitle("one two three four five six seven eight nine")).toBe("one two three four five six seven");
	expect(cleanTitle("")).toBe("");
});

test("autoTitle never touches a session that already has a title", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: null,
			profile: "default",
			mode: "task",
			key: "1",
			version: "1",
			opened: "now",
			closed: "now",
			title: "我的标题",
		});
		const runtime = {
			sessionConfig: async () => {
				throw new Error("model must not be consulted");
			},
		} as unknown as Runtime;
		const rename = async () => {
			throw new Error("must not rename");
		};
		await expect(
			autoTitle({ id: "1", input: "你好", reply: "你好", store, runtime, workbench: { rename } as never }),
		).resolves.toBeUndefined();
	} finally {
		await db.close();
	}
});

test("first task inputs use owner input in event order, skipping plugin and empty input", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.events.record({
			type: "session.input",
			from: "plugin:test",
			data: { session: "1", text: "tool output" },
		});
		await store.events.record({ type: "session.input", data: { session: "1", text: "  \n" } });
		await store.events.record({ type: "session.input", data: { session: "1", text: "first instruction" } });
		await store.events.record({ type: "session.input", data: { session: "1", text: "later instruction" } });
		await store.events.record({
			type: "session.input",
			from: "agent:main",
			data: { session: "2", text: "委派目标", taskOwned: true },
		});
		expect(await store.events.firstTaskInputs(["1", "2"])).toEqual(
			new Map([
				["1", "first instruction"],
				["2", "委派目标"],
			]),
		);
	} finally {
		await db.close();
	}
});

test("session list and detail project the first instruction without locking a manual title", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: null,
			profile: "default",
			mode: "task",
			key: "1",
			version: "1",
			opened: "now",
		});
		await store.events.record({
			type: "session.input",
			data: { session: "1", text: "整理用户提供的所有项目资料并归档" },
		});
		const runtime = { sessionState: async () => undefined } as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents: new Map(),
			homePresets: new Map(),
			pluginPresets: new Map(),
			home: "/tmp",
			config: { schema: 1 },
			version: "1",
			runtime: () => runtime,
		});
		expect((await sessions.api.list({}))[0]?.title).toBe("整理用户提供的所有项");
		expect((await sessions.api.get("1"))?.title).toBe("整理用户提供的所有项");
		expect((await store.sessions.get("1"))?.title).toBeUndefined();
		await sessions.workbench.rename("1", "手工标题");
		expect((await sessions.api.get("1"))?.title).toBe("手工标题");
	} finally {
		await db.close();
	}
});

test("session list hides missing and archived Bot sessions while retaining tasks and direct access", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const base = { profile: "default", key: "key", version: "1", opened: "now" };
		await store.sessions.put({ ...base, id: "1", agent: "active", mode: "main" });
		await store.sessions.put({ ...base, id: "2", agent: "retired", mode: "persistent" });
		await store.sessions.put({ ...base, id: "3", agent: "missing", mode: "main" });
		await store.sessions.put({ ...base, id: "4", agent: null, mode: "task" });
		const agents = new Map([
			["active", {}],
			["retired", { archivedAt: "2026-01-01" }],
		]) as never;
		const runtime = { sessionState: async () => undefined } as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents,
			homePresets: new Map(),
			pluginPresets: new Map(),
			home: "/tmp",
			config: { schema: 1 },
			version: "1",
			runtime: () => runtime,
		});
		expect((await sessions.api.list({})).map((row) => row.id).sort()).toEqual(["1", "4"]);
		expect((await sessions.api.get("2"))?.id).toBe("2");
		expect((await sessions.api.get("3"))?.id).toBe("3");
	} finally {
		await db.close();
	}
});
