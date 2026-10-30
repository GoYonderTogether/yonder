import type { SessionInfo, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import type { YonderConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import type { DeliveryService } from "../delivery/index.js";
import { openDatabase } from "../runtime/db.js";
import type { RuntimeRun } from "../runtime/index.js";
import type { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { quotaWire } from "./quota-wire.js";

const skills = async () => ({ skills: [], issues: [], index: "", estimatedTokens: 0 });
const run = (inputs: string[], tokens: number): RuntimeRun => ({
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
		db,
		config,
		store,
		sessions: {} as ReturnType<typeof createSessions>,
		delivery,
		skills,
	});
	return { db, store, session, sends, wire };
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

test("访客第 4 轮被拒并发登录提示，同时留下结构化拒绝事件", async () => {
	const ctx = await setup();
	try {
		for (const msgId of ["g1", "g2", "g3"]) {
			expect(await ctx.wire.command(ctx.session, inbound("acct:feishu:guest", msgId))).toBeUndefined();
		}
		const rejected = await ctx.wire.command(ctx.session, inbound("acct:feishu:guest", "g4"));
		expect(rejected?.status).toBe("done");
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
		await ctx.wire.settle(ctx.session.id, run([first.id], 1_000));
		const rejected = await ctx.wire.command(ctx.session, inbound("acct:feishu:friend", "f2"));
		expect(rejected?.text).toContain("额度");
		const page = await ctx.store.events.query({ type: "outsider.rejected" });
		expect((page.events[0]!.data as { reason: string }).reason).toBe("person_daily_limit");
		// 主人不受份额与每人额度限制：额度已经用完也照常进入模型。
		const owner = await ctx.store.events.record(inbound("acct:cli:local", "o1"));
		expect(await ctx.wire.command(ctx.session, owner)).toBeUndefined();
		await ctx.wire.settle(ctx.session.id, run([owner.id], 5_000));
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
		await ctx.wire.settle(ctx.session.id, run([first.id], 900));
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
		await ctx.wire.settle(ctx.session.id, run([first.id], 900));
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
