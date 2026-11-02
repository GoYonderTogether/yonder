import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel, ToolContext, YEvent } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import { createSocial, createSocialSupport } from "./social.js";

test("social inspection separates stored route facts from configured match prediction", async () => {
	const raw = JSON.stringify({
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "default",
		profiles: { default: {} },
		bindings: [
			{ id: "group", match: { channel: "test", kind: "group" }, session: { mode: "persistent", per: "conv" } },
		],
		social: { enabled: true, defaults: { group: { mode: "mention", signals: { botMention: "respond" } } } },
	});
	const agent = parseAgentConfig(raw);
	const input = {
		id: "event-1",
		ts: "2026-11-01T00:00:00.000Z",
		type: "message.in",
		conv: "conv:test:group",
		data: { kind: "group" },
		routes: [{ agent: "main", binding: "group", session: "session-1" }],
	} as const;
	let history = [input];
	const store = {
		events: { query: async () => ({ events: history }) },
		sessions: { get: async () => ({ profile: "default" }) },
		identity: () => ({ account: async () => undefined }),
	} as unknown as Store;
	const inspect = createSocialSupport(
		store,
		new Map([["main", agent]]),
		new Map([
			[
				"test",
				{ id: "test", kinds: ["dm", "group"], output: { stream: false, attachments: false } } as unknown as Channel,
			],
		]),
	);
	const policy = agent.social?.defaults?.group;
	if (!policy) throw new Error("Expected group policy");
	const result = await inspect.inspectRoute("main", "conv:test:group", undefined, policy);
	expect(result.detail).toContain("stored route: agent=main, binding=group, session=session-1, profile=default");
	expect(result.detail).toContain(
		"prediction (configured matching against this sample, not a future event): configured binding=group",
	);
	expect(result.capabilityGaps).toEqual([
		"unknown: channel capabilities for test are not declared",
		"unknown: effective participation policy is not recorded for the sample event",
		"unknown: inbound bot mention capability for test is not declared",
	]);
	expect(result.policySource).toContain("configured merge only");
	history = [];
	const empty = await inspect.inspectRoute("main", "conv:test:group", undefined, policy);
	expect(empty.detail).toContain("history: unknown (no message.in");
	expect(empty.detail).toContain("prediction: unknown (no sample event)");
});

test("social support verifies direct owner and continuation sources and rejects visitors or mixed inputs", async () => {
	const conv = "conv:test:owner";
	const route = { agent: "main", binding: "owner", session: "session-1" };
	const message = (id: string, from: string): YEvent => ({
		id,
		ts: "2026-11-01T00:00:00.000Z",
		type: "message.in",
		from,
		conv,
		data: { kind: "dm" },
		routes: [route],
	});
	const owner = message("owner", "acct:test:owner");
	const visitor = message("visitor", "acct:test:visitor");
	const continuation: YEvent = {
		id: "continuation",
		ts: "2026-11-01T00:01:00.000Z",
		type: "runtime.continuation",
		parent: owner.id,
		conv,
		data: { session: "session-1" },
		routes: [route],
	};
	const events = new Map([owner, visitor, continuation].map((event) => [event.id, event]));
	const store = {
		events: { get: async (id: string) => events.get(id) },
		sessions: { get: async () => ({ id: "session-1", agent: "main" }) },
		identity: () => ({
			relation: async (_agent: string, account: string) => (account === owner.from ? "owner" : "stranger"),
		}),
	} as unknown as Store;
	const support = createSocialSupport(store, new Map(), new Map());
	const ctx = (event: YEvent, inputs: YEvent[] = [event]) =>
		({ agent: "main", session: "session-1", event, events: inputs }) as ToolContext;
	expect(await support.ownerInput("main", ctx(owner))).toBe(true);
	expect(await support.ownerInput("main", ctx(visitor))).toBe(false);
	expect(await support.ownerInput("main", ctx(owner, [owner, visitor]))).toBe(false);
	expect(await support.ownerInput("main", ctx(continuation))).toBe(true);
});

test("verified owner requests preview or apply directly and preserve revision conflicts", async () => {
	const home = await tempHome("yonder-social-policy-");
	try {
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: {
				enabled: true,
				authorized: { conversations: ["conv:test:group"] },
				defaults: { group: { mode: "batch" } },
			},
		});
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const events: Array<{ data: object }> = [];
		const ownerInputs = new Set(["one", "continued"]);
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			ownerInput: async (_agent, caller) => {
				const inputs = [...(caller.events ?? []), ...(caller.event ? [caller.event] : [])];
				return inputs.length > 0 && inputs.every((event) => ownerInputs.has(event.id));
			},
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				events.push(event);
			},
			validate: async () => {},
			reload: async () => {
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
		});
		const ownerEvent = {
			id: "one",
			ts: "2026-11-01T00:00:00.000Z",
			type: "message.in",
			from: "acct:console:owner",
			conv: "conv:console:main",
			data: { kind: "dm", text: "change group" },
		} as YEvent;
		const ctx = {
			agent: "main",
			session: "s",
			profile: "default",
			capabilities: ["read", "admin"],
			channelInstances: ["test"],
			event: ownerEvent,
		} as unknown as ToolContext;
		const initial = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const request = {
			agent: "main",
			conv: "conv:test:group",
			expectedRevision: initial.revision,
			patch: {
				mode: "mention" as const,
				triggers: { regex: ["^设计|界面$"], exclude: ["广告"], minLength: 2, maxLength: 2048 },
			},
			reason: "owner request",
		};
		const preview = await service.update(request, ctx);
		expect(preview.before.mode).toBe("batch");
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]).toBeUndefined();
		const visitor = {
			...ctx,
			event: { ...ownerEvent, id: "visitor", from: "acct:test:visitor" },
		};
		await expect(service.update({ ...request, dryRun: false }, visitor)).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			service.update({ ...request, dryRun: false }, { ...ctx, events: [ownerEvent, visitor.event] }),
		).rejects.toMatchObject({ code: "forbidden" });
		// Trusted continuation source resolution is injected from the kernel's durable event ledger.
		const continuation = { ...ctx, event: { ...ownerEvent, id: "continued", type: "runtime.continuation" } };
		await service.update({ ...request, dryRun: false }, continuation);
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.mode).toBe("mention");
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.triggers).toEqual(
			request.patch.triggers,
		);
		expect(events.map((e) => (e.data as { result: string }).result)).toEqual(["rejected", "rejected", "applied"]);
		await expect(service.update({ ...request, dryRun: false }, ctx)).rejects.toMatchObject({ code: "conflict" });
		await service.auditDenied(
			{ id: "gateway:remote", kind: "remote", transport: "gateway", scopes: ["read"] },
			{ conv: "conv:test:group", reason: "secret" },
			"forbidden",
		);
		expect(events.at(-1)?.data).toEqual({
			actor: "gateway:remote",
			before: {},
			after: {},
			reason: "forbidden",
			revision: "unknown",
			result: "rejected",
		});
		const saved = await readFile(file, "utf8");
		const current = await service.inspect({ agent: "main", conv: request.conv }, ctx);
		for (const triggers of [{ regex: ["["] }, { regex: ["(a+"] }, { minLength: 20, maxLength: 10 }]) {
			for (const dryRun of [true, false]) {
				await expect(
					service.update({ ...request, expectedRevision: current.revision, patch: { triggers }, dryRun }, ctx),
				).rejects.toMatchObject({ code: "invalid_params" });
				expect(await readFile(file, "utf8")).toBe(saved);
				expect((await service.inspect({ agent: "main", conv: request.conv }, ctx)).revision).toBe(current.revision);
			}
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("bot gate injects a low-weight hint only after bot chatter crosses the window threshold", async () => {
	const home = await tempHome("yonder-social-gate-");
	try {
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: { enabled: true, authorized: { conversations: ["conv:test:group"] } },
		});
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const recorded: Array<{ type: string; conv?: string; data: object }> = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				recorded.push(event);
			},
			validate: async () => {},
			reload: async () => {},
		});
		const now = Date.parse("2026-10-29T12:00:00.000Z");
		const minutesAgo = (minutes: number) => now - minutes * 60_000;
		const bots = (minutes: number[]) => minutes.map((minute) => ({ at: minutesAgo(minute), bot: true }));
		// 一个 15 分钟窗口里 3 条机器人消息正好等于阈值，不触发也不记账。
		const quiet = await service.botGate({ agent: "main", conv: "conv:test:group", events: bots([13, 7, 1]), now });
		expect(quiet).toEqual({ inject: false, frequencies: [0, 0, 0] });
		expect(recorded).toHaveLength(0);
		// 第 4 条触发：附前 3 个窗口的频率，记一条低权重的结构化事件供下一回合使用。
		const gated = await service.botGate({
			agent: "main",
			conv: "conv:test:group",
			events: bots([44, 31, 13, 12, 7, 1]),
			now,
		});
		expect(gated).toEqual({
			inject: true,
			frequencies: [0, 2, 0],
			hint: { windowMin: 15, threshold: 3, count: 4, frequencies: [0, 2, 0] },
		});
		expect(recorded.at(-1)).toMatchObject({
			type: "social.bot-gate",
			conv: "conv:test:group",
			data: { agent: "main", source: "bot", weight: "low", count: 4 },
		});
		// 真人的消息不计入机器人频率。
		const humans = [13, 7, 1].map((minute) => ({ at: minutesAgo(minute), bot: false }));
		expect(
			await service.botGate({ agent: "main", conv: "conv:test:group", events: [...bots([13, 7]), ...humans], now }),
		).toMatchObject({ inject: false });
		await expect(service.botGate({ agent: "ghost", conv: "conv:test:group", events: [], now })).rejects.toThrow(
			"Unknown agent",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
