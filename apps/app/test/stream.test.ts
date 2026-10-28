import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mux, type StreamHandlers, type StreamSocket } from "../src/transport/stream";

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
	subFrames() {
		return this.sent.filter((frame) => frame.t === "sub");
	}
}

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
	return { mux, sockets };
}

function record() {
	const ready: Array<{ result: unknown; gap: boolean }> = [];
	const events: Array<{ type: string; data: unknown }> = [];
	const ends: string[] = [];
	const handlers: StreamHandlers = {
		onReady: (result, gap) => ready.push({ result, gap }),
		onEvent: (type, data) => events.push({ type, data }),
		onEnd: (reason) => ends.push(reason),
	};
	return { handlers, ready, events, ends };
}

const ev = (seq: number, cursor: string, type = "run.ended", data: unknown = {}) => ({
	t: "ev",
	sub: "s1",
	seq,
	cursor,
	type,
	ts: "2026-10-27T00:00:00.000Z",
	data,
});
const readyFrame = (gap: boolean, cursor: string, result: unknown = {}) => ({
	t: "ready",
	sub: "s1",
	gap,
	cursor,
	result,
});

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("Mux 帧序列", () => {
	it("重连后新的 ready 归零 seq 基线，seq 重新从 1 起的补发不被丢", () => {
		const { mux, sockets } = harness();
		const h = record();
		mux.subscribe("sessions.watch", { id: "1" }, h.handlers);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		expect(ws.sent[0]).toEqual({ t: "sub", sub: "s1", method: "sessions.watch", params: { id: "1" } });

		ws.feed(readyFrame(false, "e1:2"));
		ws.feed(ev(1, "e1:3"));
		ws.feed(ev(2, "e1:4"));
		expect(h.events).toHaveLength(2);

		// 断线：新连接按 after 重订，服务端新一轮 seq 从 1 重新开始
		ws.close();
		vi.advanceTimersByTime(500);
		const next = sockets[1] as FakeSocket;
		next.open();
		expect(next.sent[0]).toEqual({
			t: "sub",
			sub: "s1",
			method: "sessions.watch",
			params: { id: "1" },
			after: "e1:4",
		});
		next.feed(readyFrame(false, "e1:4"));
		next.feed(ev(1, "e1:5"));
		next.feed(ev(2, "e1:6"));
		expect(h.events).toHaveLength(4);
	});

	it("同连接内 slow-consumer 重订后 ready 同样归零基线", () => {
		const { mux, sockets } = harness();
		const h = record();
		mux.subscribe("sessions.watch", { id: "1" }, h.handlers);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(readyFrame(false, "e1:9"));
		ws.feed(ev(1, "e1:10"));
		ws.feed(ev(2, "e1:11"));
		expect(h.events).toHaveLength(2);

		ws.feed({ t: "end", sub: "s1", reason: "error", error: { code: "unavailable", message: "slow-consumer" } });
		expect(ws.subFrames()).toHaveLength(2);
		expect(ws.subFrames()[1]).toMatchObject({ t: "sub", after: "e1:11" });

		ws.feed(readyFrame(false, "e1:11"));
		ws.feed(ev(1, "e1:12"));
		ws.feed(ev(2, "e1:13"));
		expect(h.events).toHaveLength(4);
	});

	it("并发重订（连续 end{error}）只发一次 sub", () => {
		const { mux, sockets } = harness();
		const h = record();
		mux.subscribe("sessions.watch", { id: "1" }, h.handlers);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(readyFrame(false, "e1:7"));

		ws.feed({ t: "end", sub: "s1", reason: "error" });
		ws.feed({ t: "end", sub: "s1", reason: "error" });
		expect(ws.subFrames()).toHaveLength(2);
		expect(h.ends).toEqual(["error", "error"]);

		// 新 ready 之后才允许下一次重订
		ws.feed(readyFrame(true, "e2:0"));
		ws.feed({ t: "end", sub: "s1", reason: "error" });
		expect(ws.subFrames()).toHaveLength(3);
		expect(ws.subFrames()[2]).toMatchObject({ t: "sub", after: "e2:0" });
	});

	it("同一 ready 窗口内按 seq 去重", () => {
		const { mux, sockets } = harness();
		const h = record();
		mux.subscribe("sessions.watch", { id: "1" }, h.handlers);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(readyFrame(false, "e1:0"));
		ws.feed(ev(1, "e1:1", "a"));
		ws.feed(ev(1, "e1:1", "a"));
		ws.feed(ev(2, "e1:2", "b"));
		expect(h.events.map((e) => e.type)).toEqual(["a", "b"]);
	});

	it("ready 的 gap 原样交给 onReady", () => {
		const { mux, sockets } = harness();
		const h = record();
		mux.subscribe("sessions.watch", { id: "1" }, h.handlers);
		const ws = sockets[0] as FakeSocket;
		ws.open();
		ws.feed(readyFrame(false, "e1:0", { session: { id: "1" } }));
		ws.feed(readyFrame(true, "e2:0", { session: { id: "1" } }));
		expect(h.ready).toEqual([
			{ result: { session: { id: "1" } }, gap: false },
			{ result: { session: { id: "1" } }, gap: true },
		]);
	});
});
