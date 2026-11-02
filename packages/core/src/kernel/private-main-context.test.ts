import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { conversationPromptOptions } from "./conversation.js";
import type { AgentOperabilityFact } from "./operability.js";

const agent = (id: string, name: string) =>
	parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id,
			name,
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
		}),
		"agent.yaml",
		id,
	);

test("private main context is per-agent, same-origin, owner-only, and keeps operability separate", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().link("acct:feishu:owner", "person:owner");
		const agents = new Map([
			["luna", agent("luna", "Luna")],
			["senpai", agent("senpai", "Senpai")],
		]);
		const fact = (id: string): AgentOperabilityFact => ({
			status: "observed",
			limit: 20,
			truncated: false,
			conversations: [
				{
					status: "observed",
					selector: { conv: `conv:qq:${id}` },
					sample: { eventId: `sample-${id}`, conv: `conv:qq:${id}` },
				},
			],
		});
		const project = async (id: string) => fact(id);
		const options = conversationPromptOptions(
			store,
			agents,
			() => {
				throw new Error("runtime not needed");
			},
			undefined,
			project,
		);
		const contextFor = async (event: import("@yonder/sdk").YEvent, agentId: string) => {
			if (!options.conversationContext) throw new Error("conversation context is unavailable");
			return options.conversationContext(event, agentId);
		};

		for (const [id, profile] of [
			["luna", "default"],
			["senpai", "owner"],
		] as const) {
			const sessionId = id === "luna" ? "101" : "102";
			await store.sessions.put({
				id: sessionId,
				agent: id,
				profile,
				mode: "main",
				key: "main",
				version: "test",
				opened: new Date().toISOString(),
			});
			const route = [
				{
					agent: id,
					binding: "owner",
					session: sessionId,
					wake: "run" as const,
					busy: "steer" as const,
					waiting: false,
				},
			];
			const conv = `conv:feishu:${id}`;
			const prior = await store.events.record(
				{ type: "message.in", from: "acct:feishu:owner", conv, data: { kind: "dm", text: `${id} private task` } },
				route,
			);
			const longText = "x".repeat(2001);
			const longPrior = await store.events.record(
				{ type: "message.in", from: "acct:feishu:owner", conv, data: { kind: "dm", text: longText } },
				route,
			);
			await store.events.record(
				{
					type: "message.in",
					from: "acct:feishu:owner",
					conv: `conv:qq:${id}`,
					data: { kind: "dm", text: "other channel; exclude" },
				},
				route,
			);
			await store.events.record(
				{
					type: "message.in",
					from: "acct:feishu:owner",
					conv,
					data: { kind: "dm", text: "other agent session; exclude" },
				},
				[
					{
						agent: id,
						binding: "owner",
						session: id === "luna" ? "102" : "101",
						wake: "run",
						busy: "steer",
						waiting: false,
					},
				],
			);
			const current = await store.events.record(
				{ type: "message.in", from: "acct:feishu:owner", conv, data: { kind: "dm", text: "current request" } },
				route,
			);
			const serialized = await contextFor(current, id);
			if (!serialized) throw new Error("owner private context was not produced");
			const value = JSON.parse(serialized);
			expect(value.scope).toBe("owner-private-main");
			expect(value.identity).toMatchObject({
				agent: id,
				profile,
				identityBasis: "agent-id",
				profileChangesIdentity: false,
				historyScope: "session",
			});
			expect(value.history.items).toEqual([
				{
					id: prior.id,
					at: prior.ts,
					text: `${id} private task`,
					textOmitted: false,
					textLength: `${id} private task`.length,
				},
				{ id: longPrior.id, at: longPrior.ts, textOmitted: true, textLength: longText.length },
			]);
			expect(value.history.truncated).toBe(true);
			expect(value.historyContextOnly).toBe(true);
			expect(value.groupContextMerged).toBe(false);
			expect(value.expandsOwnerPermissions).toBe(false);
			expect(value.operability.conversations[0].selector.conv).toBe(`conv:qq:${id}`);
		}
	} finally {
		await db.close();
	}
});

test("visitors, group messages, non-main sessions, and missing projection do not gain private context", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().link("acct:feishu:owner", "person:owner");
		const agents = new Map([["helper", agent("helper", "Helper")]]);
		const options = conversationPromptOptions(store, agents, () => {
			throw new Error("runtime not needed");
		});
		const contextFor = async (event: import("@yonder/sdk").YEvent, agentId: string) => {
			if (!options.conversationContext) throw new Error("conversation context is unavailable");
			return options.conversationContext(event, agentId);
		};
		const owner = await store.events.record(
			{
				type: "message.in",
				from: "acct:feishu:owner",
				conv: "conv:feishu:private",
				data: { kind: "dm", text: "request" },
			},
			[{ agent: "helper", binding: "owner", session: "1", wake: "run", busy: "steer", waiting: false }],
		);
		await store.sessions.put({
			id: "1",
			agent: "helper",
			profile: "default",
			mode: "main",
			key: "main",
			version: "test",
			opened: new Date().toISOString(),
		});
		expect(await contextFor(owner, "helper")).toBeDefined();
		const visitor = { ...owner, id: "visitor", from: "acct:feishu:visitor" };
		expect(await contextFor(visitor, "helper")).toBeUndefined();
		const group = { ...owner, id: "group", conv: "conv:feishu:group", data: { kind: "group", text: "public" } };
		const groupContext = await contextFor(group, "helper");
		expect(groupContext).toBeDefined();
		expect(groupContext).not.toContain("owner-private-main");
		expect(groupContext).not.toContain('"current request"');
		if (!groupContext) throw new Error("group context was not produced");
		expect(JSON.parse(groupContext).self).toMatchObject({
			agent: "helper",
			identityBasis: "agent-id",
			profileChangesIdentity: false,
			historyScope: "session",
		});
		const parent = await store.events.record({
			type: "message.in",
			from: "acct:agent:helper",
			conv: "conv:agent:helper",
			data: { kind: "parent-request", target: "helper", text: "delegated request" },
		});
		const parentContext = await contextFor(parent, "helper");
		if (!parentContext) throw new Error("parent context was not produced");
		expect(JSON.parse(parentContext).self).toMatchObject({
			agent: "helper",
			identityBasis: "agent-id",
			profileChangesIdentity: false,
			historyScope: "session",
		});
		const nonMain = await store.events.record(
			{
				type: "message.in",
				from: "acct:feishu:owner",
				conv: "conv:feishu:persistent",
				data: { kind: "dm", text: "request" },
			},
			[{ agent: "helper", binding: "owner", session: "2", wake: "run", busy: "steer", waiting: false }],
		);
		await store.sessions.put({
			id: "2",
			agent: "helper",
			profile: "default",
			mode: "persistent",
			key: "conv:feishu:persistent",
			version: "test",
			opened: new Date().toISOString(),
		});
		expect(await contextFor(nonMain, "helper")).toBeUndefined();
		const unavailable = conversationPromptOptions(
			store,
			agents,
			() => {
				throw new Error("runtime not needed");
			},
			undefined,
			async () => {
				throw new Error("projection unavailable");
			},
		);
		if (!unavailable.conversationContext) throw new Error("conversation context is unavailable");
		const serialized = await unavailable.conversationContext(owner, "helper");
		if (!serialized) throw new Error("owner context was not produced");
		const context = JSON.parse(serialized);
		expect(context.operability.status).toBe("unknown");
	} finally {
		await db.close();
	}
});
