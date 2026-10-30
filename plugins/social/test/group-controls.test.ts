import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExecutionOwner, ToolContext, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const owner = (ctx: ToolContext): ExecutionOwner => ({ session: ctx.session, agent: ctx.agent, profile: ctx.profile });
const input = (instance: string, conv: string, text: string, mentioned = false, sender = "owner") => ({
	type: "message.in",
	from: `acct:${instance}:${sender}`,
	conv,
	data: {
		kind: "group",
		text,
		msgId: randomUUID(),
		mentioned,
		social: { mentions: { bot: mentioned }, senderRole: "member" },
	},
});
function modelObservations(home: string) {
	const db = new DatabaseSync(join(home, ".yonder/state.db"), { readOnly: true });
	try {
		return Number(
			db
				.prepare(
					"SELECT count(*) AS count FROM pi_entries WHERE json_extract(record, '$.kind') = 'pi.model-observation'",
				)
				.get()?.count,
		);
	} finally {
		db.close();
	}
}
const pauseData = (event: YEvent) =>
	event.data as {
		kind?: string;
		agent?: string;
		after?: { pause?: { scope?: string; actor?: string } };
	};

test("an owner's addressed stop aborts its actual group run, blocks old delivery, and lets its sibling proceed", async () => {
	const fixture = await groupFixture({ social: true });
	const { kernel, probe } = fixture;
	try {
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, "在吗", true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const main = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!main) throw Error("Real main run did not reach beforeRequest");
		await probe.ios["qq-gpt"].emit(input("qq-gpt", gptConv, "在吗", true));
		expect(probe.contexts.some((ctx) => ctx.agent === "gpt-senpai")).toBe(false);
		const stop = await probe.ios["qq-main"].emit(input("qq-main", mainConv, "闭嘴", true));
		await expect.poll(() => main.signal.aborted, { timeout: 5000 }).toBe(true);
		try {
			await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "gpt-senpai"), { timeout: 5000 }).toBe(true);
		} catch (cause) {
			const evidence = {} as Record<string, YEvent[]>;
			for (const type of ["social.group-turn", "social.policy-change", "run.start", "run.end"])
				evidence[type] = (await kernel.events.query({ type })).events;
			throw Error(JSON.stringify(evidence), { cause });
		}
		const gpt = probe.contexts.find((ctx) => ctx.agent === "gpt-senpai");
		if (!gpt) throw Error("Sibling did not receive the released room turn");
		expect(gpt.signal.aborted).toBe(false);
		await expect(probe.api.messages.send({ owner: owner(main), to: mainConv, text: "已停止的旧回答" })).rejects.toThrow(
			"已暂停",
		);
		const pauses = (await kernel.events.query({ type: "social.policy-change" })).events.filter(
			(event) => pauseData(event).kind === "group-pause",
		);
		expect(pauses).toHaveLength(1);
		expect(pauses[0]).toMatchObject({ parent: stop.id, conv: mainConv });
		expect(pauses[0]?.data).toMatchObject({
			agent: "main",
			after: { pause: { scope: "group", actor: "acct:qq-main:owner" } },
		});
		expect(probe.sent).toEqual([]);
		expect((await kernel.events.query({ type: "social.judge-start" })).events).toEqual([]);
		expect(modelObservations(fixture.home)).toBe(0);
	} finally {
		await fixture.close();
	}
});

test("a member asking not to answer pauses that interaction without banning the group", async () => {
	const fixture = await groupFixture({ social: true });
	const { kernel, probe } = fixture;
	try {
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, "在吗", true, "member"));
		await expect.poll(() => probe.contexts.length, { timeout: 5000 }).toBe(1);
		const first = probe.contexts[0];
		if (!first) throw Error("Real member interaction did not start");
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, "不用回答我", true, "member"));
		await expect.poll(() => first.signal.aborted, { timeout: 5000 }).toBe(true);
		await expect
			.poll(
				async () =>
					(await kernel.events.query({ type: "run.end" })).events.some(
						(e) => (e.data as { session?: string }).session === first.session,
					),
				{ timeout: 5000 },
			)
			.toBe(true);
		const pauses = (await kernel.events.query({ type: "social.policy-change" })).events.filter(
			(event) => pauseData(event).kind === "group-pause",
		);
		expect(pauses).toHaveLength(1);
		expect(pauses[0]?.data).toMatchObject({
			agent: "main",
			after: { pause: { scope: "interaction", actor: "acct:qq-main:member" } },
		});
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, "请回答我的问题", true));
		await expect.poll(() => probe.contexts.length, { timeout: 5000 }).toBe(2);
		const next = probe.contexts[1];
		if (!next) throw Error("Another person's addressed interaction was blocked");
		expect(next.signal.aborted).toBe(false);
		expect(await probe.api.messages.send({ owner: owner(next), to: mainConv, text: "回应另一位的点名" })).toMatchObject(
			{ ok: true },
		);
		expect(probe.sent).toEqual([{ to: mainConv, text: "回应另一位的点名" }]);
		expect(modelObservations(fixture.home)).toBe(0);
	} finally {
		await fixture.close();
	}
});

test("twenty eligible group messages trigger one real batch after quiet time with zero judge/model calls", async () => {
	const fixture = await groupFixture({ social: true });
	const { kernel, probe } = fixture;
	try {
		const sources: YEvent[] = [];
		for (let index = 0; index < 19; index++)
			sources.push(await probe.ios["qq-main"].emit(input("qq-main", mainConv, `普通群聊消息 ${index + 1}`)));
		await expect
			.poll(async () => (await kernel.events.query({ type: "social.rule-match", conv: mainConv })).events.length, {
				timeout: 6000,
			})
			.toBe(1);
		const firstMatch = (await kernel.events.query({ type: "social.rule-match", conv: mainConv })).events[0];
		expect(firstMatch?.data).toMatchObject({
			agent: "main",
			matched: false,
			counter: 19,
			sourceEvents: sources.map((e) => e.id),
		});
		expect(probe.contexts).toEqual([]);
		expect((await kernel.events.query({ type: "social.batch-ready" })).events).toEqual([]);
		sources.push(await probe.ios["qq-main"].emit(input("qq-main", mainConv, "普通群聊消息 20")));
		const lastInputAt = Date.now();
		await expect
			.poll(() => probe.contexts.filter((ctx) => ctx.agent === "main").length, { timeout: 19000, interval: 100 })
			.toBe(1);
		expect(Date.now() - lastInputAt).toBeGreaterThanOrEqual(4900);
		const facts = (await kernel.events.query({ type: "social.rule-match", conv: mainConv })).events;
		expect(facts).toHaveLength(2);
		expect(facts[1]?.data).toMatchObject({ agent: "main", matched: true, counter: 0, sourceEvents: [sources[19]?.id] });
		const batches = (await kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events;
		expect(batches).toHaveLength(1);
		expect(batches[0]?.data).toMatchObject({
			agent: "main",
			sourceEvents: [sources[19]?.id],
			through: sources[19]?.id,
		});
		expect((await kernel.events.query({ type: "social.judge-start" })).events).toEqual([]);
		expect((await kernel.events.query({ type: "social.rules-review-start" })).events).toEqual([]);
		expect(modelObservations(fixture.home)).toBe(0);
		expect(probe.sent).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 30000);

test("a trusted same-group administrator can pause and resume without owner authority", async () => {
	const f = await groupFixture({ social: true });
	try {
		const control = (text: string) => {
			const e = input("qq-main", mainConv, text, true, "administrator");
			e.data.social.senderRole = "group-admin";
			return e;
		};
		await f.probe.ios["qq-main"].emit(control("闭嘴"));
		await expect
			.poll(async () => (await f.kernel.events.query({ type: "social.policy-change", conv: mainConv })).events.length)
			.toBe(1);
		const paused = (await f.kernel.events.query({ type: "social.policy-change", conv: mainConv })).events[0]!;
		expect(paused.data).toMatchObject({
			agent: "main",
			after: { pause: { scope: "group", actor: "acct:qq-main:administrator" } },
		});
		expect(await f.kernel.identity.relation("main", "acct:qq-main:administrator")).toBe("stranger");
		await f.probe.ios["qq-main"].emit(control("恢复回复"));
		await expect
			.poll(async () => (await f.kernel.events.query({ type: "social.policy-change", conv: mainConv })).events.length)
			.toBe(2);
		const resumed = (await f.kernel.events.query({ type: "social.policy-change", conv: mainConv })).events[1]!;
		expect(resumed.data).toMatchObject({ agent: "main", after: { pause: null } });
		expect(f.probe.sent).toEqual([]);
	} finally {
		await f.close();
	}
});
