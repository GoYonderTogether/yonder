import type { UsageTotals } from "@yonder/gateway/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionStateStore } from "../../src/work/api/events";
import { footerStats, reduceSessionState } from "../../src/work/api/session-state";
import { Mux, type StreamSocket } from "../../src/work/api/stream";

/** 直接喂帧的假连接：Mux 只要求最小面，不需要网关。 */
class FakeSocket implements StreamSocket {
	readyState = 0;
	sent: Array<Record<string, unknown>> = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	feed(frame: unknown) {
		this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
	}
	send(data: string) {
		this.sent.push(JSON.parse(data) as Record<string, unknown>);
	}
	close() {
		this.readyState = 3;
		this.onclose?.();
	}
}

const totals = (input: number, output: number, cacheRead = 0, cacheWrite = 0): UsageTotals => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: 0,
});

function harness() {
	const sockets: FakeSocket[] = [];
	const mux = new Mux({
		create: () => {
			const ws = new FakeSocket();
			sockets.push(ws);
			return ws;
		},
		url: () => "ws://gateway.test/api/stream?v=1",
	});
	return { mux, sockets, store: createSessionStateStore(mux) };
}

const ready = (gap: boolean, result: unknown, cursor = "e1:0") => ({ t: "ready", sub: "s1", gap, cursor, result });
const ev = (seq: number, type: string, data: unknown, cursor = `e1:${seq}`) => ({
	t: "ev",
	sub: "s1",
	seq,
	cursor,
	type,
	ts: "2026-10-29T00:00:00.000Z",
	data,
});

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("session state 归约", () => {
	it("共享状态从 Gateway 的嵌套 info 快照读取模型和用量", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(
			ready(true, {
				session: { id: "s1" },
				info: { model: { provider: "openai", id: "gpt-6-luna" }, usage: totals(15064, 6) },
			}),
		);
		expect(store.get("s1").model).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
		expect(store.get("s1").usage?.self).toEqual(totals(15064, 6));
		stop();
	});
	it("快照里的 usage 按 self/children/last/lsp 保留，FooterStats 由此派生", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(
			ready(false, {
				session: { id: "s1" },
				usage: {
					self: totals(6800, 123_000, 15_000_000, 901_000),
					children: totals(2_800_000, 577_000),
					last: { ...totals(100, 200, 300, 10), cacheHitPct: 98.6 },
					lsp: { name: "typescript", state: "Active" },
				},
				context: { tokens: 121_000, window: 200_000, percent: 60.5, auto: true },
				model: { provider: "rightapi-claude", model: "claude-opus-5-5", thinking: "high" },
			}),
		);

		const state = store.get("s1");
		expect(state.usage?.self).toEqual(totals(6800, 123_000, 15_000_000, 901_000));
		expect(state.usage?.children).toEqual(totals(2_800_000, 577_000));
		const stats = footerStats(state);
		expect(stats.cacheHitPct).toBe(98.6);
		expect(stats.lsp).toEqual({ name: "typescript", state: "Active" });
		expect(stats.context?.percent).toBe(60.5);
		expect(stats.model?.thinking).toBe("high");
		stop();
	});

	it("同一 sub 的旧 seq 被丢弃，状态不回退", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(ready(false, { session: { id: "s1" } }));
		ws.feed(ev(5, "usage.updated", { session: "s1", scope: "self", totals: totals(10, 20) }));
		ws.feed(ev(3, "usage.updated", { session: "s1", scope: "self", totals: totals(1, 2) }));

		expect(store.get("s1").usage?.self).toEqual(totals(10, 20));
		stop();
	});

	it("断线重连 gap=true 时以快照重置，不沿用旧连接的增量", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(
			ready(false, {
				session: { id: "s1" },
				usage: { self: totals(10, 20), children: totals(1, 2) },
				context: { tokens: 5, window: 100, percent: 5, auto: true },
				model: { provider: "openai", model: "gpt-6-luna" },
			}),
		);
		ws.feed(ev(1, "todo.updated", { session: "s1", done: 0, total: 1, items: [] }));
		ws.feed(ev(2, "wake.updated", { session: "s1", rows: [] }));

		ws.close();
		vi.advanceTimersByTime(500);
		const next = sockets[1] as FakeSocket;
		next.open();
		// 新连接 seq 从 1 重新开始；gap=true 的快照只带会话本身。
		next.feed(ready(true, { session: { id: "s1" } }));

		const state = store.get("s1");
		expect(state.usage).toBeUndefined();
		expect(state.context).toBeUndefined();
		expect(state.model).toBeUndefined();
		expect(state.todos).toEqual([]);
		expect(state.wakes).toBeUndefined();
		stop();
	});

	it("重连 gap=false 的 ready 保留本地增量", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(ready(false, { session: { id: "s1" } }));
		ws.feed(ev(1, "context.updated", { session: "s1", tokens: 5, window: 100, percent: 5, auto: true }));

		ws.close();
		vi.advanceTimersByTime(500);
		const next = sockets[1] as FakeSocket;
		next.open();
		next.feed(ready(false, { session: { id: "s1" } }));

		expect(store.get("s1").context?.tokens).toBe(5);
		stop();
	});

	it("children 的 usage.updated 只替换子 Bot 汇总，不丢 self/last", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(ready(false, { session: { id: "s1" } }));
		ws.feed(
			ev(1, "usage.updated", {
				session: "s1",
				scope: "self",
				totals: totals(10, 20),
				last: { ...totals(1, 2), cacheHitPct: 50 },
			}),
		);
		ws.feed(ev(2, "usage.updated", { session: "s1", scope: "children", totals: totals(1000, 2000) }));

		const usage = store.get("s1").usage;
		expect(usage?.self).toEqual(totals(10, 20));
		expect(usage?.children).toEqual(totals(1000, 2000));
		expect(usage?.last?.cacheHitPct).toBe(50);
		stop();
	});

	it("sessions.show 的扁平 totals 并入快照，不清掉事件带来的 children/last", () => {
		const state = reduceSessionState(
			{
				todos: [],
				subtasks: [],
				background: [],
				usage: {
					self: totals(10, 20),
					children: totals(1, 2),
					last: { ...totals(3, 4), cacheHitPct: 75 },
				},
			},
			{
				k: "snapshot",
				gap: false,
				// SAFETY: sessions.show include=meta 的 info.usage 是旧网关的扁平 UsageTotals。
				snap: { session: { id: "s1" }, usage: totals(30, 40) } as never,
			},
		);

		expect(state.usage?.self).toEqual(totals(30, 40));
		expect(state.usage?.children).toEqual(totals(1, 2));
		expect(state.usage?.last?.cacheHitPct).toBe(75);
	});

	it("compaction.started 后 finished 带上结果，goal 与 wakes 按全量替换", () => {
		const { sockets, store } = harness();
		const stop = store.subscribe("s1", () => undefined);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(ready(false, { session: { id: "s1" } }));
		ws.feed(ev(1, "compaction.started", { session: "s1", kind: "auto", before: 100_000 }));
		expect(store.get("s1").compaction).toEqual({ kind: "auto", before: 100_000, running: true });
		ws.feed(
			ev(2, "compaction.finished", { session: "s1", kind: "auto", before: 100_000, after: 9000, ms: 1200, ok: true }),
		);
		expect(store.get("s1").compaction).toEqual({
			kind: "auto",
			before: 100_000,
			after: 9000,
			ms: 1200,
			ok: true,
			running: false,
		});
		ws.feed(ev(3, "goal.updated", { session: "s1", goal: null }));
		expect(store.get("s1").goal).toBeNull();
		ws.feed(ev(4, "wake.updated", { session: "s1", rows: [] }));
		expect(store.get("s1").wakes).toEqual([]);
		stop();
	});
});
