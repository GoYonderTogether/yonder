import { expect, test, vi } from "vitest";
import { ReplyText } from "./index.js";

test("NO_REPLY fragments stay private, ordinary progress is released without losing its prefix", () => {
	const marker = new ReplyText();
	expect(marker.push("  NO_")).toBe("");
	expect(marker.push("REPLY")).toBe("");
	expect(marker.push("\n")).toBe("");
	const text = new ReplyText();
	expect(text.push("N")).toBe("");
	expect(text.push("ext step")).toBe("Next step");
	expect(text.push(" completed.")).toBe(" completed.");
	const explanation = new ReplyText();
	expect(explanation.push("NO_REPLY")).toBe("");
	expect(explanation.push(" means no delivery")).toBe("NO_REPLY means no delivery");
});

// Protocol driver only: real SQLite receipts and delivery, no simulated model.
import type { Channel, Hook, OutputPart, SessionInfo } from "@yonder/sdk";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { createStore, newEvent } from "../store/index.js";
import { createDelivery } from "./index.js";

async function setup(hooks?: Map<string, Hook[]>, selected: string[] = []) {
	const db = await openDatabase(":memory:");
	const store = await createStore(db);
	const config: RuntimeSessionConfig = {
		agent: "main",
		profile: "owner",
		cwd: "/tmp",
		resolved: resolveProfile({ plugins: selected }),
		bindings: [{ id: "source", match: { channel: "test" }, session: "main", stream: true }],
	};
	const session: SessionInfo = {
		id: "1",
		agent: "main",
		profile: "owner",
		mode: "main",
		key: "main",
		version: "check",
		opened: new Date().toISOString(),
	};
	const event = newEvent({ type: "message.in", conv: "conv:test:chat", data: { text: "check" } }, [
		{ agent: "main", session: "1", binding: "source", waiting: false },
	]);
	await store.events.append(event);
	const bubbles: Array<{ parts: OutputPart[]; closed: boolean }> = [];
	const sent: string[] = [];
	const channel: Channel = {
		id: "test",
		kinds: ["dm"],
		output: { stream: true, attachments: false },
		async start() {},
		async stop() {},
		async stream(_to, output) {
			const bubble = { parts: [] as OutputPart[], closed: false };
			bubbles.push(bubble);
			for await (const part of output) bubble.parts.push(part);
			bubble.closed = true;
			return { ok: true, id: `bubble-${bubbles.length}` };
		},
		async send(_to, msg) {
			sent.push(msg.text);
			return { ok: true };
		},
	};
	const delivery = createDelivery({
		...(hooks ? { hooks } : {}),
		store,
		agents: new Map(),
		channels: new Map([["test", channel]]),
		runtime: () => ({ currentConfig: () => config }) as unknown as Runtime,
		sessions: { resolveSession: async () => config } as unknown as Sessions,
	});
	delivery.start();
	const output = delivery.onStart(session, event, false)!;
	const emit = (part: OutputPart) => output(part, "run");
	const finish = async (text: string, message?: string, status: "done" | "aborted" = "done") => {
		const end = await delivery.onRun(
			session,
			{
				runId: "run",
				text,
				status,
				inputs: [event.id],
				config,
				...(message ? { message } : {}),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			},
			[event],
		);
		await store.events.recordRun(end.ending);
		end.deliver();
	};
	return { db, store, delivery, channel, session, event, bubbles, sent, emit, finish, config };
}

test("messages close during tool work; progress and answer keep independent receipts without a new input", async () => {
	const x = await setup();
	try {
		x.emit({ type: "message_start", id: "100" });
		x.emit({ type: "text", delta: "开始检查" });
		x.emit({ type: "message_end", text: "开始检查" });
		x.emit({ type: "tool", phase: "start", name: "bash" });
		await expect.poll(() => x.bubbles[0]?.closed).toBe(true);
		expect((await x.store.events.query({ type: "run.end" })).events).toHaveLength(0);
		await expect.poll(async () => (await x.store.events.query({ type: "message.out" })).events.length).toBe(1);
		// Later steer callbacks cannot take over or duplicate the same target's message.
		const steer = x.delivery.onStart(x.session, { ...x.event, id: "later" }, false)!;
		steer({ type: "text", delta: "不应重复" }, "run");
		for (const [id, text] of [
			["101", "阶段检查完成"],
			["102", "最终结果"],
		]) {
			x.emit({ type: "message_start", id: id! });
			x.emit({ type: "text", delta: text! });
			x.emit({ type: "message_end", text: text! });
		}
		await x.finish("最终结果", "102");
		await expect.poll(async () => (await x.store.events.query({ type: "message.out" })).events.length).toBe(3);
		expect(x.bubbles).toHaveLength(3);
		expect(x.bubbles.every((b) => b.closed)).toBe(true);
		expect(x.bubbles.map((b) => b.parts.at(-1))).toEqual(
			["开始检查", "阶段检查完成", "最终结果"].map((text) => ({ type: "final", text })),
		);
		expect(x.sent).toEqual([]);
		// Recovered final receipt uses the same generation identity: no duplicate send.
		await x.finish("最终结果", "102");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(x.sent).toEqual([]);
	} finally {
		await x.db.close();
	}
});

test("empty and NO_REPLY messages stay invisible; cancellation closes partial and sends a stop notice", async () => {
	const x = await setup();
	try {
		for (const text of ["", "NO_REPLY"]) {
			x.emit({ type: "message_start", id: text || "empty" });
			if (text) x.emit({ type: "text", delta: text });
			x.emit({ type: "message_end", text });
		}
		x.emit({ type: "message_start", id: "partial" });
		x.emit({ type: "text", delta: "正在检查" });
		await x.finish("", undefined, "aborted");
		await expect.poll(() => x.sent.length).toBe(1);
		expect(x.bubbles).toHaveLength(1);
		expect(x.bubbles[0]?.closed).toBe(true);
		expect(x.bubbles[0]?.parts.at(-1)).toEqual({ type: "final", text: "正在检查" });
		expect(x.sent[0]).toContain("运行已停止");
	} finally {
		await x.db.close();
	}
});

test("slow channels do not hold model termination; unknown progress does not swallow the final message", async () => {
	const x = await setup();
	let release!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	try {
		const stream = vi.spyOn(x.channel, "stream").mockImplementationOnce(async (_target, output) => {
			for await (const _part of output) {
				/* Consume the real message queue. */
			}
			await held;
			throw new Error("Progress delivery lost its confirmation");
		});
		x.emit({ type: "message_start", id: "progress" });
		x.emit({ type: "text", delta: "检查中" });
		x.emit({ type: "message_end", text: "检查中" });
		await expect.poll(() => stream.mock.calls.length).toBe(1);
		x.emit({ type: "message_start", id: "answer" });
		x.emit({ type: "text", delta: "完成" });
		x.emit({ type: "message_end", text: "完成" });
		await x.finish("完成", "answer");
		expect((await x.store.events.query({ type: "run.end" })).events).toHaveLength(1);
		expect(stream).toHaveBeenCalledTimes(1);
		release();
		await expect.poll(async () => (await x.store.events.query({ type: "message.out" })).events.length).toBe(1);
		expect((await x.store.events.query({ type: "message.unknown" })).events).toHaveLength(1);
		expect(x.bubbles).toHaveLength(1);
		expect(x.bubbles[0]?.parts.at(-1)).toEqual({ type: "final", text: "完成" });
		expect(x.sent).toEqual([]);
	} finally {
		release();
		await x.db.close();
	}
});

test("an ordinary message that is a control-marker prefix is released at message end", async () => {
	const x = await setup();
	try {
		x.emit({ type: "message_start", id: "short" });
		x.emit({ type: "text", delta: "NO" });
		x.emit({ type: "message_end", text: "NO" });
		await expect.poll(() => x.sent.length).toBe(1);
		expect(x.sent).toEqual(["NO"]);
		await x.finish("NO", "short");
		await new Promise((done) => setTimeout(done, 10));
		expect(x.sent).toEqual(["NO"]);
	} finally {
		await x.db.close();
	}
});

test("safe unsent delivery is retried online and after reopening; unknown and partial sends are not replayed", async () => {
	const x = await setup();
	let online = false,
		calls = 0;
	x.channel.send = async (_target, msg) => {
		calls++;
		if (!online) return { ok: false, retryable: true, error: "ENOTFOUND before dispatch" };
		x.sent.push(msg.text);
		return { ok: true, id: "receipt" };
	};
	try {
		const request = { to: "conv:test:chat", text: "terminal failure notification" };
		expect(await x.delivery.sendPlugin("check", request)).toMatchObject({ retryable: true });
		await expect.poll(() => calls, { timeout: 5000 }).toBeGreaterThan(1);
		await x.delivery.close();
		online = true;
		const reopened = createDelivery({
			store: x.store,
			agents: new Map(),
			channels: new Map([["test", x.channel]]),
			runtime: () => ({}) as Runtime,
			sessions: {} as Sessions,
		});
		try {
			await reopened.recover();
			reopened.start();
			await expect.poll(() => x.sent, { timeout: 5000 }).toContain(request.text);
			expect(x.sent).toHaveLength(1);
			expect((await x.store.events.query({ type: "message.attempt" })).events).toHaveLength(1);
			expect(await x.store.events.retryableAttempts()).toHaveLength(0);
			for (const outcome of [
				{ ok: false, uncertain: true, error: "receipt lost" },
				{ ok: false, id: "partial", uncertain: true, error: "second chunk unknown" },
				{ ok: false, error: "403 permission denied" },
			]) {
				x.channel.send = async () => {
					calls++;
					return outcome;
				};
				await reopened.sendPlugin("check", { ...request, text: outcome.error });
			}
			const before = calls;
			await reopened.recover();
			await new Promise((resolve) => setTimeout(resolve, 1100));
			expect(calls).toBe(before);
			expect(await x.store.events.retryableAttempts()).toHaveLength(0);
		} finally {
			await reopened.close();
		}
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("shutdown during a retry dispatch preserves uncertainty and never replays an earlier safe failure", async () => {
	const x = await setup();
	let calls = 0;
	x.channel.send = async (_to, _msg, signal) => {
		calls++;
		if (calls === 1) return { ok: false, retryable: true, error: "ENOTFOUND" };
		await new Promise<void>((_resolve, reject) =>
			signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
		);
		return { ok: true };
	};
	try {
		await x.delivery.sendPlugin("check", { to: "conv:test:chat", text: "terminal status" });
		await expect.poll(() => calls, { timeout: 5000 }).toBe(2);
		await x.delivery.close();
		const reopened = createDelivery({
			store: x.store,
			agents: new Map(),
			channels: new Map([["test", x.channel]]),
			runtime: () => ({}) as Runtime,
			sessions: {} as Sessions,
		});
		try {
			await reopened.recover();
			reopened.start();
			expect(await x.store.events.retryableAttempts()).toHaveLength(0);
			expect((await x.store.events.query({ type: "message.unknown" })).events).toHaveLength(1);
			await new Promise((resolve) => setTimeout(resolve, 1100));
			expect(calls).toBe(2);
		} finally {
			await reopened.close();
		}
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("a wholly unsent streaming message recovers its full closed text from the same ledger after restart", async () => {
	const x = await setup();
	x.channel.stream = async () => ({ ok: false, retryable: true, error: "ENOTFOUND before card creation" });
	try {
		x.emit({ type: "message_start", id: "unsent" });
		x.emit({ type: "text", delta: "partial" });
		x.emit({ type: "message_end", text: "complete final body" });
		await x.finish("complete final body", "unsent");
		await expect.poll(async () => (await x.store.events.retryableAttempts()).length).toBe(1);
		await x.delivery.close();
		const reopened = createDelivery({
			store: x.store,
			agents: new Map(),
			channels: new Map([["test", x.channel]]),
			runtime: () => ({}) as Runtime,
			sessions: { resolveSession: async () => x.config } as unknown as Sessions,
		});
		try {
			await reopened.recover();
			reopened.start();
			await expect.poll(() => x.sent, { timeout: 5000 }).toEqual(["complete final body"]);
			expect((await x.store.events.query({ type: "message.attempt" })).events).toHaveLength(1);
			expect(await x.store.events.retryableAttempts()).toHaveLength(0);
		} finally {
			await reopened.close();
		}
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("selected beforeSend filters complete split messages before attempts/ledger, while unselected hooks do not run", async () => {
	let called = 0;
	const hooks = new Map<string, Hook[]>([
		[
			"filter",
			[
				{
					id: "filter",
					beforeSend(message) {
						called++;
						return { message: { ...message, text: message.text.replaceAll("opaque-secret", "[sealed]") } };
					},
				},
			],
		],
	]);
	const x = await setup(hooks, ["filter"]);
	try {
		x.emit({ type: "message_start", id: "filtered" });
		x.emit({ type: "text", delta: "opaque-" });
		x.emit({ type: "tool", phase: "start", name: "read" });
		x.emit({ type: "text", delta: "secret" });
		expect(x.bubbles).toHaveLength(0);
		expect(x.sent).toHaveLength(0);
		x.emit({ type: "message_end", text: "opaque-secret" });
		await expect.poll(() => x.sent).toEqual(["[sealed]"]);
		await x.finish("opaque-secret", "filtered");
		await expect.poll(async () => (await x.store.events.query({ type: "message.out" })).events.length).toBe(1);
		expect(JSON.stringify((await x.store.events.query({})).events)).not.toContain("opaque-secret");
		expect(called).toBe(1);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
	const y = await setup(hooks);
	try {
		y.emit({ type: "message_start", id: "normal" });
		y.emit({ type: "text", delta: "opaque-secret" });
		y.emit({ type: "message_end", text: "opaque-secret" });
		await y.finish("opaque-secret", "normal");
		await expect.poll(() => y.bubbles[0]?.closed).toBe(true);
		expect(called).toBe(1);
	} finally {
		await y.delivery.close();
		await y.db.close();
	}
});

test("peer reply none records caller return without a channel message or stream", async () => {
	const x = await setup();
	try {
		x.config.bindings![0]!.reply = "none";
		const event = newEvent(
			{
				type: "message.in",
				from: "acct:agent:other",
				conv: "conv:test:chat",
				data: { kind: "agent", text: "Delivery contract" },
			},
			[{ agent: "main", session: "1", binding: "source", waiting: true }],
		);
		await x.store.events.append(event);
		expect(x.delivery.onStart(x.session, event, true)).toBeUndefined();
		// Supply a protocol result directly, not a model implementation.
		const end = await x.delivery.onRun(
			x.session,
			{
				runId: "peer-contract",
				status: "done",
				text: "Protocol return",
				inputs: [event.id],
				config: x.config,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			},
			[event],
			true,
		);
		expect(end.ending.data.replied).toBe("caller");
		expect(end.ending.data.targets).toEqual([]);
		await x.store.events.recordRun(end.ending);
		end.deliver();
		expect(x.sent).toEqual([]);
		expect(x.bubbles).toEqual([]);
		expect((await x.store.events.query({ type: "message.out" })).events).toEqual([]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("beforeSend receives the destination Ref from kernel delivery", async () => {
	const destinations: string[] = [];
	const x = await setup(
		new Map([
			[
				"destination",
				[
					{
						id: "destination",
						beforeSend(message) {
							destinations.push(message.to);
						},
					},
				],
			],
		]),
		["destination"],
	);
	try {
		x.emit({ type: "message_start", id: "destination" });
		x.emit({ type: "message_end", text: "Destination check" });
		await expect.poll(() => x.sent).toEqual(["Destination check"]);
		expect(destinations).toEqual(["conv:test:chat"]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});
