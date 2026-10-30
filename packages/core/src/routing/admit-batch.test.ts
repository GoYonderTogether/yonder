import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { admitBatch } from "./admit-batch.js";
import { participationPlugin } from "./participation.js";
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
				profiles: { group: { plugins: ["social"] } },
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
		const deps = { agents: new Map([["a", agent]]), store, plugins: new Set(["social", "alternative"]) };
		expect(await admitBatch(request, deps)).toEqual({ session: "1" });
		agent.social!.denied = ["conv:test:g"];
		expect(await admitBatch(request, deps)).toBeUndefined();
		delete agent.social!.denied;
		agent.social!.defaults!.group!.quiet = { timezone: "UTC", start: "00:00", end: "23:59" };
		expect(await admitBatch(request, deps)).toBeUndefined();
		delete agent.social!.defaults!.group!.quiet;
		agent.social!.defaults!.group!.plugin = "alternative";
		agent.profiles.group!.plugins = ["alternative"];
		agent.bindings[0]!.match.type = "alternative.batch-ready";
		request.policyRevision = socialDecision(agent, source, undefined)?.revision ?? "";
		expect(await admitBatch(request, deps, "alternative")).toEqual({ session: "1" });
		expect(await admitBatch(request, deps, "social")).toBeUndefined();
		deps.plugins.delete("alternative");
		expect(await admitBatch(request, deps, "alternative")).toBeUndefined();
		deps.plugins.add("alternative");
		agent.profiles.group!.plugins = [];
		expect(await admitBatch(request, deps, "alternative")).toBeUndefined();
		agent.bindings = [];
		expect(await admitBatch(request, deps, "alternative")).toBeUndefined();
	} finally {
		await db.close();
	}
});

test("participation provider uses exact conversation override before the group default", () => {
	const agent = parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "a",
			name: "A",
			owner: "person:owner",
			defaultProfile: "group",
			profiles: { group: {} },
			bindings: [],
			social: {
				enabled: true,
				defaults: { group: { plugin: "alternative" } },
				conversations: { "conv:test:override": { plugin: "social" } },
			},
		}),
	);
	const source = { id: "1", ts: "now", type: "message.in", conv: "conv:test:ordinary", data: { kind: "group" } };
	expect(participationPlugin(agent, source)).toBe("alternative");
	expect(participationPlugin(agent, { ...source, conv: "conv:test:override" })).toBe("social");
	delete agent.social!.defaults!.group!.plugin;
	expect(participationPlugin(agent, source)).toBe("social");
});
