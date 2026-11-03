import { conversationPromptOptions } from "@yonder/bot-core/kernel/conversation";
import { parseAgentConfig } from "@yonder/bot-definition";
import type { YEvent } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPostgresStore, migratePostgresStore } from "./store/postgres.js";
import { testPostgres } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
beforeAll(async () => {
	database = await testPostgres();
	await migratePostgresStore(database.pool);
}, 60000);
afterAll(async () => {
	await database?.close();
});

test("PG event queries preserve ascending after cursors and descending before cursors with source filters", async () => {
	const store = createPostgresStore(database.pool, "owner", "paging");
	const events: YEvent[] = [];
	for (let index = 0; index < 6; index++)
		events.push(
			await store.events.record({
				type: "message.in",
				from: "acct:card:owner",
				conv: index === 3 ? "conv:card:other" : "conv:card:room",
				data: { kind: "dm", text: String(index) },
			}),
		);
	const ascending = await store.events.query({ conv: "conv:card:room", limit: 2 });
	expect(ascending.events).toEqual(events.slice(0, 2));
	expect(ascending.next).toBe(events[1]!.id);
	expect((await store.events.query({ conv: "conv:card:room", after: ascending.next! })).events).toEqual([
		events[2],
		events[4],
		events[5],
	]);
	const newest = await store.events.query({ conv: "conv:card:room", from: "acct:card:owner", order: "desc", limit: 2 });
	expect(newest.events).toEqual([events[5], events[4]]);
	expect(newest.next).toBe(events[4]!.id);
	expect(
		(
			await store.events.query({
				conv: "conv:card:room",
				from: "acct:card:owner",
				before: newest.next!,
				order: "desc",
				limit: 2,
			})
		).events,
	).toEqual([events[2], events[1]]);
	expect(
		(await store.events.query({ conv: "conv:card:room", after: events[0]!.id, before: events[4]!.id })).events,
	).toEqual([events[1], events[2]]);
	await expect(store.events.query({ order: "desc; DROP TABLE bot_events" as never })).rejects.toThrow(
		"event order must be asc or desc",
	);
});

test("PG private main context selects the newest prior same-origin owner messages from a long history", async () => {
	const store = createPostgresStore(database.pool, "owner", "private-main", () => "person:owner");
	await store.identity().createPerson({ id: "owner", name: "Owner" });
	await store.identity().link("acct:card:owner", "person:owner");
	const agent = parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "小未",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
		}),
		"agent.yaml",
		"main",
	);
	await store.sessions.put({
		id: "2",
		agent: "main",
		profile: "default",
		mode: "main",
		key: "main",
		version: "test",
		opened: new Date().toISOString(),
	});
	const route = [{ agent: "main", binding: "owner", session: "2", wake: "run" as const, waiting: false }];
	const history: YEvent[] = [];
	for (let index = 0; index < 110; index++)
		history.push(
			await store.events.record(
				{
					type: "message.in",
					from: "acct:card:owner",
					conv: "conv:card:room",
					data: { kind: "dm", text: `Prior owner message ${index}` },
				},
				route,
			),
		);
	const current = await store.events.record(
		{
			type: "message.in",
			from: "acct:card:owner",
			conv: "conv:card:room",
			data: { kind: "dm", text: "Current request" },
		},
		route,
	);
	await store.events.record(
		{
			type: "message.in",
			from: "acct:card:owner",
			conv: "conv:card:room",
			data: { kind: "dm", text: "Later message, exclude" },
		},
		route,
	);
	const options = conversationPromptOptions(store, new Map([["main", agent]]), () => {
		throw new Error("No runtime required for owner context");
	});
	const serialized = await options.conversationContext!(current, "main");
	expect(typeof serialized).toBe("string");
	if (typeof serialized !== "string") throw new Error("Owner private main context lost its serialized form");
	const value = JSON.parse(serialized);
	expect(value.scope).toBe("owner-private-main");
	expect(value.history.items.map((item: { id: string }) => item.id)).toEqual(
		history.slice(-3).map((event) => event.id),
	);
	expect(value.history.olderAvailable).toBe(true);
	expect(value.history.items.map((item: { text: string }) => item.text)).toEqual(
		history.slice(-3).map((event) => (event.data as { text: string }).text),
	);
});
