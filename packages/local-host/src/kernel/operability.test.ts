import { projectAgentOperability } from "@yonder/bot-core/kernel/agent-operability";
import { projectConversationOperability } from "@yonder/bot-core/kernel/operability";
import { platformGroupBinding } from "@yonder/bot-core/routing/platform-group.js";
import { socialPluginHooks } from "@yonder/local-host/kernel/social-plugin.test-support";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db.js";
import type { Channel } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { agentOperabilityProjector, ownerAgentOperabilityProjector } from "./operability-adapters.js";
import { batchPreflightData } from "./social-preflight.js";

test("inspect projects bounded exact-conversation facts and follows QQ batch source edges", async () => {
	const conv = "conv:qq:group:target";
	const outside = "conv:feishu:group:private";
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().link("acct:qq:user", "person:owner");
		await store.identity().link("acct:feishu:user", "person:owner");
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
			{
				type: "message.in",
				from: "acct:qq:user",
				conv,
				data: {
					kind: "group",
					text: "QQ private body",
					mentioned: false,
					social: { mentions: { bot: false, owner: true, everyone: false }, nativeKind: "GROUP_MESSAGE_CREATE" },
				},
			},
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
			sample: {
				eventId: qq.id,
				kind: "group",
				from: "acct:qq:user",
				relation: "owner",
				mentioned: false,
				nativeKind: "GROUP_MESSAGE_CREATE",
				mentions: { bot: false, owner: true, everyone: false },
			},
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
			sample: { eventId: feishu.id, kind: "group", relation: "owner" },
			history: { route: { binding: "feishu-source", wake: "write" }, execution: { state: "not-observed" } },
			prediction: {
				binding: "feishu-source",
				wake: "write",
				participationScope: { includesConversation: false },
				consumer: { state: "not-applicable", reason: "outside-social-scope" },
			},
		});
		expect(feishuFact?.sample).not.toHaveProperty("senderIsBot");
		expect(JSON.stringify(report)).not.toContain("private body");
		const described: Array<{ conv: string; signal?: AbortSignal }> = [];
		const labeledChannel: Channel = {
			...channel,
			async describeConversation(target, signal) {
				described.push({ conv: target, ...(signal ? { signal } : {}) });
				return { displayName: "Exact platform group", kind: "group", basis: "platform-exact" };
			},
		};
		const projectorOptions = {
			agents,
			store,
			loaded: { channels: new Map([["qq", labeledChannel]]), hooks },
			configStatus: async () => ({ agent: { state: "accepted", revision: "rev-1", acceptedRevision: "rev-1" } }),
		};
		const signal = new AbortController().signal;
		const ownerReport = await ownerAgentOperabilityProjector(projectorOptions)(agent.id, signal);
		expect(ownerReport.conversations.find((item) => item.selector.conv === conv)?.conversationLabel).toEqual({
			status: "observed",
			displayName: "Exact platform group",
			kind: "group",
			basis: "platform-exact",
		});
		expect(described).toEqual([{ conv, signal }]);
		await agentOperabilityProjector(projectorOptions)(agent.id);
		expect(described).toHaveLength(1);
		const mismatchedChannel: Channel = {
			...channel,
			async describeConversation() {
				return { displayName: "Unexpected direct chat", kind: "dm", basis: "platform-exact" };
			},
		};
		const mismatchedReport = await ownerAgentOperabilityProjector({
			...projectorOptions,
			loaded: { channels: new Map([["qq", mismatchedChannel]]), hooks },
		})(agent.id, signal);
		expect(mismatchedReport.conversations.find((item) => item.selector.conv === conv)?.conversationLabel).toEqual({
			status: "unknown",
			reason: "platform kind does not match observed conversation kind",
		});
		const unsupportedReport = await ownerAgentOperabilityProjector({
			...projectorOptions,
			loaded: { channels: new Map([["qq", channel]]), hooks },
		})(agent.id, signal);
		expect(unsupportedReport.conversations.find((item) => item.selector.conv === conv)?.conversationLabel).toEqual({
			status: "unknown",
			reason: "platform description unsupported",
		});
		const qqOutsideScopeAgent = parseAgentConfig(
			JSON.stringify({
				...agent,
				social: { ...agent.social, scope: [outside] },
				bindings: agent.bindings.map((binding) =>
					binding.id === "qq-source"
						? { ...binding, match: { ...binding.match, channel: "qq", kind: "group" } }
						: binding,
				),
			}),
		);
		const qqOutsideScope = await projectConversationOperability({
			agent: qqOutsideScopeAgent,
			agents: [qqOutsideScopeAgent, foreign],
			selector: { conv, eventId: qq.id },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
			batchRequested: true,
		});
		expect(qqOutsideScope.prediction).toMatchObject({
			participation: { reason: "batch" },
			participationScope: { includesConversation: false },
			consumer: { state: "available" },
		});
		await expect(
			batchPreflightData("main", conv, { mode: "batch", batch: { run: true } }, qqOutsideScopeAgent, async () => ({
				operability: qqOutsideScope,
			})),
		).resolves.toMatchObject({ state: "ready" });
		const qqMention = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:user",
				conv,
				data: {
					kind: "group",
					mentioned: true,
					social: { mentions: { bot: true }, nativeKind: "GROUP_MESSAGE_CREATE" },
				},
			},
			[{ agent: "main", binding: "qq-source", session: "101", wake: "write" }],
		);
		const qqMentionAgent = parseAgentConfig(
			JSON.stringify({
				...qqOutsideScopeAgent,
				social: {
					...qqOutsideScopeAgent.social,
					defaults: { group: { ...qqOutsideScopeAgent.social?.defaults?.group, signals: { botMention: "respond" } } },
				},
			}),
		);
		const qqMentionFact = await projectConversationOperability({
			agent: qqMentionAgent,
			agents: [qqMentionAgent, foreign],
			selector: { conv, eventId: qqMention.id },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
			batchRequested: true,
		});
		expect(qqMentionFact.prediction).toMatchObject({
			participation: { reason: "bot-mention", run: true },
			participationScope: { includesConversation: false },
			consumer: { state: "available" },
		});
		await expect(
			batchPreflightData("main", conv, { mode: "batch", batch: { run: true } }, qqMentionAgent, async () => ({
				operability: qqMentionFact,
			})),
		).resolves.toMatchObject({ state: "ready" });
		const memberConv = "conv:membership:group:private";
		const memberChannel: Channel = {
			...channel,
			id: "membership",
			multiAgent: true,
			features: { groupParticipation: "membership" },
		};
		const memberDiskAgent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "default",
				profiles: { default: {} },
				bindings: [],
				social: {
					enabled: true,
					scope: [outside],
					defaults: { group: { mode: "batch", batch: { run: true } } },
					conversations: { [memberConv]: { mode: "batch", batch: { run: true } } },
				},
			}),
		);
		const memberRuntimeAgent = parseAgentConfig(JSON.stringify(memberDiskAgent));
		platformGroupBinding(memberRuntimeAgent, memberChannel);
		const memberMessage = await store.events.record({
			type: "message.in",
			from: "acct:qq:user",
			conv: memberConv,
			data: { kind: "group", target: "main", mentioned: false },
		});
		const memberCandidate = {
			...memberDiskAgent,
			profiles: { ...memberRuntimeAgent.profiles, ...memberDiskAgent.profiles },
			bindings: memberRuntimeAgent.bindings,
		};
		const memberFact = await projectConversationOperability({
			agent: memberCandidate,
			agents: [memberCandidate],
			selector: { conv: memberConv, eventId: memberMessage.id },
			store,
			channels: new Map([["membership", memberChannel]]),
			hooks,
			batchRequested: true,
		});
		expect(memberDiskAgent.bindings).toHaveLength(0);
		expect(memberDiskAgent.profiles).not.toHaveProperty("@platform-group:membership");
		expect(memberFact.prediction).toMatchObject({
			participation: { reason: "batch" },
			participationScope: { includesConversation: false },
			consumer: { state: "available", derived: true },
		});
		await expect(
			batchPreflightData("main", memberConv, { mode: "batch", batch: { run: true } }, memberCandidate, async () => ({
				operability: memberFact,
			})),
		).resolves.toMatchObject({ state: "ready" });
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
		const botEcho = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:bot",
				conv,
				data: {
					kind: "group",
					senderIsBot: true,
					mentioned: false,
					social: { mentions: { bot: false }, nativeKind: "GROUP_MESSAGE_CREATE" },
				},
			},
			[{ agent: "main", binding: "qq-source", session: "101", wake: "write" }],
		);
		const botFact = await projectConversationOperability({
			agent,
			agents: agents.values(),
			selector: { conv, eventId: botEcho.id },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		expect(botFact).toMatchObject({
			sample: {
				eventId: botEcho.id,
				from: "acct:qq:bot",
				relation: "stranger",
				senderIsBot: true,
				nativeKind: "GROUP_MESSAGE_CREATE",
			},
			prediction: { route: "dropped", participation: { reason: "record", run: false } },
		});
		expect(botFact.history?.execution.state).toBe("not-observed");
		const latestBotFact = await projectConversationOperability({
			agent,
			agents: agents.values(),
			selector: { conv },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		expect(latestBotFact.sample).toMatchObject({ eventId: botEcho.id, senderIsBot: true });

		const noBindingConv = "conv:qq:group:no-binding";
		const ownerNoBinding = await store.events.record({
			type: "message.in",
			from: "acct:qq:user",
			conv: noBindingConv,
			data: { kind: "group", text: "owner input" },
		});
		const noBindingFact = await projectConversationOperability({
			agent,
			agents: agents.values(),
			selector: { conv: noBindingConv, eventId: ownerNoBinding.id },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		expect(noBindingFact).toMatchObject({
			sample: { eventId: ownerNoBinding.id, relation: "owner" },
			prediction: { state: "no-match" },
			history: { execution: { state: "not-observed" }, delivery: { state: "not-observed" } },
		});
		expect(noBindingFact.sample).not.toHaveProperty("relation", "unknown");
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

		for (let index = 0; index < 1001; index++)
			await store.events.record(
				{
					type: "message.in",
					from: "acct:qq:owner",
					conv,
					data: { kind: "group", text: `recent message ${index}` },
				},
				[{ agent: "main", binding: "qq-source", session: "101", wake: "write" }],
			);
		const latest = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:owner",
				conv,
				data: { kind: "group", text: "latest message" },
			},
			[{ agent: "main", binding: "qq-source", session: "101", wake: "write" }],
		);
		const latestFact = await projectConversationOperability({
			agent,
			agents: agents.values(),
			selector: { conv },
			store,
			channels: new Map([["qq", channel]]),
			hooks,
		});
		expect(latestFact).toMatchObject({ status: "observed", sample: { eventId: latest.id, kind: "group" } });
	} finally {
		await db.close();
	}
});
