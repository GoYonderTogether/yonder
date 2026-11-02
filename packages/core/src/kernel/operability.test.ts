import type { Channel } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { projectAgentOperability, projectConversationOperability } from "./operability.js";
import { socialPluginHooks } from "./social-plugin.test-support.js";

test("inspect projects bounded exact-conversation facts and follows QQ batch source edges", async () => {
	const conv = "conv:qq:group:target";
	const outside = "conv:feishu:group:private";
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const hooks = await socialPluginHooks();
		const channel: Channel = {
			id: "qq",
			kinds: ["group"],
			output: { stream: false, attachments: false },
			async start() {},
			async stop() {},
			async send() {
				return { ok: true };
			},
		};
		const agent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: {
					group: { plugins: ["social"], capabilities: ["read", "message"], tools: { offer: ["message_*"] } },
				},
				social: {
					enabled: true,
					scope: [conv],
					authorized: { conversations: [conv] },
					defaults: { group: { mode: "batch", batch: { run: true } } },
				},
				bindings: [
					{
						id: "qq-batch",
						match: { type: "social.batch-ready", channel: "qq", conv },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "run",
						reply: "none",
					},
					{
						id: "qq-source",
						match: { conv },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "write",
						reply: "none",
					},
					{
						id: "feishu-source",
						match: { conv: outside },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "write",
						reply: "none",
					},
				],
			}),
		);
		const foreign = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "other",
				name: "Other",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: { group: { plugins: ["social"] } },
				bindings: [
					{
						id: "qq-batch",
						match: { type: "social.batch-ready", channel: "qq", conv },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "run",
						reply: "none",
					},
				],
			}),
		);
		await store.sessions.put({
			id: "101",
			agent: "main",
			profile: "group",
			mode: "persistent",
			key: `conv:${conv}`,
			version: "1",
			opened: "now",
		});
		await store.sessions.put({
			id: "102",
			agent: "main",
			profile: "group",
			mode: "persistent",
			key: `conv:${outside}`,
			version: "1",
			opened: "now",
		});
		await store.sessions.put({
			id: "103",
			agent: "other",
			profile: "group",
			mode: "persistent",
			key: `conv:${conv}`,
			version: "1",
			opened: "now",
		});
		const qq = await store.events.record(
			{ type: "message.in", from: "acct:qq:user", conv, data: { kind: "group", text: "QQ private body" } },
			[{ agent: "main", binding: "qq-source", session: "101", wake: "write" }],
		);
		const feishu = await store.events.record(
			{
				type: "message.in",
				from: "acct:feishu:user",
				conv: outside,
				data: { kind: "group", text: "Feishu private body" },
			},
			[{ agent: "main", binding: "feishu-source", session: "102", wake: "write" }],
		);
		await store.events.record({
			type: "routing.social-decision",
			parent: qq.id,
			data: {
				agent: "main",
				reason: "batch",
				plugin: "social",
				revision: "policy-1",
				policy: { mode: "batch", batch: { run: true } },
			},
		});
		const batch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "main", through: qq.id, sourceEvents: [qq.id] },
			},
			[{ agent: "main", binding: "qq-batch", session: "101", wake: "run" }],
		);
		const foreignBatch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "other", through: qq.id, sourceEvents: [qq.id] },
			},
			[{ agent: "other", binding: "qq-batch", session: "103", wake: "run" }],
		);
		await store.events.record({
			type: "run.end",
			parent: batch.id,
			conv,
			data: { session: "101", runId: "qq-run", status: "done", inputs: [batch.id] },
		});
		await store.events.record({
			type: "run.end",
			parent: foreignBatch.id,
			conv,
			data: { session: "103", runId: "other-run", status: "done", inputs: [foreignBatch.id] },
		});
		await store.events.record({
			type: "message.out",
			parent: batch.id,
			conv,
			data: { session: "101", to: conv, delivery: { ok: true } },
		});
		await store.events.record({
			type: "message.out",
			parent: foreignBatch.id,
			conv,
			data: { session: "103", to: conv, delivery: { ok: true } },
		});

		const agents = new Map([
			[agent.id, agent],
			[foreign.id, foreign],
		]);
		const report = await projectAgentOperability({
			agent,
			agents: agents.values(),
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		const qqFact = report.conversations.find((item) => item.selector.conv === conv);
		const feishuFact = report.conversations.find((item) => item.selector.conv === outside);
		expect(report).toMatchObject({ status: "observed", truncated: false });
		expect(qqFact).toMatchObject({
			sample: { eventId: qq.id, kind: "group" },
			history: {
				route: { binding: "qq-source", session: "101", profile: "group", wake: "write" },
				participation: { reason: "batch", plugin: "social" },
				execution: { state: "batch", runs: [{ runId: "qq-run", path: "batch" }] },
				delivery: { state: "delivered", receipts: [{ session: "101" }] },
			},
			prediction: {
				binding: "qq-source",
				wake: "write",
				participation: { reason: "batch", run: false },
				participationScope: { includesConversation: true, defaults: { mode: "batch", batch: { run: true } } },
				consumer: { state: "available", binding: "qq-batch" },
				capabilities: { messageSend: true },
			},
		});
		expect(feishuFact).toMatchObject({
			sample: { eventId: feishu.id, kind: "group" },
			history: { route: { binding: "feishu-source", wake: "write" }, execution: { state: "not-observed" } },
			prediction: { binding: "feishu-source", wake: "write", participationScope: { includesConversation: false } },
		});
		expect(JSON.stringify(report)).not.toContain("private body");
		const recordAgent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: { group: { plugins: ["social"] } },
				social: { enabled: true, defaults: { group: { mode: "record" } } },
				bindings: [
					{
						id: "qq-source",
						match: { conv },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						wake: "write",
					},
				],
			}),
		);
		const recordFact = await projectConversationOperability({
			agent: recordAgent,
			agents: [recordAgent],
			selector: { conv, eventId: qq.id },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		expect(recordFact.prediction).toMatchObject({ route: "dropped", dropReason: "no-binding" });
		expect(recordFact.prediction?.participationScope?.includesConversation).toBe(true);
		expect(recordFact.prediction).not.toHaveProperty("wake");
		expect(
			await projectConversationOperability({
				agent,
				agents: agents.values(),
				selector: { conv, eventId: feishu.id },
				store,
				channels: new Map([["qq", channel]]),
				hooks,
			}),
		).toMatchObject({ status: "unknown", reason: "event is not a stored message.in for the selected conversation" });
	} finally {
		await db.close();
	}
});
