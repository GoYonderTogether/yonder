import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { createStore, newEvent } from "./index.js";

test("namespaced trigger inputs retain their waiting route", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const event = await store.events.record(
			{ type: "channel-qq.group-batch", conv: "conv:qq:group:scope", data: { msgId: "batch-scope" } },
			[{ agent: "main", binding: "batch", session: "1", wake: "run", waiting: true }],
		);
		expect(await store.events.waitingInputs("1")).toEqual([event]);
	} finally {
		await db.close();
	}
});

test("appended events and identity are queried from SQLite", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		const identity = store.identity("acct:cli:local");
		await identity.createPerson({ id: "owner", name: "owner" });
		await identity.link("acct:cli:local", "person:owner");
		const event = newEvent(
			{
				type: "message.in",
				from: "acct:cli:local",
				conv: "conv:cli:local",
				data: { kind: "dm", text: "read the workspace" },
			},
			[{ agent: "main", binding: null, dropped: "no-binding" }],
		);
		await store.events.append(event);
		expect((await store.events.query({ type: "message.*", agent: "main" })).events).toEqual([event]);
		expect(await identity.relation("main", "acct:cli:local")).toBe("owner");
		expect((await identity.lookup("person:owner")).convs).toEqual(["conv:cli:local"]);
	} finally {
		await db.close();
	}
});

test("message attempts deduplicate per generation and preserve old run-wide attempts", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const claim = (runId: string, message?: string) =>
			store.events.claimAttempt({
				type: "message.attempt",
				data: { session: "1", runId, target: "conv:test:chat", ...(message ? { message } : {}) },
			});
		expect(await claim("new", "100")).toBeTruthy();
		expect(await claim("new", "100")).toBeUndefined();
		expect(await claim("new", "101")).toBeTruthy();
		expect(await claim("old")).toBeTruthy();
		expect(await claim("old", "102")).toBeUndefined();
	} finally {
		await db.close();
	}
});

test("background results use session/job identity while preserving channel message and command dedupe", async () => {
	const db = await openDatabase(":memory:");
	try {
		const observed: string[] = [];
		const store = await createStore(db, undefined, false, (event) => {
			observed.push(event.id);
		});
		const conv = "conv:feishu:acceptance";
		const msgId = "om_same_source";
		const results = [];
		for (const job of ["1", "2", "3"]) {
			const event = await store.events.record({
				type: "runtime.tool-result",
				conv,
				data: { session: "main", job, msgId, text: `Result of job ${job}` },
			});
			results.push(event);
			const repeated = await store.events.record({
				type: "runtime.tool-result",
				conv,
				data: { session: "main", job, msgId, text: "Repeated completion must retain the first receipt" },
			});
			expect(repeated).toEqual(event);
			expect((await store.events.get(event.id))?.data).toMatchObject({ job, text: `Result of job ${job}` });
		}
		expect(new Set(results.map((event) => event.id)).size).toBe(3);
		const other = await store.events.record({
			type: "runtime.tool-result",
			conv,
			data: { session: "other", job: "1", msgId },
		});
		expect(results.map((event) => event.id)).not.toContain(other.id);
		for (const type of ["message.in", "channel.command"]) {
			const input = { type, conv, data: { msgId } };
			expect(await store.events.record(input)).toEqual(await store.events.record(input));
		}
		expect(observed).toHaveLength(6);
		expect((await store.events.query({ type: "runtime.tool-result" })).events).toHaveLength(4);
	} finally {
		await db.close();
	}
});

test("one multi-agent platform message is accepted once per target agent", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const input = (target: string) => ({
			type: "message.in",
			conv: `conv:card:${target}:group`,
			from: `acct:card:${target}:human`,
			data: { target, msgId: "same-native-id", text: "group input", kind: "group" },
		});
		const first = await store.events.append(newEvent(input("one")));
		const second = await store.events.append(newEvent(input("two")));
		expect(second.id).not.toBe(first.id);
		expect((await store.events.append(newEvent(input("one")))).id).toBe(first.id);
	} finally {
		await db.close();
	}
});

test("event query exact id is parameterized and intersects other filters", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const event = await store.events.record({ type: "message.in", conv: "conv:test:exact", data: {} });
		await store.events.record({ type: "message.in", data: {} });
		expect(await store.events.query({ id: event.id, limit: 1 })).toEqual({ events: [event] });
		expect((await store.events.query({ id: event.id, type: "runtime.*" })).events).toEqual([]);
		expect((await store.events.query({ id: event.id, conv: "conv:test:other" })).events).toEqual([]);
		expect((await store.events.query({ id: "' OR 1=1 --" })).events).toEqual([]);
		expect((await store.events.query({ id: "" })).events).toEqual([]);
		expect((await store.events.query({ id: "missing" })).events).toEqual([]);
	} finally {
		await db.close();
	}
});
