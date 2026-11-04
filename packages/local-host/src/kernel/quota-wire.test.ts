import type { DeliveryService } from "@yonder/bot-core/delivery/index";
import { quotaWire } from "@yonder/bot-core/kernel/quota-wire";
import type { createSessions } from "@yonder/bot-core/sessions/index";
import type { YonderConfig } from "@yonder/local-host/config/index";
import { testModel } from "@yonder/local-host/config/test-support";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import type { RuntimeRun } from "@yonder/runtime-adapter/node/runtime/index";
import type { SessionInfo, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";

const skills = async () => ({ skills: [], issues: [], index: "", estimatedTokens: 0 });
const run = (inputs: string[], tokens: number): RuntimeRun & { runId: string } => ({
	runId: `run:${inputs[0]}`,
	status: "done",
	text: "",
	usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	inputs,
});

async function setup(overrides: Partial<YonderConfig> = {}) {
	const db = await openDatabase(":memory:");
	const store = await createStore(db, () => "person:owner");
	const session: SessionInfo = {
		id: "1",
		agent: "main",
		profile: "guest",
		mode: "persistent",
		key: "conv:feishu:thread",
		version: "0.1.0",
		opened: new Date().toISOString(),
	};
	await store.sessions.put(session);
	const sends: string[] = [];
	const delivery = {
		async sendCommand(_session: SessionInfo, _event: YEvent, text: string) {
			sends.push(text);
			return { ok: true };
		},
	} as DeliveryService;
	const config = {
		schema: 1,
		defaultModel: testModel,
		agents: [{ id: "main", workspace: "." }],
		...overrides,
	} satisfies YonderConfig;
	const wire = quotaWire({
		config,
		store,
		sessions: {} as ReturnType<typeof createSessions>,
		delivery,
		skills,
	});
	return { db, store, session, sends, wire };
}

async function settle(ctx: Awaited<ReturnType<typeof setup>>, result: RuntimeRun & { runId: string }) {
	await ctx.wire.settle(ctx.session.id, result, {
		type: "run.end",
		data: { session: ctx.session.id, runId: result.runId, usage: result.usage, inputs: result.inputs },
	});
}

function inbound(from: string, msgId: string): YEvent {
	return {
		id: `e-${msgId}`,
		ts: new Date().toISOString(),
		type: "message.in",
		from,
		conv: "conv:feishu:thread",
		data: { text: "你好", msgId },
	};
}

async function conversationContextFor(store: Awaited<ReturnType<typeof setup>>["store"], event: YEvent) {
	const { conversationPromptOptions } = await import("./conversation.js");
	const project = conversationPromptOptions(store, new Map(), () => {
		throw Error("No runtime needed");
	}).conversationContext;
	if (!project) throw new Error("Conversation context projector is unavailable");
	return project(event, "main");
}

test("访客第 4 轮被拒并发登录提示，同时留下结构化拒绝事件", async () => {
	const ctx = await setup();
	try {
		for (const msgId of ["g1", "g2", "g3"]) {
			expect(await ctx.wire.command(ctx.session, inbound("acct:feishu:guest", msgId))).toBeUndefined();
		}
		const rejected = await ctx.wire.command(ctx.session, inbound("acct:feishu:guest", "g4"));
		expect(rejected).toMatchObject({ status: "error", reason: "guest_rounds" });
		expect(rejected?.text).toContain("登录");
		expect(ctx.sends).toEqual([rejected?.text]);
		const page = await ctx.store.events.query({ type: "outsider.rejected" });
		expect(page.events).toHaveLength(1);
		const data = page.events[0]!.data as { reason: string; tier: string; login: string };
		expect(data).toMatchObject({ reason: "guest_rounds", tier: "guest", login: "/connect" });
	} finally {
		await ctx.db.close();
	}
});

test("已绑定账号的外人超出每人每日额度后被拒，主人额度不受影响", async () => {
	const ctx = await setup({ outsiders: { perPersonDailyTokens: 1_000, ownerShareDailyTokens: 2_000 } });
	try {
		await ctx.store.identity().createPerson({ id: "friend", name: "Friend" });
		await ctx.store.identity().link("acct:feishu:friend", "person:friend");
		await ctx.store.identity().createPerson({ id: "owner", name: "Owner" });
		await ctx.store.identity().link("acct:cli:local", "person:owner");
		const first = await ctx.store.events.record(inbound("acct:feishu:friend", "f1"));
		expect(await ctx.wire.command(ctx.session, first)).toBeUndefined();
		await settle(ctx, run([first.id], 1_000));
		const rejected = await ctx.wire.command(ctx.session, inbound("acct:feishu:friend", "f2"));
		expect(rejected?.text).toContain("额度");
		const page = await ctx.store.events.query({ type: "outsider.rejected" });
		expect((page.events[0]!.data as { reason: string }).reason).toBe("person_daily_limit");
		// 主人不受份额与每人额度限制：额度已经用完也照常进入模型。
		const owner = await ctx.store.events.record(inbound("acct:cli:local", "o1"));
		expect(await ctx.wire.command(ctx.session, owner)).toBeUndefined();
		await settle(ctx, run([owner.id], 5_000));
		expect(await ctx.wire.command(ctx.session, inbound("acct:cli:local", "o2"))).toBeUndefined();
		expect(await ctx.store.events.query({ type: "outsider.rejected" })).toMatchObject({ events: [expect.any(Object)] });
	} finally {
		await ctx.db.close();
	}
});

test("未配白名单的渠道按 channelPolicy 决定：open 走访客额度，closed 直接要求登录", async () => {
	const closed = await setup({ defaults: { channelPolicy: "closed" } });
	try {
		const rejected = await closed.wire.command(closed.session, inbound("acct:feishu:guest", "c1"));
		expect(rejected?.text).toContain("登录");
		const page = await closed.store.events.query({ type: "outsider.rejected" });
		expect((page.events[0]!.data as { reason: string }).reason).toBe("channel_closed");
	} finally {
		await closed.db.close();
	}
	const open = await setup({ defaults: { channelPolicy: "open" } });
	try {
		expect(await open.wire.command(open.session, inbound("acct:feishu:guest", "o1"))).toBeUndefined();
		expect(await open.store.events.query({ type: "outsider.rejected" })).toMatchObject({ events: [] });
	} finally {
		await open.db.close();
	}
});

test("记过账的运行不会重复计费", async () => {
	const ctx = await setup({ outsiders: { perPersonDailyTokens: 1_000, ownerShareDailyTokens: 10_000 } });
	try {
		await ctx.store.identity().createPerson({ id: "friend", name: "Friend" });
		await ctx.store.identity().link("acct:feishu:friend", "person:friend");
		const first = await ctx.store.events.record(inbound("acct:feishu:friend", "r1"));
		await settle(ctx, run([first.id], 900));
		await ctx.store.events.recordRun({
			type: "run.end",
			data: {
				session: ctx.session.id,
				runId: `run:${first.id}`,
				inputs: [first.id],
				status: "done",
				replied: "source",
				model: testModel,
				usage: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			},
		});
		await settle(ctx, run([first.id], 900));
		// 900 用量只记一次：重复记账会变成 1800，下一轮就会被每人额度挡住。
		expect(await ctx.wire.command(ctx.session, inbound("acct:feishu:friend", "r2"))).toBeUndefined();
	} finally {
		await ctx.db.close();
	}
});

test("internal plugin task inputs are not parsed as outsider account refs", async () => {
	const ctx = await setup();
	try {
		expect(
			await ctx.wire.command(ctx.session, { ...inbound("plugin:social", "judge"), type: "session.input" }),
		).toBeUndefined();
	} finally {
		await ctx.db.close();
	}
});

async function handoff(ctx: Awaited<ReturnType<typeof setup>>, channel: string, senders: string[]) {
	const group = { ...ctx.session, id: "2", profile: "group", key: `conv:${channel}:group` };
	await ctx.store.sessions.put(group);
	const originals = await Promise.all(
		senders.map((sender, i) =>
			ctx.store.events.record(
				{
					type: "message.in",
					from: `acct:${channel}:${sender}`,
					conv: `conv:${channel}:group`,
					data: { text: `${sender}: original ${i}`, msgId: `${channel}:${sender}:${i}` },
				},
				[{ agent: "main", session: group.id, binding: "group", wake: "write" }],
			),
		),
	);
	const batch = await ctx.store.events.record(
		{
			type: "social.batch-ready",
			from: "plugin:social",
			conv: `conv:${channel}:group`,
			data: { sourceEvents: originals.map((e) => e.id) },
		},
		[{ agent: "main", session: group.id, binding: "batch", wake: "run" }],
	);
	const event = await ctx.store.events.record({
		type: "message.in",
		from: "acct:agent:main",
		conv: "conv:agent:main",
		parent: batch.id,
		data: {
			kind: "parent-request",
			target: "main",
			text: "delegation is not authorization",
			requestOrigin: {
				session: group.id,
				profile: "untrusted-copy",
				inputs: [batch.id],
				events: originals.map((e) => ({ id: e.id, from: "acct:cli:owner", conv: "forged-copy" })),
			},
		},
	});
	return { event, originals, batch, group };
}

test.each(["qq", "card"])(
	"%s owner handoff bypasses exhausted outsider pool and preserves verified originals",
	async (channel) => {
		const ctx = await setup({ outsiders: { ownerShareDailyTokens: 1 } });
		try {
			await ctx.store.identity().createPerson({ id: "owner", name: "owner" });
			await ctx.store.identity().link(`acct:${channel}:owner`, "person:owner");
			const guest = await ctx.store.events.record(inbound("acct:feishu:visitor", "exhaust"));
			await settle(ctx, run([guest.id], 1));
			const { event, originals } = await handoff(ctx, channel, ["owner", "owner"]);
			const [first, second] = originals;
			if (!first || !second) throw new Error("Owner originals are missing");
			expect(await ctx.wire.command(ctx.session, event)).toBeUndefined();
			await settle(ctx, run([event.id], 500));
			const { parentOrigins } = await import("@yonder/bot-core/tools/parent-origin");
			expect(await parentOrigins(ctx.store, event, "main")).toEqual(originals);
			const context = await conversationContextFor(ctx.store, event);
			if (!context || typeof context === "string") throw new Error("Verified owner request was not structured");
			expect(context.context).toContain('"verified":true');
			expect(context.context).not.toContain("owner: original 0");
			expect(context.ownerTask?.sources).toMatchObject([
				{
					id: first.id,
					conv: first.conv,
					from: first.from,
					relation: "owner",
					text: "owner: original 0",
				},
				{
					id: second.id,
					conv: second.conv,
					from: second.from,
					relation: "owner",
					text: "owner: original 1",
				},
			]);
		} finally {
			await ctx.db.close();
		}
	},
);

test("mixed owner and outsider handoff checks the outsider and charges the original identity once", async () => {
	const ctx = await setup({ outsiders: { perPersonDailyTokens: 100, ownerShareDailyTokens: 1000 } });
	try {
		for (const id of ["owner", "friend"]) {
			await ctx.store.identity().createPerson({ id, name: id });
			await ctx.store.identity().link(`acct:card:${id}`, `person:${id}`);
		}
		const { event } = await handoff(ctx, "card", ["owner", "friend"]);
		expect(await ctx.wire.command(ctx.session, event)).toBeUndefined();
		await settle(ctx, run([event.id], 100));
		expect((await ctx.wire.command(ctx.session, event))?.text).toContain("额度");
		expect(await ctx.wire.command(ctx.session, inbound("acct:card:owner", "owner-after"))).toBeUndefined();
		const context = await conversationContextFor(ctx.store, event);
		expect(typeof context).toBe("string");
		if (typeof context !== "string") throw new Error("Mixed-source request gained owner task semantics");
		expect(context).toContain('"relation":"owner"');
		expect(context).toContain('"relation":"known"');
		expect(context).toContain("owner: original 0");
		expect(context).toContain("friend: original 1");
	} finally {
		await ctx.db.close();
	}
});

test("guest handoff keeps the original group/source and never trusts copied owner claims", async () => {
	const ctx = await setup({ outsiders: { guestMaxRounds: 1 } });
	try {
		const { event, originals } = await handoff(ctx, "qq", ["guest"]);
		expect(await ctx.wire.command(ctx.session, event)).toBeUndefined();
		expect((await ctx.wire.command(ctx.session, originals[0]!))?.text).toContain("登录");
		const context = await conversationContextFor(ctx.store, event);
		expect(typeof context).toBe("string");
		if (typeof context !== "string") throw new Error("Guest request gained owner task semantics");
		expect(context).toContain('"relation":"stranger"');
		expect(context).toContain("guest: original 0");
	} finally {
		await ctx.db.close();
	}
});

test("forged, cross-session and incomplete legacy origin references cannot inherit owner identity", async () => {
	const ctx = await setup({ outsiders: { ownerShareDailyTokens: 1 } });
	try {
		await ctx.store.identity().createPerson({ id: "owner", name: "Owner" });
		await ctx.store.identity().link("acct:qq:owner", "person:owner");
		const { event, batch } = await handoff(ctx, "qq", ["owner", "guest"]);
		const { parentOrigins } = await import("@yonder/bot-core/tools/parent-origin");
		const data = event.data as { requestOrigin: { session: string; inputs?: string[]; events: { id: string }[] } };
		const origin = data.requestOrigin;
		for (const bad of [
			{ ...event, from: "acct:qq:owner" },
			{ ...event, parent: "missing" },
			{ ...event, data: { ...data, requestOrigin: { ...origin, session: ctx.session.id } } },
			{ ...event, data: { ...data, requestOrigin: { ...origin, inputs: [batch.id, "missing"] } } },
			{
				...event,
				data: { ...data, requestOrigin: { ...origin, inputs: undefined, events: origin.events.slice(0, 1) } },
			},
		])
			expect(await parentOrigins(ctx.store, bad, "main")).toBeUndefined();
		const legacy = { ...event, data: { ...data, requestOrigin: { ...origin, inputs: undefined } } };
		expect(await parentOrigins(ctx.store, legacy, "main")).toHaveLength(2);
		const guest = await ctx.store.events.record(inbound("acct:feishu:guest", "deplete"));
		await settle(ctx, run([guest.id], 1));
		const forged = { ...event, data: { ...data, requestOrigin: { ...origin, inputs: ["missing"] } } };
		expect(await ctx.wire.command(ctx.session, forged)).toMatchObject({
			status: "error",
			reason: "parent-origin-unverified",
			text: expect.stringContaining("无法核验"),
		});
		const context = await conversationContextFor(ctx.store, forged);
		expect(typeof context).toBe("string");
		if (typeof context !== "string") throw new Error("Forged origin gained owner task semantics");
		expect(context).toContain('"verified":false');
	} finally {
		await ctx.db.close();
	}
});

test("plugin and channel ingress reject fabricated internal handoffs even with valid old owner references", async () => {
	const ctx = await setup();
	try {
		const { event } = await handoff(ctx, "qq", ["owner"]);
		const { pluginEvent } = await import("@yonder/bot-core/plugins/validation");
		expect(() => pluginEvent("third-party", event)).toThrow("event type must start");
		for (const channel of ["qq", "card"])
			expect(() => pluginEvent("channel-provider", event, channel, true)).toThrow("own channel");
		const { parentOrigins } = await import("@yonder/bot-core/tools/parent-origin");
		const external = { ...event, from: "acct:qq:visitor", conv: "conv:qq:group" };
		expect(pluginEvent("channel-provider", external, "qq", true)).toBe(external);
		expect(await parentOrigins(ctx.store, external, "main")).toBeUndefined();
	} finally {
		await ctx.db.close();
	}
});

test("quota and run.end roll back together, then concurrent retries charge once", async () => {
	const ctx = await setup();
	try {
		const event = await ctx.store.events.record(inbound("acct:feishu:guest", "atomic"));
		const result = run([event.id], 900);
		await ctx.db.exec(`CREATE TRIGGER fail_run_end BEFORE INSERT ON y_events
			WHEN NEW.type = 'run.end' BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END`);
		await expect(settle(ctx, result)).rejects.toThrow("injected completion failure");
		expect(await ctx.store.events.runEnd(ctx.session.id, result.runId)).toBeUndefined();
		expect(await ctx.db.all("SELECT * FROM y_quota_days")).toEqual([]);
		await ctx.db.exec("DROP TRIGGER fail_run_end");
		await Promise.all([settle(ctx, result), settle(ctx, result)]);
		await settle(ctx, result);
		expect(await ctx.db.get("SELECT tokens FROM y_quota_days WHERE scope = 'owner'")).toEqual({ tokens: 900 });
		expect((await ctx.store.events.query({ type: "run.end" })).events).toHaveLength(1);
	} finally {
		await ctx.db.close();
	}
});
