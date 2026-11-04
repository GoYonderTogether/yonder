/**
 * The local Gateway WebSocket client (spec 23 §3: 连接器读会话只经 harness 的
 * 进程内接口或该框架官方对外接口). This file is the ONE place that knows the
 * OpenClaw Gateway protocol: the connect handshake, request/response, and the
 * event stream. Everything else deals in connector vocabulary.
 *
 * Wire shapes (OpenClaw 2026.10.10):
 *   server → client : {type:"event", event:"connect.challenge", payload:{nonce, ts}}
 *   client → server : {type:"req", id, method:"connect", params:{...}}
 *   server → client : {type:"res", id, ok, payload:{type:"hello-ok", ...}}
 *   afterwards      : {type:"res", id, ok, payload|error} for each request and
 *                     {type:"event", event, payload} broadcasts.
 */

import { cloudUrl } from "./net.js";

const CONNECT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_MAX_MS = 30_000;
const FIRST_DELAY_MS = 1_000;

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

/** The loose socket shape the OpenClaw-bundled `ws` provides. */
type WsSocket = {
	send(data: string): void;
	close(): void;
	readyState: number;
	on(ev: string, cb: (...a: unknown[]) => void): void;
	off(ev: string, cb: (...a: unknown[]) => void): void;
};

export interface GatewayOptions {
	/** `ws://127.0.0.1:<port>` resolved by the caller from the OpenClaw config. */
	url: string;
	/** The shared gateway auth token (`gateway.auth.token`, token auth mode). */
	token?: string;
	onEvent: (event: { event: string; payload: unknown }) => void;
	onClose?: (reason: string) => void;
	onHello?: (hello: { serverVersion?: string; features: { methods: string[]; events: string[] } }) => void;
}

export class GatewayClient {
	private socket: WsSocket | undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private delay = FIRST_DELAY_MS;
	private stopped = false;
	private open = false;
	private nextId = 0;
	private readonly pending = new Map<string, Pending>();
	private readonly tasks = new Set<Promise<unknown>>();

	constructor(private readonly options: GatewayOptions) {}

	get connected(): boolean {
		return this.open;
	}

	start(): void {
		if (this.stopped) return;
		const task = this.loop();
		this.tasks.add(task);
		void task.catch(() => {}).finally(() => this.tasks.delete(task));
	}

	private async loop(): Promise<void> {
		while (!this.stopped) {
			try {
				await this.connectOnce();
			} catch (error) {
				process.stderr.write(`[yonder] gateway client error: ${error instanceof Error ? error.message : error}\n`);
			}
			if (this.stopped) return;
			const delay = this.delay;
			this.delay = Math.min(RECONNECT_MAX_MS, this.delay * 2);
			await new Promise<void>((resolve) => {
				this.retry = setTimeout(resolve, delay);
				this.retry.unref?.();
			});
		}
	}

	private async connectOnce(): Promise<void> {
		const WsConstructor = (await import("ws")).WebSocket;
		const socket = new WsConstructor(this.options.url, {
			headers: this.options.token ? { authorization: `Bearer ${this.options.token}` } : undefined,
			maxPayload: 25 * 1024 * 1024,
		}) as unknown as WsSocket;
		this.socket = socket;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("gateway connect timeout")), CONNECT_TIMEOUT_MS);
			const onOpen = () => {
				clearTimeout(timer);
				cleanup();
				resolve();
			};
			const onError = () => {
				clearTimeout(timer);
				cleanup();
				reject(new Error("gateway connect failed"));
			};
			const cleanup = () => {
				socket.off("open", onOpen);
				socket.off("error", onError);
			};
			socket.on("open", onOpen);
			socket.on("error", onError);
		});
		this.open = true;
		this.delay = FIRST_DELAY_MS;

		// The gateway sends a pre-connect challenge; the handshake completes with
		// the `connect` request whose reply is the hello-ok payload.
		const challenge = await this.request("connect", this.connectParams(), {
			timeoutMs: CONNECT_TIMEOUT_MS,
		});
		const hello = (challenge ?? {}) as Record<string, unknown>;
		if (hello.type !== "hello-ok") {
			throw new Error("gateway did not accept the connect handshake");
		}
		const features = (hello.features ?? {}) as { methods?: string[]; events?: string[] };
		this.options.onHello?.({
			serverVersion: String((hello.server as Record<string, unknown> | undefined)?.version ?? ""),
			features: { methods: features.methods ?? [], events: features.events ?? [] },
		});
		await this.pump(socket);
	}

	private connectParams(): Record<string, unknown> {
		return {
			minProtocol: 4,
			maxProtocol: 4,
			client: {
				id: "gateway-client",
				version: "0.3.26110400",
				platform: process.platform,
				mode: "backend",
			},
			role: "operator",
			scopes: ["operator.read", "operator.write"],
			caps: [],
			commands: [],
			permissions: {},
			...(this.options.token ? { auth: { token: this.options.token } } : {}),
			locale: "zh-CN",
			userAgent: "yonder-openclaw-connector/0.3",
		};
	}

	/**
	 * Dispatch one wire frame: a `res` resolves its pending request, an `event`
	 * goes to the connector. Shared by the handshake (before the pump) and the
	 * pump itself.
	 */
	private dispatch(frame: Record<string, unknown>): void {
		if (frame.type === "res") {
			const id = typeof frame.id === "string" ? frame.id : undefined;
			if (!id) return;
			const pending = this.pending.get(id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(id);
			if (frame.ok === true) pending.resolve(frame.payload);
			else
				pending.reject(
					new Error(String((frame.error as Record<string, unknown> | undefined)?.message ?? "gateway error")),
				);
			return;
		}
		if (frame.type === "event" && typeof frame.event === "string") {
			this.options.onEvent({ event: frame.event, payload: frame.payload });
		}
	}

	private async pump(socket: WsSocket): Promise<void> {
		for await (const raw of framesOf(socket)) {
			if (this.stopped) return;
			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch {
				continue;
			}
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			this.dispatch(value as Record<string, unknown>);
		}
	}

	private nextRequestId(): string {
		this.nextId += 1;
		return `yonder-${this.nextId}`;
	}

	send(frame: unknown): boolean {
		const socket = this.socket;
		if (!socket || !this.open || socket.readyState !== 1) return false;
		try {
			socket.send(JSON.stringify(frame));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * One request/response round trip. The reply is read off THIS socket
	 * directly: the pump only starts after the handshake, so the connect
	 * response would otherwise never be read. Other frames go through
	 * `dispatch` (events reach the connector; other res frames resolve their
	 * own pending entries).
	 */
	async request(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown> {
		const id = this.nextRequestId();
		const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
		const socket = this.socket;
		if (!socket || !this.open) throw new Error("gateway connection is not open");
		const promise = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`gateway request timed out (${method})`));
			}, timeoutMs);
			timer.unref?.();
			this.pending.set(id, { resolve, reject, timer });
		});
		if (!this.send({ type: "req", id, method, params })) {
			const pending = this.pending.get(id);
			this.pending.delete(id);
			if (pending) clearTimeout(pending.timer);
			throw new Error("gateway connection is not open");
		}
		for await (const raw of framesOf(socket)) {
			if (this.stopped) throw new Error("gateway connection closed");
			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch {
				continue;
			}
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			const frame = value as Record<string, unknown>;
			if (frame.type === "res" && frame.id === id) {
				const pending = this.pending.get(id);
				if (pending) clearTimeout(pending.timer);
				this.pending.delete(id);
				if (frame.ok === true) return frame.payload;
				throw new Error(String((frame.error as Record<string, unknown> | undefined)?.message ?? "gateway error"));
			}
			this.dispatch(frame);
		}
		throw new Error("gateway connection closed");
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = undefined;
		for (const [, pending] of this.pending) clearTimeout(pending.timer);
		this.pending.clear();
		const socket = this.socket;
		this.socket = undefined;
		this.open = false;
		if (socket) {
			try {
				socket.close();
			} catch {
				/* Already closed. */
			}
		}
		await Promise.allSettled([...this.tasks]);
	}
}

async function* framesOf(socket: WsSocket): AsyncGenerator<string> {
	const queue: string[] = [];
	const wake: (() => void)[] = [];
	let ended = false;
	const notify = () => {
		const next = wake.shift();
		next?.();
	};
	socket.on("message", (data: unknown) => {
		const text = typeof data === "string" ? data : String(data);
		queue.push(text);
		notify();
	});
	const end = () => {
		ended = true;
		notify();
	};
	socket.on("close", end);
	socket.on("error", end);
	while (!ended) {
		while (queue.length > 0) {
			const item = queue.shift();
			if (item !== undefined) yield item;
		}
		await new Promise<void>((resolve) => wake.push(resolve));
	}
	while (queue.length > 0) {
		const item = queue.shift();
		if (item !== undefined) yield item;
	}
}

export { cloudUrl };
