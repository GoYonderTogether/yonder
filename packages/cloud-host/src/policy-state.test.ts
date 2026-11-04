import { createNotificationPrefs } from "@yonder/bot-core/kernel/notifications";
import { budgetState, checkBudget } from "@yonder/bot-core/sessions/budget";
import type { Store } from "@yonder/bot-core/store/contracts";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPostgresStore, migratePostgresStore } from "./store/postgres.js";
import { testPostgres } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
beforeAll(async () => {
	database = await testPostgres();
	await migratePostgresStore(database.pool);
}, 60000);
afterAll(async () => database?.close());

async function check(store: Store) {
	await store.sessions.put({
		id: "7",
		agent: null,
		profile: "owner",
		mode: "task",
		key: "task-7",
		version: "test",
		opened: "2026-11-02T00:00:00.000Z",
	});
	await store.events.record({ type: "run.end", data: { session: "7", usage: { input: 600, output: 400 } } });
	const now = Date.parse("2026-11-02T00:02:00.000Z");
	expect(await budgetState(store, "7", now)).toEqual({ tokens: 1000, wakeups: 1, minutes: 2 });
	const config = { schema: 1 as const, budget: { tokens: 100, maxMinutes: 0.5, maxWakeups: 1 } };
	await checkBudget({ store, config }, "7", { input: 10, output: 5 }, now);
	await checkBudget({ store, config }, "7", { input: 10, output: 5 }, now);
	expect((await store.budget.read("7")).seen.sort()).toEqual(["minutes", "tokens", "wakeups"]);
	expect((await store.events.query({ type: "budget.exceeded" })).events).toHaveLength(3);
	const defaults = { default: "mention" as const, conversations: { "conv:card:room": "all" as const } };
	const prefs = await createNotificationPrefs(store.notifications, defaults);
	await prefs.set("*", "mute");
	await prefs.set("conv:card:room", "mentions");
	const reopened = await createNotificationPrefs(store.notifications, defaults);
	expect(reopened.get()).toEqual(prefs.get());
	expect(reopened.level("conv:card:room")).toBe("mentions");
	expect(reopened.level("conv:card:other")).toBe("mute");
	await reopened.set("conv:card:room", null);
	expect(reopened.level("conv:card:room")).toBe("all");
}

test("SQLite and PG execute the same notification and session-budget policies", async () => {
	const db = await openDatabase(":memory:");
	try {
		await check(await createStore(db));
		await check(createPostgresStore(database.pool, "policy-owner", "policy-bot"));
	} finally {
		await db.close();
	}
});

test("PG notification preferences and budget facts remain tenant/Bot isolated", async () => {
	for (const [tenant, bot] of [
		["other-owner", "policy-bot"],
		["policy-owner", "other-bot"],
	]) {
		const store = createPostgresStore(database.pool, tenant!, bot!);
		expect(await store.notifications.list()).toEqual([]);
		expect(await store.budget.read("7")).toEqual({ tokens: 0, runs: 0, seen: [] });
	}
});
