import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { GroupAttention } from "../src/group-attention.js";
import { Groups } from "../src/groups.js";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const message = (text: string, sender = "owner", extra = {}) => ({
	type: "message.in",
	from: `acct:qq-main:${sender}`,
	conv: mainConv,
	data: { kind: "group", text, msgId: crypto.randomUUID(), ...extra },
});

function floorCandidate(focused: boolean) {
	const source: YEvent = {
		id: "source-event",
		ts: new Date().toISOString(),
		type: "message.in",
		from: "acct:qq-gpt:owner",
		conv: gptConv,
		data: { kind: "group", text: "ordinary request", mentioned: false },
	};
	const emitted: EventInput[] = [];
	const batches: EventInput[] = [];
	const api = {
		id: "social",
		config: {},
		log: { info() {}, warn() {}, error() {} },
		events: {
			async emit(event: EventInput) {
				emitted.push(event);
				return { ...event, id: `emitted-${emitted.length}`, ts: new Date().toISOString() };
			},
			async ask(event: EventInput) {
				batches.push(event);
				return { event: { ...event, id: `asked-${batches.length}`, ts: new Date().toISOString() }, results: [] };
			},
			async query(query: { id?: string }) {
				return { events: query.id === source.id ? [source] : [], next: null };
			},
		},
		social: {
			async admitBatch() {
				return { session: "gpt-session" };
			},
		},
	} as unknown as PluginAPI;
	const groups = new Groups(api, { preset: "test" });
	const candidate = {
		agent: "gpt-senpai",
		conv: gptConv,
		session: "gpt-session",
		revision: "r1",
		policy: { batch: { run: true } },
		entries: [source],
		counter: 0,
	};
	const room = {
		id: "shared-room",
		convs: new Set([mainConv, gptConv]),
		waiting: [],
		wake: new Set(),
		turn: { agent: "main", session: "main-session", direct: false, source: "main-source", decision: "main-source" },
		candidates: new Map([[candidate.agent, candidate]]),
		quietMs: 0,
		lastHumanAt: Date.now() - 60000,
	};
	const internal = groups as unknown as {
		aliases: Map<string, string>;
		rooms: Map<string, typeof room>;
		sessions: Map<string, typeof room>;
		attention: GroupAttention;
		flush(room: typeof room): Promise<void>;
		offer(room: typeof room): Promise<void>;
	};
	internal.aliases.set(mainConv, room.id);
	internal.aliases.set(gptConv, room.id);
	internal.rooms.set(room.id, room);
	internal.sessions.set(candidate.session, room);
	return { api, groups, internal, source, candidate, room, emitted, batches, focused };
}

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
				await attention.consider(
					{ agent: "main", counter: 20 },
					"room",
					[source],
					{ keywords: ["开发"], batch: { run: true } },
					new Set(),
					{ runEligible: true },
				),
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

test("a derived default range never wakes on the count fallback without an explicit batch.run", async () => {
	const f = await groupFixture();
	try {
		const attention = new GroupAttention(f.probe.api);
		await attention.start();
		const counter = { agent: "main", counter: 20 };
		const policy = { keywords: ["unmatched"], minIntervalSeconds: 0 };
		const source = await f.probe.ios["qq-main"].emit(message("普通无关闲聊"));
		// 显式参与：count 兜底仍按原有语义唤醒。
		expect(await attention.consider(counter, "room", [source], policy, new Set())).toMatchObject({ matched: true });
		// 08：派生默认范围没有 batch.run: true 时，count 兜底不得自行唤醒，只记录。
		expect(
			await attention.consider(counter, "room", [source], policy, new Set(), { countFallback: false }),
		).toMatchObject({ matched: false });
		// 硬触发（关键词）仍然可运行。
		expect(
			await attention.consider(
				{ agent: "main", counter: 0 },
				"room",
				[source],
				{ ...policy, keywords: ["闲聊"] },
				new Set(),
				{
					countFallback: false,
				},
			),
		).toMatchObject({ matched: true });
		// 明确 run:true 对eligible普通消息形成机会，不再要求关键词、关注或累计阈值。
		expect(
			await attention.consider(
				{ agent: "main", counter: 0 },
				"room",
				[source],
				{ ...policy, batch: { run: true, count: 20 } },
				new Set(),
				{ countFallback: false, runEligible: true },
			),
		).toMatchObject({ matched: true, relevant: [source] });
		// 显式run:false关闭count兜底，但不影响上面的硬关键词机会。
		expect(
			await attention.consider(
				{ agent: "main", counter: 20 },
				"room",
				[source],
				{ ...policy, batch: { run: false, count: 1 } },
				new Set(),
				{ countFallback: false },
			),
		).toMatchObject({ matched: false });
		const paused = await attention.consider(
			{ agent: "main", counter: 0, pause: { scope: "group" } },
			"room",
			[source],
			{ batch: { run: true } },
			new Set(),
			{ runEligible: true },
		);
		expect(paused).toMatchObject({ matched: false, relevant: [] });
	} finally {
		await f.close();
	}
});

test("batch.run true defers a matched opportunity until the real cooldown expires", async () => {
	const f = await groupFixture();
	try {
		const attention = new GroupAttention(f.probe.api);
		await attention.start();
		const source = await f.probe.ios["qq-main"].emit(message("普通问题"));
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			expect(
				await attention.consider(
					{ agent: "main", counter: 0, lastSent: now },
					"room",
					[source],
					{ batch: { run: true }, minIntervalSeconds: 30 },
					new Set(),
					{ runEligible: true },
				),
			).toMatchObject({ matched: false, deferredUntil: now + 30000, relevant: [source] });
		} finally {
			clock.mockRestore();
		}
	} finally {
		await f.close();
	}
});

test("batch.run true admits one ordinary eligible message after its window", async () => {
	const f = await groupFixture({
		social: true,
		officialGroup: true,
		captureSocialApi: true,
		initialBatchRun: true,
		initialRules: { main: { keywords: ["只有关键词才能触发"], count: 20 } },
	});
	try {
		const source = await f.probe.ios["qq-main"].emit(message("今天下午天气不错", "other"));
		await expect
			.poll(
				async () =>
					(await f.kernel.events.query({ type: "social.rule-match", conv: mainConv })).events.some((event) =>
						(event.data as { sourceEvents?: string[] }).sourceEvents?.includes(source.id),
					),
				{ timeout: 6000 },
			)
			.toBe(true);
		const fact = (await f.kernel.events.query({ type: "social.rule-match", conv: mainConv })).events.find((event) =>
			(event.data as { sourceEvents?: string[] }).sourceEvents?.includes(source.id),
		)!;
		expect(fact.data).toMatchObject({
			matched: true,
			sourceEvents: [source.id],
			counter: 0,
		});

		// 窗口结束后，低于count且不命中关键词的原消息仍通过真实准入启动批次。
		await expect.poll(() => f.probe.contexts.length, { timeout: 20000 }).toBe(1);
		const runs = (await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events;
		expect(runs.some((event) => (event.data as { sourceEvents?: string[] }).sourceEvents?.includes(source.id))).toBe(
			true,
		);
	} finally {
		for (const resume of f.probe.releases.values()) resume();
		await f.close();
	}
}, 30000);

test("a peer reply consumes ordinary candidates but preserves focused candidates for their own batch", async () => {
	for (const focused of [false, true]) {
		const f = floorCandidate(focused);
		try {
			if (focused)
				await f.internal.attention.replied(
					{
						id: "prior-reply",
						ts: new Date().toISOString(),
						type: "message.out",
						from: "agent:gpt-senpai",
						conv: gptConv,
						data: { respondTo: f.source.id, delivery: { ok: true } },
					},
					f.room.id,
				);
			await f.internal.flush(f.room);
			expect(f.emitted.find((event) => event.type === "social.rule-match")?.data).toMatchObject({ focused });
			expect(f.candidate.willing).toMatchObject({ focused });
			await f.groups.delivered({
				id: "peer-reply",
				ts: new Date().toISOString(),
				type: "message.out",
				from: "agent:main",
				conv: mainConv,
				data: { delivery: { ok: true } },
			});
			const peerRead = f.emitted.find((event) => event.type === "social.batch-read");
			if (!focused) {
				expect(peerRead).toMatchObject({
					parent: "peer-reply",
					conv: gptConv,
					data: { agent: "gpt-senpai", through: f.source.id },
				});
				expect(f.candidate.willing).toBeUndefined();
				expect(f.candidate.entries).toEqual([]);
			} else {
				expect(peerRead).toBeUndefined();
				expect(f.candidate.willing).toMatchObject({ focused: true, entries: [f.source] });
				if (f.room.timer) clearTimeout(f.room.timer);
				delete f.room.timer;
				delete f.room.turn;
				await f.internal.offer(f.room);
				expect(f.batches.find((event) => event.type === "social.batch-ready")).toMatchObject({
					conv: gptConv,
					data: { agent: "gpt-senpai", sourceEvents: [f.source.id], through: f.source.id },
				});
			}
		} finally {
			f.groups.stop();
		}
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
