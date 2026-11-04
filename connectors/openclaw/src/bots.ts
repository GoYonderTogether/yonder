/**
 * Bot side of the device channel: registers the gateway's agents as Bots,
 * delivers cloud messages into OpenClaw sessions, and returns the replies.
 * It keeps no transcript: the gateway owns the record (invariant 4).
 */

import { composeCloudInput, type OutboundConnection } from "./connector.js";
import type { InboundFrame } from "./frames.js";

export const SEND_TIMEOUT_MS = 15_000;
const AGENT_SYNC_MS = 10 * 60_000;

export interface BotRegistration {
	/** Stable OpenClaw agent key for this Bot (its agent id). */
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
	gateway: {
		/** Local session for a Bot conversation, creating one when needed. */
		submit(sessionKey: string, text: string): Promise<void>;
		create(options?: { agentId?: string; title?: string }): Promise<{ sessionKey: string }>;
		exists(sessionKey: string): Promise<boolean>;
	};
	connection: OutboundConnection;
	api: CloudApi;
	agents(): Promise<BotRegistration[]> | BotRegistration[];
	onAck(agentId: string, convId: string, seq: number): void;
	cursor(agentId: string, convId: string): number | undefined;
	bindSession(key: string, sessionKey: string): void;
	sessionFor(key: string): string | undefined;
	unbindSession(key: string): void;
	log(message: string): void;
}

export class BotBridge {
	private readonly pendingSends = new Map<string, { timer: NodeJS.Timeout; resolve(ok: boolean): void }>();
	private readonly replies = new Map<string, { agentId: string; convId: string; parts: string[] }>();
	private agents: Array<{ key: string; id: string }> = [];
	private syncTimer: NodeJS.Timeout | undefined;
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
		// An empty list means the gateway could not enumerate agents; reporting it
		// would retire every Bot.
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
		const ref = `${agentId}:${convId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingSends.delete(ref);
				resolve(false);
			}, SEND_TIMEOUT_MS);
			timer.unref?.();
			this.pendingSends.set(ref, { timer, resolve });
			const frame = {
				type: "send" as const,
				ref,
				agentId,
				convId,
				content: content as unknown as Record<string, unknown>,
			};
			if (!this.options.connection.send(frame)) {
				this.pendingSends.delete(ref);
				clearTimeout(timer);
				resolve(false);
			}
		});
	}

	/** Deliver one cloud `message` into its Bot's OpenClaw session, then acknowledge it. */
	async deliver(frame: Extract<InboundFrame, { type: "message" }>): Promise<void> {
		const key = this.agents.find((row) => row.id === frame.agentId)?.key;
		if (!key) {
			this.options.log("一条发给未登记 Bot 的消息被忽略");
			return;
		}
		const delivered = this.options.cursor(frame.agentId, frame.convId);
		if (delivered !== undefined && frame.message.seq <= delivered) return;
		const input = composeCloudInput(frame);
		if (input === undefined) {
			// The cloud accepts this content type but the gateway cannot show it.
			// Acknowledge so the server stops replaying, and say so in the
			// conversation instead of dropping it silently.
			this.ack(frame.agentId, frame.convId, frame.message.seq);
			await this.send(frame.agentId, frame.convId, {
				type: "text",
				text: "这条消息的内容类型（卡片、图片或文件）暂不支持在 OpenClaw 中显示。",
			}).catch(() => {});
			return;
		}
		let sessionKey: string;
		try {
			sessionKey = await this.sessionFor(key);
			await this.options.gateway.submit(sessionKey, input);
		} catch (error) {
			// No ack: the server keeps the cursor where it was, so the message is
			// redelivered on reconnect.
			this.options.log(`消息投递失败：${error instanceof Error ? error.message : "unknown"}`);
			return;
		}
		this.replies.set(sessionKey, { agentId: frame.agentId, convId: frame.convId, parts: [] });
		this.ack(frame.agentId, frame.convId, frame.message.seq);
	}

	private ack(agentId: string, convId: string, seq: number): void {
		this.options.onAck(agentId, convId, seq);
		this.options.connection.send({ type: "ack", agentId, convId, seq });
	}

	/** One gateway reply, final text only (streaming text is the watch stream's job). */
	async onGatewayReply(sessionKey: string, text: string, final: boolean): Promise<void> {
		if (!final) return;
		const reply = this.replies.get(sessionKey);
		if (!reply) return;
		if (text.trim()) reply.parts.push(text);
		this.replies.delete(sessionKey);
		const body = reply.parts.join("\n").trim();
		if (!body) return;
		const sent = await this.send(reply.agentId, reply.convId, { type: "markdown", text: body }).catch(() => false);
		if (!sent) this.options.log("一条 Bot 回复未被云端确认，未自动重发");
	}

	private async sessionFor(key: string): Promise<string> {
		const recorded = this.options.sessionFor(key);
		if (recorded && (await this.options.gateway.exists(recorded).catch(() => false))) return recorded;
		if (recorded) this.options.unbindSession(key);
		const created = await this.options.gateway.create({ agentId: key });
		this.options.bindSession(key, created.sessionKey);
		return created.sessionKey;
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
