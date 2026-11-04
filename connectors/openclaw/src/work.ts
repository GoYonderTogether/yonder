/**
 * Work bridge (spec 23 §2.4): request/response for the five session methods and
 * the `sessions.watch` subscription relayed inside `work.open`/`work.frame`/
 * `work.event`. Frames are the gateway's own shapes so the web client needs no
 * special case. Identical wire subset to the DSH and Hermes connectors.
 */

import type { SessionGateway, HarnessUpdate } from "./sessions.js";
import type { OutboundConnection } from "./connector.js";
import type { InboundFrame } from "./frames.js";

const MAX_SUBS = 64;

export class UnsupportedMethod extends Error {
	code = "unsupported";
	constructor(method: string) {
		super(`Method ${method} is not supported by the Yonder OpenClaw connector`);
	}
}
export class InvalidParams extends Error {
	code = "invalid_params";
}
export class NotFound extends Error {
	code = "not_found";
	constructor(id: string) {
		super(`Unknown session: ${id}`);
	}
}

interface Subscription {
	ready: boolean;
	queued: HarnessUpdate[];
	seq: number;
	stop?: () => void;
}

export class WorkBridge {
	private readonly requests = new Set<string>();
	private readonly channels = new Map<string, Map<string, Subscription>>();
	private readonly tasks = new Set<Promise<unknown>>();

	constructor(
		private readonly gateway: SessionGateway,
		private readonly connection: OutboundConnection,
		nodeId = "",
		nodeName = "",
	) {
		void nodeId;
		void nodeName;
	}

	/** Handle a `work.*` frame; returns true when the frame belongs to the work bridge. */
	handle(frame: InboundFrame): boolean {
		switch (frame.type) {
			case "work.request":
				this.spawn(this.request(frame));
				return true;
			case "work.cancel":
				// Requests are answered once; a cancel for an unknown id is inert.
				return true;
			case "work.open":
				if (!this.channels.has(frame.channelId)) this.channels.set(frame.channelId, new Map());
				return true;
			case "work.frame":
				this.frame(frame.channelId, frame.frame);
				return true;
			case "work.close":
				this.close(frame.channelId);
				return true;
			default:
				return false;
		}
	}

	private spawn(task: Promise<unknown>): void {
		const tracked = task.catch(() => {}).finally(() => this.tasks.delete(tracked));
		this.tasks.add(tracked);
	}

	private async request(frame: Extract<InboundFrame, { type: "work.request" }>): Promise<void> {
		if (this.requests.has(frame.requestId)) return;
		this.requests.add(frame.requestId);
		try {
			const result = await this.call(frame.method ?? "", frame.params);
			this.connection.send({ type: "work.response", requestId: frame.requestId, ok: true, result });
		} catch (error) {
			this.connection.send({
				type: "work.response",
				requestId: frame.requestId,
				ok: false,
				error: {
					code:
						typeof (error as { code?: unknown })?.code === "string"
							? String((error as { code: unknown }).code)
							: "error",
					message: error instanceof Error ? error.message : "error",
				},
			});
		} finally {
			this.requests.delete(frame.requestId);
		}
	}

	private async call(method: string, params: unknown): Promise<unknown> {
		const input = (params ?? {}) as Record<string, unknown>;
		switch (method) {
			case "capabilities.get":
				return {
					protocol: 1,
					minor: 1,
					kind: "remote",
					version: { yonder: "openclaw-connector", commit: null },
					methods: {
						"capabilities.get": { scope: "read", since: 1 },
						"sessions.list": { scope: "read", since: 1 },
						"sessions.open": { scope: "write", since: 1 },
						"sessions.submit": { scope: "write", since: 1 },
						"sessions.transcript": { scope: "read", since: 1 },
						"sessions.abort": { scope: "write", since: 1 },
						"sessions.watch": { scope: "read", stream: true, since: 1 },
					},
					events: ["session.update"],
					limits: { maxSubs: MAX_SUBS, attachmentMaxBytes: 0, transcriptPage: 50 },
				};
			case "sessions.list": {
				const rows = await this.gateway.list();
				return rows.map((row) => infoOf(row));
			}
			case "sessions.open": {
				const id = typeof input.id === "string" && input.id ? input.id : undefined;
				if (id) {
					const session = await this.gateway.show(id);
					if (!session) throw new NotFound(id);
					return infoOf(session);
				}
				const created = await this.gateway.create({
					...(typeof input.agentId === "string" ? { agentId: input.agentId } : {}),
					...(typeof input.title === "string" ? { title: input.title } : {}),
				});
				const session = await this.gateway.show(created.sessionKey);
				if (!session) throw new Error("The gateway created no session");
				return infoOf(session);
			}
			case "sessions.submit": {
				const id = requiredId(input.id);
				const text = typeof input.text === "string" ? input.text : "";
				if (!text.trim()) throw new InvalidParams("text is required");
				await this.gateway.submit(id, text);
				return { event: "session.input", session: id };
			}
			case "sessions.transcript": {
				const id = requiredId(input.id);
				const limit = integer(input.limit, 50, 1, 500);
				const before = typeof input.before === "number" ? Math.floor(input.before) : undefined;
				return this.gateway.transcript(id, limit, before);
			}
			case "sessions.abort":
				await this.gateway.abort(requiredId(input.id));
				return { ok: true };
			default:
				// A method this connector does not implement is reported as such,
				// never left to time out (spec 23 §2.4).
				throw new UnsupportedMethod(method);
		}
	}

	// ---- one gateway-shaped stream relayed inside the device channel ----

	private frame(channelId: string, value: unknown): void {
		const subs = this.channels.get(channelId);
		if (!subs || !value || typeof value !== "object") return;
		const message = value as Record<string, unknown>;
		if (message.t === "ping") {
			this.event(channelId, { t: "pong", ...(typeof message.n === "number" ? { n: message.n } : {}) });
			return;
		}
		const sub = typeof message.sub === "string" ? message.sub : undefined;
		if (!sub) return;
		if (message.t === "unsub") {
			this.end(channelId, sub, "unsub");
			return;
		}
		if (message.t !== "sub") return;
		if (message.method !== "sessions.watch") {
			this.end(channelId, sub, "error", new UnsupportedMethod(String(message.method)));
			return;
		}
		if (subs.has(sub) || subs.size >= MAX_SUBS) {
			this.end(channelId, sub, "error", new Error("too many subscriptions"));
			return;
		}
		const entry: Subscription = { ready: false, queued: [], seq: 0 };
		subs.set(sub, entry);
		this.spawn(this.subscribe(channelId, sub, message.params, entry));
	}

	private async subscribe(channelId: string, sub: string, params: unknown, entry: Subscription): Promise<void> {
		const subs = this.channels.get(channelId);
		if (!subs) return;
		const id = (params as { id?: unknown } | undefined)?.id;
		if (typeof id !== "string" || !id) return this.end(channelId, sub, "error", new InvalidParams("id is required"));
		const emit = (update: HarnessUpdate) => {
			if (this.channels.get(channelId) !== subs) return;
			if (entry.ready) {
				this.sendUpdate(channelId, sub, entry, update);
			} else if (entry.queued.length < 500) {
				entry.queued.push(update);
			}
		};
		try {
			const session = await this.gateway.show(id);
			if (!session) throw new NotFound(id);
			const transcript = await this.gateway.transcript(id, 50);
			const stop = this.gateway.follow(id, emit);
			entry.stop = stop;
			// The bridge never promises a durable cursor: every subscription opens
			// from the live snapshot, so `gap` is always true (spec 19 §3).
			this.event(channelId, {
				t: "ready",
				sub,
				gap: true,
				cursor: "",
				result: snapshotOf(session, transcript),
			});
			entry.ready = true;
			for (const update of entry.queued.splice(0)) this.sendUpdate(channelId, sub, entry, update);
		} catch (error) {
			this.end(channelId, sub, "error", error instanceof Error ? error : new Error(String(error)));
		}
	}

	private sendUpdate(channelId: string, sub: string, entry: Subscription, update: HarnessUpdate): void {
		entry.seq += 1;
		this.event(channelId, {
			t: "ev",
			sub,
			seq: entry.seq,
			cursor: "",
			type: "session.update",
			ts: new Date().toISOString(),
			data: update,
		});
	}

	private event(channelId: string, frame: unknown): void {
		if (!this.channels.has(channelId)) return;
		this.connection.send({ type: "work.event", channelId, frame });
	}

	private end(channelId: string, sub: string, reason: string, error?: Error): void {
		const subs = this.channels.get(channelId);
		const entry = subs?.get(sub);
		subs?.delete(sub);
		entry?.stop?.();
		const payload: Record<string, unknown> = { t: "end", sub, reason };
		if (reason === "error") {
			const code = error !== undefined && typeof (error as unknown as { code?: unknown })?.code === "string"
				? String((error as unknown as { code: unknown }).code)
				: "error";
			payload.error = {
				code,
				message: error?.message ?? "error",
			};
		}
		this.event(channelId, payload);
	}

	close(channelId: string): void {
		const subs = this.channels.get(channelId);
		if (!subs) return;
		this.channels.delete(channelId);
		for (const sub of [...subs.keys()]) this.end(channelId, sub, "closed");
	}

	stop(): void {
		for (const channelId of [...this.channels.keys()]) this.close(channelId);
		this.requests.clear();
	}
}

/** Session facts the web client needs; transcript bodies stay in OpenClaw. */
export function infoOf(session: {
	id: string;
	title?: string;
	updatedAt: number;
	agentId?: string;
}): Record<string, unknown> {
	return {
		id: session.id,
		agent: null,
		profile: session.agentId ?? "default",
		mode: "task",
		key: session.id,
		version: "1",
		opened: new Date(session.updatedAt).toISOString(),
		...(session.title ? { title: session.title } : {}),
	};
}

function snapshotOf(
	session: { id: string; title?: string; updatedAt: number; agentId?: string },
	transcript: { items: unknown[]; hasMore: boolean },
): unknown {
	const info = infoOf(session);
	return {
		session: info,
		info: { session: info, config: {}, usage: {}, skills: {} },
		transcript,
	};
}

function requiredId(value: unknown): string {
	if (typeof value !== "string" || !value) throw new InvalidParams("id is required");
	return value;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}
