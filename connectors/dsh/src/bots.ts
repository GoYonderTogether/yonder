import { type HarnessEvent, type HarnessService, textOf } from "./adapter.js";
import type { CloudConnection } from "./connection.js";
import type { InboundFrame, OutboundFrame } from "./frames.js";

/** How long an outbound message waits for `sent` before it is reported unconfirmed (spec 16 §3). */
export const SEND_TIMEOUT_MS = 15_000;
const AGENT_SYNC_MS = 10 * 60_000;

export interface BotRegistration {
	/** Stable DSH agent key for this Bot (a preset id). */
	key: string;
	name: string;
}

export interface CloudApi {
	/** `PUT /api/device/agents`: this harness's complete agent list under the device. */
	putAgents(
		agents: Array<{ key: string; name: string; avatarUrl: string | null }>,
	): Promise<Array<{ key: string; id: string }>>;
}

export interface BotBridgeOptions {
	harness: HarnessService;
	connection: CloudConnection;
	api: CloudApi;
	/** The harness's current agents; every entry becomes a Bot on the account. */
	agents(): BotRegistration[] | Promise<BotRegistration[]>;
	/** Persist the delivery cursor after a message was fully handled. */
	onAck(agentId: string, convId: string, seq: number): void;
	/** Read the cursor so a replayed message is not delivered twice. */
	cursor(agentId: string, convId: string): number | undefined;
	bindSession(key: string, sessionId: string): void;
	sessionFor(key: string): string | undefined;
	unbindSession(key: string): void;
	log(message: string): void;
	now?(): number;
}

/**
 * Bot side of the device channel: registers the harness's agents as Bots, delivers
 * cloud messages into harness sessions, and returns the harness's replies. It keeps no
 * transcript: the harness owns the record (architecture invariant 4).
 */
export class BotBridge {
	private readonly pendingSends = new Map<
		string,
		{ timer: ReturnType<typeof setTimeout>; resolve(ok: boolean): void }
	>();
	private readonly replies = new Map<string, { agentId: string; convId: string; parts: string[] }>();
	private agents: Array<{ key: string; id: string }> = [];
	private syncTimer: ReturnType<typeof setInterval> | undefined;
	private stopped = false;

	constructor(private readonly options: BotBridgeOptions) {}

	get botAgents(): ReadonlyArray<{ key: string; id: string }> {
		return this.agents;
	}

	async start(): Promise<void> {
		await this.syncAgents().catch(() => {});
		this.options.connection.start();
		this.syncTimer = setInterval(() => void this.syncAgents().catch(() => {}), AGENT_SYNC_MS);
		this.syncTimer.unref?.();
	}

	/** Full-list reconciliation: keys this device stops reporting are retired by the cloud (spec 23 §2.2). */
	async syncAgents(): Promise<void> {
		if (this.stopped) return;
		const list = await this.options.agents();
		// An empty list means the harness could not enumerate agents; reporting it would retire every Bot.
		if (!list.length) return;
		this.agents = await this.options.api.putAgents(list.map(({ key, name }) => ({ key, name, avatarUrl: null })));
	}

	/** Handle a `message`, `sent` or `error` frame; returns true when the frame belongs here. */
	handle(frame: InboundFrame): boolean {
		if (frame.type === "sent") {
			if (frame.ref) this.settle(frame.ref);
			return true;
		}
		if (frame.type === "error") {
			if (frame.ref) this.fail(frame.ref);
			return true;
		}
		if (frame.type !== "message") return false;
		void this.deliver(frame).catch(() => {});
		return true;
	}

	private settle(ref: string): void {
		const pending = this.pendingSends.get(ref);
		if (!pending) return;
		this.pendingSends.delete(ref);
		clearTimeout(pending.timer);
		pending.resolve(true);
	}

	private fail(ref: string): void {
		const pending = this.pendingSends.get(ref);
		if (!pending) return;
		this.pendingSends.delete(ref);
		clearTimeout(pending.timer);
		pending.resolve(false);
	}

	/** Send one Bot message and wait for the cloud's `sent`; anything else is unconfirmed and never retried. */
	async send(agentId: string, convId: string, content: { type: "text" | "markdown"; text: string }): Promise<boolean> {
		const ref = `${agentId}:${convId}:${(this.options.now ?? Date.now)()}:${Math.random().toString(36).slice(2)}`;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingSends.delete(ref);
				resolve(false);
			}, SEND_TIMEOUT_MS);
			timer.unref?.();
			this.pendingSends.set(ref, { timer, resolve });
			const frame: OutboundFrame = { type: "send", ref, agentId, convId, content };
			if (!this.options.connection.send(frame)) {
				this.pendingSends.delete(ref);
				clearTimeout(timer);
				resolve(false);
			}
		});
	}

	/** Deliver one cloud `message` into its Bot's harness session, then acknowledge it. */
	async deliver(frame: Extract<InboundFrame, { type: "message" }>): Promise<void> {
		const key = this.agents.find((row) => row.id === frame.agentId)?.key;
		if (!key) {
			this.options.log("一条发给未登记 Bot 的消息被忽略");
			return;
		}
		const delivered = this.options.cursor(frame.agentId, frame.convId);
		if (delivered !== undefined && frame.message.seq <= delivered) return;
		const input = composeInput(frame);
		if (input === undefined) {
			// The cloud accepts this content type but the harness cannot show it. Acknowledge so the
			// server stops replaying, and say so in the conversation instead of dropping it silently.
			this.ack(frame.agentId, frame.convId, frame.message.seq);
			await this.send(frame.agentId, frame.convId, {
				type: "text",
				text: "这条消息的内容类型（卡片、图片或文件）暂不支持在 DeepSeek Harness 中显示。",
			}).catch(() => {});
			return;
		}
		let sessionId: string;
		try {
			sessionId = await this.sessionFor(key);
			await this.options.harness.submit(sessionId, input, new AbortController().signal);
		} catch (error) {
			// No ack: the server keeps the cursor where it was, so the message is redelivered on reconnect.
			this.options.log(`消息投递失败：${error instanceof Error ? error.message : "unknown"}`);
			return;
		}
		this.replies.set(sessionId, { agentId: frame.agentId, convId: frame.convId, parts: [] });
		this.ack(frame.agentId, frame.convId, frame.message.seq);
	}

	private ack(agentId: string, convId: string, seq: number): void {
		this.options.onAck(agentId, convId, seq);
		this.options.connection.send({ type: "ack", agentId, convId, seq });
	}

	/** Harness events: collect the Bot's reply text and return it to the cloud conversation. */
	async onHarnessEvent(event: HarnessEvent): Promise<void> {
		const reply = this.replies.get(event.sessionId);
		if (!reply) return;
		if (event.type === "assistant/message") {
			const text = textOf((event.data as { message?: { content?: unknown } })?.message?.content);
			if (text.trim()) reply.parts.push(text);
			return;
		}
		if (event.type !== "turn/end") return;
		this.replies.delete(event.sessionId);
		const text = reply.parts.join("\n").trim();
		if (!text) return;
		if (!(await this.send(reply.agentId, reply.convId, { type: "markdown", text }).catch(() => false)))
			this.options.log("一条 Bot 回复未被云端确认，未自动重发");
	}

	private async sessionFor(key: string): Promise<string> {
		const recorded = this.options.sessionFor(key);
		if (recorded && (await this.options.harness.show(recorded, new AbortController().signal).catch(() => undefined)))
			return recorded;
		if (recorded) this.options.unbindSession(key);
		const created = await this.options.harness.create({ preset: key }, new AbortController().signal);
		this.options.bindSession(key, created.sessionId);
		return created.sessionId;
	}

	stop(): void {
		this.stopped = true;
		if (this.syncTimer) clearInterval(this.syncTimer);
		for (const pending of this.pendingSends.values()) {
			clearTimeout(pending.timer);
			pending.resolve(false);
		}
		this.pendingSends.clear();
		this.replies.clear();
	}
}

/**
 * The input handed to the harness for one cloud message. A replayed message keeps the
 * "补收" marker so an old instruction is never taken for the current one (spec 16 §3).
 * Returns undefined for content the harness cannot carry.
 */
export function composeInput(frame: Extract<InboundFrame, { type: "message" }>): string | undefined {
	const content = frame.message.content as { type?: unknown; text?: unknown };
	if (content.type !== "text" && content.type !== "markdown") return undefined;
	const text = typeof content.text === "string" ? content.text : "";
	if (!text.trim()) return undefined;
	if (frame.replayed) {
		const at = new Date(frame.message.createdAt).toISOString();
		return `[补收：这条消息发于 ${at}，设备离线期间未送达。若其中的操作已被之后的消息取代，不要再执行，先向对方确认。]\n${text}`;
	}
	const from = frame.message.senderName ?? "对方";
	const place = frame.convKind === "group" ? "群聊" : "私聊";
	return `[Yonder ${place} · ${from}]\n${text}`;
}
