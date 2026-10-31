import type { YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { GroupAttention } from "../src/group-attention.js";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const message = (text: string, sender = "owner", extra = {}) => ({
	type: "message.in",
	from: `acct:qq-main:${sender}`,
	conv: mainConv,
	data: { kind: "group", text, msgId: crypto.randomUUID(), ...extra },
});

test("successful replies focus the actual participant for five minutes without extending on incoming messages", async () => {
	const f = await groupFixture();
	try {
		const attention = new GroupAttention(f.probe.api);
		await attention.start();
		const source = await f.probe.ios["qq-main"].emit(message("普通问题"));
		const now = Date.now();
		const reply = {
			id: "reply",
			ts: new Date(now).toISOString(),
			type: "message.out",
			from: "agent:main",
			conv: mainConv,
			parent: source.id,
			data: { delivery: { ok: true } },
		} as YEvent;
		await attention.replied(reply, "room");
		const next = await f.probe.ios["qq-main"].emit(message("然后呢"));
		const candidate = { agent: "main", counter: 0, lastSent: now };
		const policy = { keywords: ["unmatched"], minIntervalSeconds: 60 };
		expect(await attention.consider(candidate, "room", [next], policy, new Set())).toMatchObject({
			matched: true,
			focused: true,
		});
		const other = await f.probe.ios["qq-main"].emit(message("然后呢", "other"));
		expect(await attention.consider(candidate, "room", [other], policy, new Set())).toMatchObject({
			matched: false,
			focused: false,
		});
		expect(await attention.consider(candidate, "another-room", [next], policy, new Set())).toMatchObject({
			focused: false,
		});
		const restored = new GroupAttention(f.probe.api);
		await restored.start();
		await restored.replied(reply, "room");
		expect(
			await restored.consider({ ...candidate, agent: "gpt-senpai" }, "room", [next], policy, new Set()),
		).toMatchObject({ focused: false });
		const clock = vi.spyOn(Date, "now").mockReturnValue(now + 300000);
		try {
			expect(await attention.consider(candidate, "room", [next], policy, new Set())).toMatchObject({
				matched: false,
				focused: false,
			});
			expect(await restored.consider(candidate, "room", [next], policy, new Set())).toMatchObject({ focused: false });
		} finally {
			clock.mockRestore();
		}
		await attention.replied({ ...reply, ts: new Date().toISOString(), data: { delivery: { ok: false } } }, "room");
	} finally {
		await f.close();
	}
});

test("explicit recipients override attention, keywords and accumulated count while multi-Bot addresses preserve self", async () => {
	const f = await groupFixture();
	try {
		const attention = new GroupAttention(f.probe.api);
		await attention.start();
		for (const text of ["GPT 学姐，帮我开发", "给GPT安排任务", "GPT 学姐你来处理"]) {
			const source = await f.probe.ios["qq-main"].emit(message(text));
			expect(await attention.elsewhere(source, "main"), text).toBe(true);
			expect(
				await attention.consider({ agent: "main", counter: 20 }, "room", [source], { keywords: ["开发"] }, new Set()),
			).toMatchObject({ matched: false });
		}
		for (const text of ["GPT 学姐和贾维斯，你们看看", "贾维斯和GPT 学姐，你们看看", "我刚看到 GPT 学姐的消息"]) {
			const source = await f.probe.ios["qq-main"].emit(message(text));
			expect(await attention.elsewhere(source, "main"), text).toBe(false);
		}
		const mentioned = await f.probe.ios["qq-main"].emit(
			message("任务规划", "owner", { mentions: ["acct:qq-main:other"], mentioned: false }),
		);
		expect(await attention.elsewhere(mentioned, "main")).toBe(true);
		const multi = { ...mentioned, data: { ...mentioned.data, mentioned: true } };
		expect(await attention.elsewhere(multi, "main")).toBe(false);
		const human = await f.probe.ios["qq-main"].emit(message("我来做", "other"));
		const quoted = await f.probe.ios["qq-main"].emit(message("任务规划", "owner", { replyTo: human.data.msgId }));
		expect(await attention.elsewhere(quoted, "main")).toBe(true);
		const qqQuoted = { ...quoted, data: { text: "任务规划", qq: { refMsgIdx: "unresolved" } } };
		expect(await attention.elsewhere(qqQuoted, "main")).toBe(false);
	} finally {
		await f.close();
	}
});

test("same-window requests for two Bots preserve each one's own source instead of consuming the earlier task", async () => {
	const f = await groupFixture({ social: true });
	try {
		const first = await f.probe.ios["qq-main"].emit(message("贾维斯，请看看任务规划"));
		await f.probe.ios["qq-gpt"].emit({
			...message("贾维斯，请看看任务规划"),
			conv: gptConv,
			from: "acct:qq-gpt:owner",
		});
		const other = await f.probe.ios["qq-main"].emit(message("GPT 学姐，请看看开发方案"));
		const second = await f.probe.ios["qq-gpt"].emit({
			...message("GPT 学姐，请看看开发方案"),
			conv: gptConv,
			from: "acct:qq-gpt:owner",
		});
		await expect.poll(() => f.probe.contexts.length, { timeout: 19000 }).toBe(1);
		const ctx = f.probe.contexts[0]!;
		expect(ctx.agent).toBe("main");
		const ownBatch = (await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events[0]!;
		expect(ownBatch.data).toMatchObject({ sourceEvents: [first.id], through: first.id });
		expect((ownBatch.data as { sourceEvents: string[] }).sourceEvents).not.toContain(other.id);
		const later = await f.probe.ios["qq-main"].emit(message("GPT 学姐，请补充开发细节"));
		await expect
			.poll(
				async () =>
					(await f.kernel.events.query({ type: "social.rule-match", conv: mainConv })).events.some((e) =>
						(e.data as { sourceEvents?: string[] }).sourceEvents?.includes(later.id),
					),
				{ timeout: 6000 },
			)
			.toBe(true);
		const last = (await f.kernel.events.query({ type: "social.rule-match", conv: mainConv })).events.at(-1)!;
		expect(last.data).toMatchObject({ matched: false });
		expect((last.data as { sourceEvents: string[] }).sourceEvents).not.toContain(first.id);
		expect(ctx.signal.aborted).toBe(false);
		f.probe.releases.get(ctx.session)?.();
		await expect.poll(() => f.probe.contexts.length, { timeout: 5000 }).toBe(2);
		expect(f.probe.contexts[1]?.agent).toBe("gpt-senpai");
		const peerBatch = (await f.kernel.events.query({ type: "social.batch-ready", conv: gptConv })).events[0]!;
		expect(peerBatch.data).toMatchObject({ sourceEvents: [second.id], through: second.id });
	} finally {
		await f.close();
	}
}, 30000);
