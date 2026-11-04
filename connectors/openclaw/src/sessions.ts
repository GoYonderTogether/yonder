/**
 * Session driving over the local OpenClaw Gateway RPC (spec 23 §4: 会话方法
 * 集中在单个适配文件). This file is the ONE place that knows how OpenClaw
 * sessions map onto the connector's HarnessService vocabulary; the transport
 * lives in gateway.ts and the connector core in connector.ts.
 */

import type { GatewayClient } from "./gateway.js";

export interface GatewaySession {
	/** OpenClaw session key (`agent:<agentId>:main` style); opaque outside this file. */
	id: string;
	title?: string;
	updatedAt: number;
	running: boolean;
	agentId?: string;
}

export interface HarnessTranscript {
	items: Array<{ id: number; kind: string; text: string; timestamp?: number }>;
	hasMore: boolean;
}

export type HarnessUpdate =
	| { type: "message"; text: string; streaming: boolean }
	| { type: "state"; running: boolean }
	| { type: "error"; text: string };

export interface CreateOptions {
	title?: string;
	agentId?: string;
}

export interface SessionGateway {
	list(): Promise<GatewaySession[]>;
	show(sessionKey: string): Promise<GatewaySession | undefined>;
	transcript(sessionKey: string, limit: number, before?: number): Promise<HarnessTranscript>;
	create(options?: CreateOptions): Promise<{ sessionKey: string }>;
	submit(sessionKey: string, text: string): Promise<void>;
	abort(sessionKey: string): Promise<void>;
	follow(sessionKey: string, onUpdate: (update: HarnessUpdate) => void): () => void;
}

export class GatewayRpc implements SessionGateway {
	private readonly followings = new Map<string, (update: HarnessUpdate) => void>();
	/** Set by the connector core: one final assistant text per turn. */
	onFinalReply: ((sessionKey: string, text: string) => void) | undefined;

	constructor(
		private readonly client: GatewayClient,
		private readonly defaultAgentId: string,
	) {}

	/** Route one gateway event from the transport into the connector vocabulary. */
	handleEvent(event: string, payload: unknown): void {
		if (event !== "agent" && event !== "chat") return;
		const data = payload as
			| { runId?: string; sessionKey?: string; agentId?: string; seq?: number; state?: string; data?: { delta?: string; text?: string }; deltaText?: string; errorMessage?: string }
			| undefined;
		if (!data?.sessionKey) return;
		if (event === "chat") {
			if (data.state === "delta" && typeof data.deltaText === "string" && data.deltaText) {
				this.followings.get(data.sessionKey)?.({ type: "message", text: data.deltaText, streaming: true });
				return;
			}
			if (data.state === "final") {
				const message = data.data as { text?: string } | undefined;
				const text = typeof message?.text === "string" ? message.text : "";
				if (text) {
					this.followings.get(data.sessionKey)?.({ type: "message", text, streaming: false });
				}
				this.followings.get(data.sessionKey)?.({ type: "state", running: false });
				if (text) this.onFinalReply?.(data.sessionKey, text);
				return;
			}
			if (data.state === "error") {
				this.followings.get(data.sessionKey)?.({
					type: "error",
					text: typeof data.errorMessage === "string" ? data.errorMessage : "error",
				});
				return;
			}
			return;
		}
		// `agent` events carry assistant deltas; the final text rides the chat final.
		if (data.state === "delta" && data.data && typeof data.data.delta === "string" && data.data.delta) {
			this.followings.get(data.sessionKey)?.({ type: "message", text: data.data.delta, streaming: true });
		}
	}

	async list(): Promise<GatewaySession[]> {
		const result = (await this.client.request("sessions.list", {
			limit: 200,
			rowMode: "compact",
		})) as { rows?: Array<Record<string, unknown>> } | undefined;
		const rows = result?.rows ?? [];
		return rows
			.filter((row) => typeof row.key === "string")
			.map((row) => ({
				id: String(row.key),
				title: typeof row.displayName === "string" ? row.displayName : undefined,
				updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
				running: row.hasActiveRun === true,
				agentId: typeof row.agentId === "string" ? row.agentId : undefined,
			}));
	}

	async show(sessionKey: string): Promise<GatewaySession | undefined> {
		try {
			const result = (await this.client.request("sessions.describe", {
				key: sessionKey,
			})) as Record<string, unknown> | undefined;
			if (!result) return undefined;
			return {
				id: sessionKey,
				title: typeof result.displayName === "string" ? result.displayName : undefined,
				updatedAt: typeof result.updatedAt === "number" ? result.updatedAt : Date.now(),
				running: result.hasActiveRun === true,
				agentId: typeof result.agentId === "string" ? result.agentId : undefined,
			};
		} catch {
			return undefined;
		}
	}

	async transcript(sessionKey: string, limit: number, before?: number): Promise<HarnessTranscript> {
		const result = (await this.client.request("chat.history", {
			sessionKey,
			limit,
		})) as { messages?: Array<Record<string, unknown>>; hasMore?: boolean } | undefined;
		const rows = result?.messages ?? [];
		const items = rows
			.map((row, index) => {
				const role = typeof row.role === "string" ? row.role : "";
				const text = typeof row.text === "string" ? row.text : typeof row.content === "string" ? row.content : "";
				const id = typeof row.seq === "number" ? row.seq : index + 1;
				if (role === "user") return { id, kind: "yonder.message", text };
				if (role === "assistant") return { id, kind: "pi.assistant", text };
				return null;
			})
			.filter((item): item is { id: number; kind: string; text: string } => item !== null && item.text.trim().length > 0);
		return { items, hasMore: result?.hasMore === true };
	}

	async create(options?: CreateOptions): Promise<{ sessionKey: string }> {
		const agentId = options?.agentId ?? this.defaultAgentId;
		const result = (await this.client.request("sessions.create", {
			agentId,
			...(options?.title ? { title: options.title } : {}),
		})) as { key?: string } | undefined;
		const key = result?.key;
		if (typeof key !== "string" || !key) throw new Error("OpenClaw created no session key");
		return { sessionKey: key };
	}

	async submit(sessionKey: string, text: string): Promise<void> {
		// chat.send admits the turn; the reply streams on the `chat`/`agent` events
		// (spec 23 §2.4: 返回接纳事实，不等待模型结束).
		await this.client.request("chat.send", {
			sessionKey,
			message: text,
			idempotencyKey: `yonder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		});
	}

	async abort(sessionKey: string): Promise<void> {
		await this.client.request("sessions.abort", { key: sessionKey });
	}

	follow(sessionKey: string, onUpdate: (update: HarnessUpdate) => void): () => void {
		this.followings.set(sessionKey, onUpdate);
		return () => {
			if (this.followings.get(sessionKey) === onUpdate) this.followings.delete(sessionKey);
		};
	}


	get defaultAgent(): string {
		return this.defaultAgentId;
	}
}
