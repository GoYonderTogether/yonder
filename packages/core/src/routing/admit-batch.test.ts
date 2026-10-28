import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { admitBatch } from "./admit-batch.js";
import { socialDecision } from "./social.js";

test("batch admission rechecks authorization, quiet and binding without routing an event", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const agent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "a",
				name: "A",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: { group: {} },
				social: {
					enabled: true,
					authorized: { conversations: ["conv:test:g"] },
					defaults: { group: { mode: "batch" } },
				},
				bindings: [
					{
						id: "batch",
						match: { type: "social.batch-ready" },
						session: { mode: "persistent", per: "conv" },
						reply: "none",
					},
				],
			}),
		);
		await store.sessions.put({
			id: "1",
			agent: "a",
			profile: "group",
			mode: "persistent",
			key: "conv:conv:test:g",
			version: "1",
			opened: "now",
		});
		const source = await store.events.record(
			{ type: "message.in", from: "acct:test:u", conv: "conv:test:g", data: { kind: "group", text: "hello" } },
			[{ agent: "a", binding: "group", session: "1", wake: "write" }],
		);
		const revision = socialDecision(agent, source, undefined)?.revision ?? "";
		const request = {
			agent: "a",
			conv: "conv:test:g",
			through: source.id,
			sourceEvents: [source.id],
			policyRevision: revision,
		};
		const deps = { agents: new Map([["a", agent]]), store };
		expect(await admitBatch(request, deps)).toEqual({ session: "1" });
		agent.social!.denied = ["conv:test:g"];
		expect(await admitBatch(request, deps)).toBeUndefined();
		delete agent.social!.denied;
		agent.social!.defaults!.group!.quiet = { timezone: "UTC", start: "00:00", end: "23:59" };
		expect(await admitBatch(request, deps)).toBeUndefined();
		delete agent.social!.defaults!.group!.quiet;
		agent.bindings = [];
		expect(await admitBatch(request, deps)).toBeUndefined();
	} finally {
		await db.close();
	}
});
