import type { Channel } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { socialPluginHooks } from "../kernel/social-plugin.test-support.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { admitBatch } from "./admit-batch.js";
import { participationPlugin } from "./participation.js";
import { socialRevision } from "./social.js";

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
		const revision = socialRevision(agent.social!);
		const request = {
			agent: "a",
			conv: "conv:test:g",
			through: source.id,
			sourceEvents: [source.id],
			policyRevision: revision,
		};
		// 真实加载官方 social 插件；批次用到的自定义参与插件按同一接口注册。
		const loaded = await socialPluginHooks();
		const hooks = new Map(loaded);
		const alternative = loaded.get("social")!;
		hooks.set(
			"alternative",
			alternative.map((hook) => ({ ...hook, id: `alternative.${hook.id}` })),
		);
		const deps = {
			agents: new Map([["a", agent]]),
			store,
			plugins: new Set(["social", "alternative"]),
			participationHooks: hooks,
		};
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
		request.policyRevision = socialRevision(agent.social!);
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

test("official QQ groups derive a missing social batch binding only with the selected loaded plugin", async () => {
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
				social: { enabled: true },
				bindings: [
					{
						id: "qq-group",
						match: { channel: "qq-main", kind: "group" },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "write",
						reply: "none",
					},
				],
			}),
		);
		const conv = "conv:qq-main:group:g";
		await store.sessions.put({
			id: "1",
			agent: "a",
			profile: "group",
			mode: "persistent",
			key: `conv:${conv}`,
			version: "1",
			opened: "now",
		});
		const source = await store.events.record(
			{ type: "message.in", from: "acct:qq-main:u", conv, data: { kind: "group", text: "hello" } },
			[{ agent: "a", binding: "qq-group", session: "1", wake: "write" }],
		);
		const request = {
			agent: "a",
			conv,
			through: source.id,
			sourceEvents: [source.id],
			policyRevision: socialRevision(agent.social!),
		};
		const deps = {
			agents: new Map([["a", agent]]),
			store,
			channels: new Map([["qq-main", { id: "qq-main", kinds: ["dm", "group"] } as Channel]]),
			plugins: new Set(["social"]),
			participationHooks: await socialPluginHooks(),
		};
		expect(await admitBatch(request, deps)).toEqual({ session: "1" });
		deps.plugins.clear();
		expect(await admitBatch(request, deps)).toBeUndefined();
		deps.plugins.add("social");
		agent.profiles.group!.plugins = [];
		expect(await admitBatch(request, deps)).toBeUndefined();
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
