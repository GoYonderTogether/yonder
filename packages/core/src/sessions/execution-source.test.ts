import { executionSources } from "@yonder/bot-core/sessions/execution-source";
import { parseAgentConfig } from "@yonder/bot-definition";
import type { ExecutionOwner, SessionInfo } from "@yonder/sdk";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";

test("program source refs recheck real owner DM routes and inherit only core submission links", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().link("acct:card:owner", "person:owner");
		const agents = new Map([
			[
				"bot",
				parseAgentConfig(
					JSON.stringify({
						schema: 1,
						id: "bot",
						name: "Bot",
						owner: "person:owner",
						defaultProfile: "default",
						profiles: { default: {} },
						bindings: [],
					}),
					"agent.yaml",
					"bot",
				),
			],
		]);
		const session: SessionInfo = {
			id: "1",
			agent: "bot",
			profile: "default",
			mode: "main",
			key: "main",
			version: "test",
			opened: new Date().toISOString(),
		};
		await store.sessions.put(session);
		const owner: ExecutionOwner = { session: "1", agent: "bot", profile: "default" };
		const inbound = (from: string, kind: "dm" | "group") =>
			store.events.record({ type: "message.in", from, conv: "conv:card:room", data: { kind, text: "source" } }, [
				{ agent: "bot", session: "1", binding: "owner", wake: "run" },
			]);
		const dm = await inbound("acct:card:owner", "dm");
		expect((await executionSources(store, agents, { ...owner, inputs: [dm.id] }))?.map((event) => event.id)).toEqual([
			dm.id,
		]);
		const group = await inbound("acct:card:owner", "group");
		const visitor = await inbound("acct:card:visitor", "dm");
		for (const inputs of [[group.id], [visitor.id], [dm.id, visitor.id]])
			expect(await executionSources(store, agents, { ...owner, inputs })).toBeUndefined();
		expect(await executionSources(store, agents, owner)).toBeUndefined();
		expect(await executionSources(store, agents, { ...owner, profile: "other", inputs: [dm.id] })).toBeUndefined();
		await store.sessions.put({ ...session, id: "2", agent: null, mode: "task", profile: "task", key: "task" });
		const input = await store.events.record({
			type: "session.input",
			from: "plugin:cron",
			data: { session: "2", text: "program", waiting: false, executionOwner: { ...owner, inputs: [dm.id] } },
		});
		expect(
			(await executionSources(store, agents, { session: "2", agent: null, profile: "task", inputs: [input.id] }))?.map(
				(event) => event.id,
			),
		).toEqual([dm.id]);
		const legacy = await store.events.record({
			type: "session.input",
			from: "plugin:cron",
			data: { session: "2", text: "legacy", waiting: false },
		});
		expect(
			await executionSources(store, agents, { session: "2", agent: null, profile: "task", inputs: [legacy.id] }),
		).toBeUndefined();
	} finally {
		await db.close();
	}
});
