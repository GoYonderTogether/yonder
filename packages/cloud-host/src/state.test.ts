import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionInfo } from "@yonder/sdk";
import { executionContext } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
import { resolveProfile } from "../../core/src/config/test-support.js";
import { createQuota } from "../../core/src/kernel/quota.js";
import { cid } from "../../core/src/runtime/docs.js";
import { Runtime } from "../../core/src/runtime/index.js";
import { migratePostgresRuntime, PostgresStorage } from "../../core/src/runtime/postgres-storage.js";
import { createPostgresStore, migratePostgresStore } from "../../core/src/store/postgres.js";
import { testPostgres } from "./test-postgres.js";

const context = executionContext(new AbortController().signal);
let database: Awaited<ReturnType<typeof testPostgres>>;
beforeAll(async () => {
	database = await testPostgres();
	await migratePostgresRuntime(database.pool);
	await migratePostgresStore(database.pool);
}, 60000);
afterAll(async () => {
	await database?.close();
});

test("PG runtime uses the shared Runtime for writes, fork ancestry, documents and reopened transcripts", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-pg-runtime-"));
	const options = {
		home,
		config: { schema: 1 as const },
		resolveSession: async () => ({
			agent: null,
			profile: "default",
			cwd: home,
			resolved: resolveProfile({ capabilities: [] }),
		}),
	};
	let runtime: Runtime | undefined;
	try {
		runtime = await Runtime.open({
			...options,
			storage: await PostgresStorage.open(database.pool, "owner-a", "runtime", context),
		});
		const id = await runtime.create({ agent: null, profile: "default", cwd: home, close: "manual" });
		await runtime.submit(id, { text: "Verify PostgreSQL persistence without a model request.", wake: "write" });
		const transcript = await runtime.transcript(id);
		expect(transcript[0]?.text).toBe("Verify PostgreSQL persistence without a model request.");
		const child = await runtime.fork(id, transcript[0]!.id);
		expect(await runtime.forkParent(child)).toEqual({ id, at: transcript[0]!.id });
		await runtime.close();
		runtime = undefined;
		runtime = await Runtime.open({
			...options,
			storage: await PostgresStorage.open(database.pool, "owner-a", "runtime", context),
		});
		expect(await runtime.transcript(id)).toEqual(transcript);
		expect(await runtime.forkParent(child)).toEqual({ id, at: transcript[0]!.id });
		expect((await runtime.sessionState(id))?.close).toBe("manual");
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("PG storage isolates tenant and Bot, retains uncommitted ID reservations and leaves the shared Pool open", async () => {
	const first = await PostgresStorage.open(database.pool, "owner-a", "isolated", context);
	const id = cid(String(await first.mintId()));
	await first.commit([{ type: "conversation", value: { id } }], context);
	const unused = Number(await first.mintId());
	await first.close(context);
	await expect(first.mintId()).rejects.toThrow("closed");
	const reopened = await PostgresStorage.open(database.pool, "owner-a", "isolated", context);
	expect(Number(await reopened.mintId())).toBeGreaterThan(unused);
	expect(await reopened.conversation(id, context)).toEqual({ id });
	for (const [tenant, bot] of [
		["owner-b", "isolated"],
		["owner-a", "other-bot"],
	] as const) {
		const other = await PostgresStorage.open(database.pool, tenant, bot, context);
		expect(await other.conversation(id, context)).toBeUndefined();
		await other.close(context);
	}
	await reopened.close(context);
	expect((await database.pool.query("SELECT 1 AS alive")).rows).toEqual([{ alive: 1 }]);
});

test("PG invalid batches and real database failure expose neither partial memory state nor partial durable state", async () => {
	const storage = await PostgresStorage.open(database.pool, "owner-a", "atomic-failure", context);
	const id = cid("100");
	await expect(
		storage.commit(
			[
				{ type: "conversation", value: { id } },
				{ type: "conversation", value: { id } },
			],
			context,
		),
	).rejects.toThrow();
	expect(await storage.conversation(id, context)).toBeUndefined();
	await database.pool.query(
		"ALTER TABLE bot_runtime_commits ADD CONSTRAINT reject_test_commit CHECK(bot_id<>'atomic-failure')",
	);
	try {
		await expect(storage.commit([{ type: "conversation", value: { id } }], context)).rejects.toThrow(
			"reject_test_commit",
		);
		expect(await storage.conversation(id, context)).toBeUndefined();
		expect(
			(
				await database.pool.query("SELECT * FROM bot_runtime_commits WHERE tenant_id=$1 AND bot_id=$2", [
					"owner-a",
					"atomic-failure",
				])
			).rows,
		).toEqual([]);
		expect(
			(
				await database.pool.query("SELECT next_id FROM bot_runtime_ids WHERE tenant_id=$1 AND bot_id=$2", [
					"owner-a",
					"atomic-failure",
				])
			).rows[0]?.next_id,
		).toBe("2");
	} finally {
		await database.pool.query("ALTER TABLE bot_runtime_commits DROP CONSTRAINT reject_test_commit");
		await storage.close(context);
	}
});

test("PG domain Store keeps concurrent input dedupe, waiting routes, names, identity and session metadata", async () => {
	const observed: string[] = [];
	const store = createPostgresStore(
		database.pool,
		"owner-a",
		"domain",
		() => "person:owner",
		(event) => observed.push(event.id),
	);
	const identity = store.identity("acct:cli:local");
	await identity.createPerson({ id: "owner", name: "owner" });
	await identity.link("acct:cli:local", "person:owner");
	const session: SessionInfo = {
		id: "2",
		agent: "main",
		profile: "default",
		mode: "main",
		key: "main",
		version: "v",
		opened: new Date().toISOString(),
	};
	await store.sessions.put(session);
	const routes = [{ agent: "main", binding: null, session: "2", wake: "run" as const, waiting: true }];
	const input = {
		type: "message.in",
		from: "acct:cli:local",
		conv: "conv:cli:local",
		data: {
			msgId: "input-1",
			name: "owner",
			mentionNames: { "acct:cli:bot": "小未" },
			text: "Read the supplied source.",
		},
	};
	const accepted = await Promise.all(Array.from({ length: 5 }, () => store.events.record(input, routes)));
	expect(new Set(accepted.map((event) => event.id)).size).toBe(1);
	expect(await store.events.waitingInputs("2")).toEqual([accepted[0]]);
	expect((await store.events.query({ type: "message.*", agent: "main", limit: 1 })).events).toEqual([accepted[0]]);
	expect(await identity.relation("main", "acct:cli:local")).toBe("owner");
	expect((await identity.account("acct:cli:bot"))?.name).toBe("小未");
	expect(await identity.lookup("person:owner")).toMatchObject({ convs: ["conv:cli:local"], agents: ["main"] });
	await store.sessions.update("2", {
		archivedAt: 1234,
		pinned: true,
		title: "已验证",
		needsOwner: { reason: "核对", since: 1 },
		channels: ["cli"],
	});
	expect(await store.sessions.list()).toEqual([]);
	expect(await store.sessions.list({ archived: true, pinned: true })).toEqual([
		expect.objectContaining({ id: "2", archivedAt: 1234, title: "已验证", channels: ["cli"] }),
	]);
	await store.sessions.update("2", { archivedAt: null, pinned: null, title: null });
	expect((await store.sessions.find("main", "main"))?.owner).toEqual({ kind: "owner", id: "owner" });
	await store.sessions.setVersion("2", "v2");
	expect((await store.sessions.get("2"))?.version).toBe("v2");
	await identity.unlink("acct:cli:local");
	expect(await identity.relation("main", "acct:cli:local")).toBe("stranger");
	for (const [tenant, bot] of [
		["owner-b", "domain"],
		["owner-a", "other-domain"],
	] as const) {
		const other = createPostgresStore(database.pool, tenant, bot);
		expect((await other.events.query()).events).toEqual([]);
		expect(await other.sessions.get("2")).toBeUndefined();
		expect(await other.identity().account("acct:cli:local")).toBeUndefined();
	}
	expect(observed).toHaveLength(3);
});

test("PG run.end and quota settlement are atomic, idempotent and keep the same null-delimited guest keys", async () => {
	const store = createPostgresStore(database.pool, "owner-a", "settlement");
	const quota = createQuota({ store: store.quota, outsiders: { guestMaxRounds: 3 }, now: () => Date.UTC(2026, 10, 2) });
	const subject = { kind: "guest" as const, qr: "conv:card:room", source: "acct:card:visitor" };
	await quota.charge(subject, 0, 1);
	expect(await quota.guestRounds(subject)).toBe(1);
	const ending = { type: "run.end", data: { session: "2", runId: "run-1", inputs: ["input-1"] } };
	await expect(
		store.events.recordRun(ending, async (ledger) => {
			await ledger.add("2026-11-02", "owner", "share", 12);
			throw new Error("settlement failed");
		}),
	).rejects.toThrow("settlement failed");
	expect(await store.events.runEnd("2", "run-1")).toBeUndefined();
	expect((await store.quota.get("2026-11-02", "owner", "share")).tokens).toBe(0);
	let settlements = 0;
	const results = await Promise.all(
		Array.from({ length: 3 }, () =>
			store.events.recordRun(ending, async (ledger) => {
				settlements++;
				await ledger.add("2026-11-02", "owner", "share", 12);
			}),
		),
	);
	expect(results.filter(Boolean)).toHaveLength(1);
	expect(settlements).toBe(1);
	expect((await store.quota.get("2026-11-02", "owner", "share")).tokens).toBe(12);
	expect((await store.events.runForInput("2", "input-1"))?.data).toEqual(ending.data);
});

test("PG delivery attempts keep receipts, retry recovery, source inputs and event pagination", async () => {
	const store = createPostgresStore(database.pool, "owner-a", "delivery");
	const first = await store.events.record({ type: "session.input", data: { session: "2", text: "First input" } });
	await store.events.record({ type: "session.input", data: { session: "2", text: "Later input" } });
	expect(await store.events.firstTaskInputs(["2"])).toEqual(new Map([["2", "First input"]]));
	const target = "conv:card:main:room";
	const attempt = await store.events.claimAttempt({
		type: "message.attempt",
		conv: target,
		data: { session: "2", runId: "run", target, message: "42" },
	});
	expect(attempt).toBeTruthy();
	expect(
		await store.events.claimAttempt({
			type: "message.attempt",
			data: { session: "2", runId: "run", target, message: "42" },
		}),
	).toBeUndefined();
	expect((await store.events.unresolvedAttempts()).map((event) => event.id)).toContain(attempt);
	await store.events.record({
		type: "message.out",
		from: "agent:main",
		conv: target,
		data: { attempt, session: "2", text: "Reply", sourceMessageId: first.id, delivery: { ok: false, retryable: true } },
	});
	expect(await store.events.unresolvedAttempts()).toEqual([]);
	expect((await store.events.retryableAttempts())[0]?.data).toMatchObject({
		outgoing: { text: "Reply", sourceMessageId: first.id },
		from: "agent:main",
	});
	await store.events.record({ type: "message.retry", data: { attempt } });
	expect((await store.events.unresolvedAttempts()).map((event) => event.id)).toContain(attempt);
	expect(await store.events.retryableAttempts()).toEqual([]);
	const result = await store.events.record({
		type: "agent.result",
		parent: first.id,
		data: { session: "2", job: "j", text: "Done" },
	});
	expect(await store.events.agentResult("2", first.id)).toEqual(result);
	await store.events.record({
		type: "run.end",
		data: { session: "2", runId: "r2", completionNotices: [{ text: "done" }] },
	});
	expect(await store.events.completionNotices()).toHaveLength(1);
	expect(await store.events.outputSince("2", target)).toHaveLength(2);
	const page = await store.events.query({ limit: 1 });
	expect(page.events).toEqual([first]);
	expect(page.next).toBe(first.id);
	expect((await store.events.query({ after: page.next! })).events.length).toBeGreaterThan(1);
	expect(await store.events.watermark()).toBeTruthy();
	await expect(store.events.query({ limit: 0 })).rejects.toThrow("event limit");
	const all = (await store.events.query()).events;
	const clone = createPostgresStore(database.pool, "owner-a", "delivery");
	expect((await clone.events.query()).events).toEqual(all);
});
