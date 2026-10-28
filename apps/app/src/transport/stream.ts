import { wsUrl } from "./client";
import type { ServerFrame } from "./types";

export type ConnState = "connecting" | "open" | "down";
export interface StreamHandlers {
	/** gap=true 或首次：result 是完整当前状态，丢弃本地增量缓存重建。 */
	onReady(result: unknown, gap: boolean): void;
	onEvent(type: string, data: unknown, ts: string): void;
	onEnd?(reason: string): void;
}
interface Sub {
	sub: string;
	method: string;
	params: unknown;
	cursor?: string;
	lastSeq: number;
	handlers: StreamHandlers;
}

/** 单连接多路复用（contracts §2）。断线指数退避重连，带 after 游标重订，补齐漏掉的事件。 */
class Mux {
	private ws?: WebSocket;
	private subs = new Map<string, Sub>();
	private listeners = new Set<(s: ConnState) => void>();
	private n = 0;
	private retry = 0;
	private timer?: ReturnType<typeof setTimeout>;
	private ping?: ReturnType<typeof setInterval>;
	private lastFrame = 0;
	state: ConnState = "connecting";

	onState(fn: (s: ConnState) => void) {
		this.listeners.add(fn);
		return () => void this.listeners.delete(fn);
	}
	private set(s: ConnState) {
		if (this.state === s) return;
		this.state = s;
		for (const fn of this.listeners) fn(s);
	}

	subscribe(method: string, params: unknown, handlers: StreamHandlers): () => void {
		const sub: Sub = { sub: `s${++this.n}`, method, params, lastSeq: 0, handlers };
		this.subs.set(sub.sub, sub);
		this.connect();
		this.send({ t: "sub", sub: sub.sub, method, params });
		return () => {
			this.subs.delete(sub.sub);
			this.send({ t: "unsub", sub: sub.sub });
			if (this.subs.size === 0) this.close();
		};
	}

	private send(frame: Record<string, unknown>) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
	}

	private connect() {
		if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
		clearTimeout(this.timer);
		this.set(this.retry === 0 && this.state !== "down" ? "connecting" : "down");
		const ws = new WebSocket(wsUrl());
		this.ws = ws;
		ws.onopen = () => {
			this.retry = 0;
			this.lastFrame = Date.now();
			this.set("open");
			for (const s of this.subs.values()) {
				this.send({
					t: "sub",
					sub: s.sub,
					method: s.method,
					params: s.params,
					...(s.cursor ? { after: s.cursor } : {}),
				});
			}
			clearInterval(this.ping);
			this.ping = setInterval(() => {
				if (Date.now() - this.lastFrame > 60_000) ws.close();
				else this.send({ t: "ping" });
			}, 25_000);
		};
		ws.onmessage = (e) => {
			this.lastFrame = Date.now();
			let f: ServerFrame;
			try {
				f = JSON.parse(String(e.data));
			} catch {
				return;
			}
			this.dispatch(f);
		};
		ws.onclose = () => {
			clearInterval(this.ping);
			this.ws = undefined;
			if (this.subs.size === 0) return;
			this.set("down");
			const delay = Math.min(15_000, 500 * 2 ** this.retry++);
			this.timer = setTimeout(() => this.connect(), delay);
		};
		ws.onerror = () => ws.close();
	}

	private dispatch(f: ServerFrame) {
		if (f.t === "pong") return;
		const s = this.subs.get(f.sub);
		if (!s) return;
		if (f.t === "ready") {
			s.cursor = f.cursor;
			s.handlers.onReady(f.result, f.gap);
		} else if (f.t === "ev") {
			// 按 (sub, seq) 去重；seq 不连续不报错
			if (f.seq <= s.lastSeq && f.seq !== 1) return;
			s.lastSeq = f.seq;
			s.cursor = f.cursor;
			s.handlers.onEvent(f.type, f.data, f.ts);
		} else if (f.t === "end") {
			s.handlers.onEnd?.(f.reason);
			// slow-consumer 等：用游标重订
			if (f.reason === "error")
				this.send({ t: "sub", sub: s.sub, method: s.method, params: s.params, after: s.cursor });
		}
	}

	private close() {
		clearTimeout(this.timer);
		clearInterval(this.ping);
		this.ws?.close();
		this.ws = undefined;
	}

	/** 登出或换令牌时彻底断开。 */
	reset() {
		this.subs.clear();
		this.retry = 0;
		this.close();
		this.set("connecting");
	}
}

export const mux = new Mux();
