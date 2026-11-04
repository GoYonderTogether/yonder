import type { HarnessService, HarnessUpdate } from "./adapter.js";
import type { CloudConnection } from "./connection.js";
import type { InboundFrame } from "./frames.js";

const MAX_SUBS = 64;

interface Subscription {
	abort: AbortController;
	ready: boolean;
	queued: HarnessUpdate[];
	seq: number;
	stop?: () => Promise<void>;
}

/**
 * The work bridge (spec 23 §2.4): request/response for the five session methods and the
 * `sessions.watch` subscription relaying DSH events inside `work.open`/`work.frame`/
 * `work.event`. Frames are the gateway's own shapes so the web client needs no special case.
 */
export class WorkBridge {
	private readonly requests = new Map<string, AbortController>();
	private readonly channels = new Map<string, Map<string, Subscription>>();

	constructor(
		private readonly harness: HarnessService,
		private readonly connection: CloudConnection,
		/** Facts the connector reports about itself (host identity). */
		public nodeId = "",
		public nodeName = "",
	) {}

	/** Handle a `work.*` frame; returns true when the frame belongs to the work bridge. */
	handle(frame: InboundFrame): boolean {
		switch (frame.type) {
			case "work.request":
				void this.request(frame).catch(() => {});
				return true;
			case "work.cancel":
				this.requests.get(frame.requestId)?.abort();
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

	private async request(frame: Extract<InboundFrame, { type: "work.request" }>): Promise<void> {
		if (this.requests.has(frame.requestId)) return;
		const controller = new AbortController();
		this.requests.set(frame.requestId, controller);
		try {
			const result = await this.call(frame.method, frame.params, controller.signal);
			this.connection.send({ type: "work.response", requestId: frame.requestId, ok: true, result });
		} catch (error) {
			this.connection.send({
				type: "work.response",
				requestId: frame.requestId,
				ok: false,
				error: {
					code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "error",
					message: error instanceof Error ? error.message : "error",
				},
			});
		} finally {
			this.requests.delete(frame.requestId);
		}
	}

	private async call(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
		const input = (params ?? {}) as Record<string, unknown>;
		switch (method) {
			case "capabilities.get":
				return this.facts();
			case "sessions.list": {
				const rows = await this.harness.list(signal);
				return rows.map((row) => infoOf(row));
			}
			case "sessions.open": {
				const id = typeof input.id === "string" && input.id ? input.id : undefined;
				if (id) {
					const session = await this.harness.show(id, signal);
					if (!session) throw notFound(id);
					return infoOf(session);
				}
				const created = await this.harness.create(
					{
						...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
						...(typeof input.preset === "string" ? { preset: input.preset } : {}),
					},
					signal,
				);
				const session = await this.harness.show(created.sessionId, signal);
				if (!session) throw new Error("The harness created no session");
				return infoOf(session);
			}
			case "sessions.submit": {
				const id = requiredId(input.id);
				const text = typeof input.text === "string" ? input.text : "";
				if (!text.trim()) throw invalid("text is required");
				await this.harness.submit(id, text, signal);
				return { event: "session.input", session: id };
			}
			case "sessions.transcript": {
				const id = requiredId(input.id);
				const limit = integer(input.limit, 50, 1, 500);
				const before = typeof input.before === "number" ? Math.floor(input.before) : undefined;
				return this.harness.transcript(id, { limit, ...(before === undefined ? {} : { before }) }, signal);
			}
			case "sessions.abort":
				await this.harness.abort(requiredId(input.id), signal);
				return { ok: true };
			default:
				// A method this connector does not implement is reported as such, never left to time out.
				throw unsupported(method);
		}
	}

	private facts() {
		return {
			protocol: 1,
			minor: 1,
			kind: "remote",
			version: { yonder: "dsh-connector", commit: null },
			node: { id: this.nodeId, name: this.nodeName },
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
			plugins: [],
			granted: ["read", "write", "owner"],
			views: [],
			models: { select: false },
			remoteSession: { create: true, modes: ["task"], agents: [], workspaces: false },
			limits: { maxSubs: MAX_SUBS, attachmentMaxBytes: 0, transcriptPage: 50 },
			features: {
				requestIdDedupe: false,
				resumableWatch: false,
				attachments: false,
				notifications: false,
				approvals: false,
				suggestions: false,
			},
			auth: { kind: "remote", owner: true },
		};
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
			this.end(channelId, sub, "error", unsupported(String(message.method)));
			return;
		}
		if (subs.has(sub) || subs.size >= MAX_SUBS) {
			this.end(channelId, sub, "error", busy("too many subscriptions"));
			return;
		}
		void this.subscribe(channelId, sub, message.params);
	}

	private async subscribe(channelId: string, sub: string, params: unknown): Promise<void> {
		const subs = this.channels.get(channelId);
		if (!subs) return;
		const id = (params as { id?: unknown } | undefined)?.id;
		if (typeof id !== "string" || !id) return this.end(channelId, sub, "error", invalid("id is required"));
		const controller = new AbortController();
		const entry: Subscription = { abort: controller, ready: false, queued: [], seq: 0 };
		subs.set(sub, entry);
		const emit = (update: HarnessUpdate) => {
			if (controller.signal.aborted || this.channels.get(channelId) !== subs) return;
			this.event(channelId, {
				t: "ev",
				sub,
				seq: ++entry.seq,
				cursor: "",
				type: "session.update",
				ts: new Date().toISOString(),
				data: update,
			});
		};
		try {
			const [session, transcript] = await Promise.all([
				this.harness.show(id, controller.signal),
				this.harness.transcript(id, { limit: 50 }, controller.signal),
			]);
			if (!session) throw notFound(id);
			entry.stop = await this.harness.follow(
				id,
				(update) => {
					if (entry.ready) emit(update);
					else if (entry.queued.length < 500) entry.queued.push(update);
				},
				controller.signal,
			);
			// The bridge never promises a durable cursor: every subscription opens from the live
			// snapshot, so `gap` is always true (spec 19 §3).
			this.event(channelId, {
				t: "ready",
				sub,
				gap: true,
				cursor: "",
				result: snapshot(session, transcript),
			});
			entry.ready = true;
			for (const update of entry.queued.splice(0)) emit(update);
		} catch (error) {
			this.end(channelId, sub, "error", error);
		}
	}

	private event(channelId: string, frame: unknown): void {
		if (!this.channels.has(channelId)) return;
		this.connection.send({ type: "work.event", channelId, frame });
	}

	private end(channelId: string, sub: string, reason: string, error?: unknown): void {
		const entry = this.channels.get(channelId)?.get(sub);
		this.channels.get(channelId)?.delete(sub);
		entry?.abort.abort();
		void entry?.stop?.().catch(() => {});
		this.event(channelId, {
			t: "end",
			sub,
			reason,
			...(reason === "error"
				? {
						error: {
							code:
								typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "error",
							message: error instanceof Error ? error.message : "error",
						},
					}
				: {}),
		});
	}

	close(channelId: string): void {
		const subs = this.channels.get(channelId);
		if (!subs) return;
		this.channels.delete(channelId);
		for (const sub of [...subs.keys()]) this.end(channelId, sub, "closed");
	}

	stop(): void {
		for (const channelId of [...this.channels.keys()]) this.close(channelId);
		for (const controller of this.requests.values()) controller.abort();
		this.requests.clear();
	}
}

/** Session facts the web client needs; transcript bodies stay in the harness. */
export function infoOf(session: {
	id: string;
	title?: string;
	updatedAt: number;
	agentPreset?: string;
}): Record<string, unknown> {
	return {
		id: session.id,
		agent: null,
		profile: session.agentPreset ?? "default",
		mode: "task",
		key: session.id,
		version: "1",
		opened: new Date(session.updatedAt).toISOString(),
		...(session.title ? { title: session.title } : {}),
	};
}

function snapshot(
	session: Parameters<typeof infoOf>[0] & {
		model?: { provider: string; model: string; contextWindow?: number; effort?: string };
	},
	transcript: { items: unknown[]; hasMore: boolean },
) {
	const info = infoOf(session);
	return {
		session: info,
		info: {
			session: info,
			config: {},
			usage: {},
			skills: {},
			...(session.model
				? {
						model: {
							id: session.model.model,
							provider: session.model.provider,
							contextWindow: session.model.contextWindow ?? 0,
							reasoning: Boolean(session.model.effort),
						},
					}
				: {}),
		},
		transcript,
	};
}

function requiredId(value: unknown): string {
	if (typeof value !== "string" || !value) throw invalid("id is required");
	return value;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

const invalid = (message: string) => Object.assign(new Error(message), { code: "invalid_params" });
const notFound = (id: string) => Object.assign(new Error(`Unknown session: ${id}`), { code: "not_found" });
const busy = (message: string) => Object.assign(new Error(message), { code: "unavailable" });
const unsupported = (method: string) =>
	Object.assign(new Error(`Method ${method} is not supported by the Yonder DSH connector`), { code: "unsupported" });
