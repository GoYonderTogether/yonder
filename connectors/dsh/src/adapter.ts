/**
 * The only file that calls DSH's session API. DSH's method set changes across
 * patch releases (research/02 §2.6, §6), so everything version-dependent lives here:
 * callers deal in `HarnessSession` / `HarnessUpdate`, never in DSH wire shapes.
 */

export interface HarnessSession {
	/** DSH session identity (`session-<uuid>`); opaque outside this file. */
	id: string;
	title?: string;
	updatedAt: number;
	running: boolean;
	blank: boolean;
	cwd?: string;
	agentPreset?: string;
	/** Model currently selected for the session, when DSH reports one. */
	model?: { provider: string; model: string; effort?: string; contextWindow?: number };
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	turnCount?: number;
}

/** One model-visible transcript entry, already projected to the gateway's `TranscriptItem` shape. */
export interface HarnessTranscriptItem {
	id: number;
	kind: string;
	text: string;
	timestamp?: number;
	tools?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface HarnessTranscript {
	items: HarnessTranscriptItem[];
	hasMore: boolean;
}

/**
 * Live session update, already in the gateway's `session.update` vocabulary. The bridge
 * forwards these verbatim; only this file knows how DSH events become them.
 */
export type HarnessUpdate =
	| {
			type: "snapshot";
			items: Array<{ id: string; message: HarnessMessage }>;
			messages: Array<{ id: string; message: HarnessMessage }>;
			running: boolean;
			inbox: Array<{ id: string; mode: string }>;
	  }
	| { type: "message"; id: string; message: HarnessMessage; streaming: boolean }
	| {
			type: "tool";
			tool: {
				id: string;
				name: string;
				phase: "start" | "update" | "end";
				args?: unknown;
				text?: string;
				result?: unknown;
			};
	  }
	| { type: "state"; running: boolean }
	| { type: "inbox"; inbox: Array<{ id: string; mode: string }> }
	| { type: "error"; error: string };

export type HarnessBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: unknown };

export interface HarnessMessage {
	role: "user" | "assistant" | "toolResult";
	content: HarnessBlock[];
	timestamp?: number;
}

/** A harness event as it arrives from `session/event`, reduced to what the bridge forwards. */
export interface HarnessEvent {
	/** DSH session id. */
	sessionId: string;
	seq: number;
	type: string;
	data: unknown;
	time: number;
}

export interface CreateOptions {
	/** Workspace directory for the new session; omitted uses the harness default. */
	cwd?: string;
	/** DSH agent preset id; omitted uses the harness default. */
	preset?: string;
}

/** The DSH services the adapter needs, resolved by the plugin once they exist. */
export interface HarnessService {
	list(signal: AbortSignal): Promise<HarnessSession[]>;
	show(sessionId: string, signal: AbortSignal): Promise<HarnessSession | undefined>;
	transcript(
		sessionId: string,
		range: { before?: number; limit: number },
		signal: AbortSignal,
	): Promise<HarnessTranscript>;
	create(options: CreateOptions, signal: AbortSignal): Promise<{ sessionId: string }>;
	submit(sessionId: string, text: string, signal: AbortSignal): Promise<{ accepted: true }>;
	abort(sessionId: string, signal: AbortSignal): Promise<void>;
	/** Subscribe to one session's live updates; the returned function stops the subscription. */
	follow(
		sessionId: string,
		onUpdate: (update: HarnessUpdate) => void,
		signal: AbortSignal,
	): Promise<() => Promise<void>>;
	defaultPreset(): string;
}

/**
 * Text of a DSH content array. Reasoning is model-private: it maps to the web's thinking
 * field on live messages, never into transcript text or a Bot reply.
 */
export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const item = block as { type?: unknown; text?: unknown };
		if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
	}
	return parts.join("\n");
}

/** DSH message (`user` | `assistant` | `tool`) projected to the shapes the web client reduces. */
export function harnessMessage(message: unknown): HarnessMessage | undefined {
	if (!message || typeof message !== "object") return undefined;
	const row = message as Record<string, unknown>;
	const role = row.role;
	if (role !== "user" && role !== "assistant" && role !== "tool") return undefined;
	const content = Array.isArray(row.content) ? row.content : [];
	const blocks: HarnessBlock[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const item = block as Record<string, unknown>;
		if (item.type === "text") blocks.push({ type: "text", text: String(item.text ?? "") });
		// The web reducer reads `thinking`; DSH names the block and field differently.
		else if (item.type === "reasoning") blocks.push({ type: "thinking", thinking: String(item.text ?? "") });
		else if (item.type === "tool-call")
			blocks.push({
				type: "toolCall",
				id: String(item.id ?? ""),
				name: String(item.name ?? "tool"),
				arguments: typeof item.arguments === "string" ? parseArgs(item.arguments) : item.arguments,
			});
		// Image/file attachments have no web-reducer block; dropping them here is not a content loss
		// the connector introduces, because DSH's text carries the model-visible part.
	}
	const timestamp = typeof row.timestamp === "number" ? { timestamp: row.timestamp } : {};
	if (role === "tool") {
		return { role: "toolResult", content: blocks, ...timestamp };
	}
	return { role: role === "assistant" ? "assistant" : "user", content: blocks, ...timestamp };
}

function parseArgs(raw: string): unknown {
	try {
		const value: unknown = JSON.parse(raw);
		return value && typeof value === "object" ? value : { value };
	} catch {
		return { text: raw };
	}
}

/** DSH session summary (`SessionSummary` + projections) reduced to the facts the cloud bridge exposes. */
export function harnessSession(summary: unknown): HarnessSession | undefined {
	if (!summary || typeof summary !== "object") return undefined;
	const row = summary as Record<string, unknown>;
	const id = row.sessionId;
	if (typeof id !== "string" || !id) return undefined;
	const projections = (row.projections ?? {}) as { values?: Record<string, unknown> };
	const values = projections.values ?? {};
	const title = values.title;
	const model = values.modelSelection as
		| { lastUsed?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } }
		| undefined;
	const usage = values.tokenUsage as
		| { uncachedInputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown }
		| undefined;
	const pressure = values.contextPressure as { contextWindow?: unknown } | undefined;
	const stats = values.sessionStats as { turns?: unknown } | undefined;
	const last = model?.lastUsed;
	return {
		id,
		...(typeof title === "string" && title ? { title } : {}),
		updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
		running: row.running === true,
		blank: row.blank === true,
		...(typeof row.cwd === "string" ? { cwd: row.cwd } : {}),
		...(typeof values.agentPreset === "string" ? { agentPreset: values.agentPreset } : {}),
		...(typeof last?.provider === "string" && typeof last.model === "string"
			? {
					model: {
						provider: last.provider,
						model: last.model,
						...(typeof last.reasoningEffort === "string" ? { effort: last.reasoningEffort } : {}),
						...(typeof pressure?.contextWindow === "number" ? { contextWindow: pressure.contextWindow } : {}),
					},
				}
			: {}),
		...(usage
			? {
					usage: {
						input: typeof usage.uncachedInputTokens === "number" ? usage.uncachedInputTokens : 0,
						output: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
						cacheRead: typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0,
						cacheWrite: typeof usage.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0,
					},
				}
			: {}),
		...(typeof stats?.turns === "number" ? { turnCount: stats.turns } : {}),
	};
}

/** DSH history records projected to transcript items, chronological. */
export function harnessTranscript(records: unknown): HarnessTranscript {
	const list = Array.isArray(records) ? records : [];
	const items: HarnessTranscriptItem[] = [];
	for (const record of list) {
		const event = (record as { event?: Record<string, unknown> } | undefined)?.event;
		if (!event) continue;
		const seq = typeof event.seq === "number" ? event.seq : undefined;
		if (seq === undefined) continue;
		const data = (event.data ?? {}) as Record<string, unknown>;
		if (event.type === "user/message") {
			// Injected context (runtime snapshot, skills, time) is model-visible but not a human turn.
			const source = data.source as { kind?: unknown } | undefined;
			if (typeof source?.kind === "string" && source.kind !== "user") continue;
			const text = textOf(data.content);
			if (!text.trim()) continue;
			items.push({ id: seq, kind: "yonder.message", text });
		} else if (event.type === "assistant/message") {
			const message = data.message as { content?: unknown; timestamp?: unknown } | undefined;
			const text = textOf(message?.content);
			const tools: Array<{ name: string; args: Record<string, unknown> }> = [];
			for (const block of Array.isArray(message?.content) ? message.content : []) {
				const item = block as { type?: unknown; name?: unknown; arguments?: unknown };
				if (item?.type !== "tool-call") continue;
				const parsed = typeof item.arguments === "string" ? parseArgs(item.arguments) : item.arguments;
				tools.push({
					name: String(item.name ?? "tool"),
					args: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
				});
			}
			items.push({
				id: seq,
				kind: "pi.assistant",
				text,
				...(typeof message?.timestamp === "number" ? { timestamp: message.timestamp } : {}),
				...(tools.length ? { tools } : {}),
			});
		} else if (event.type === "tool/result") {
			const message = data.message as { content?: unknown } | undefined;
			const text = textOf(message?.content);
			if (!text.trim()) continue;
			items.push({ id: seq, kind: "pi.tool-result", text });
		}
	}
	return { items, hasMore: false };
}

/** One DSH history page (`page`) with its backwards cursor. */
export function harnessTranscriptPage(page: unknown): HarnessTranscript {
	const row = page as { records?: unknown; hasMore?: unknown } | undefined;
	const result = harnessTranscript(row?.records);
	return { items: result.items, hasMore: row?.hasMore === true };
}

/**
 * Reduce one DSH `session/event` to zero or more gateway-shaped updates.
 * Streaming assistant text is delivered by the follow stream's own frames, so a
 * committed `assistant/message` is the authoritative record here.
 */
export function harnessUpdates(event: HarnessEvent): HarnessUpdate[] {
	const data = (event.data ?? {}) as Record<string, unknown>;
	switch (event.type) {
		case "user/message": {
			const message = harnessMessage({ role: "user", content: data.content, timestamp: event.time });
			if (!message) return [];
			// Injected context (runtime snapshot, skills, time) is model-visible but not the human's turn.
			const source = data.source as { kind?: unknown } | undefined;
			if (typeof source?.kind === "string" && source.kind !== "user") return [];
			if (!textOf(data.content).trim()) return [];
			return [{ type: "message", id: String(event.seq), message, streaming: false }];
		}
		case "assistant/message": {
			const message = harnessMessage(data.message);
			if (!message) return [];
			return [{ type: "message", id: String(event.seq), message, streaming: false }];
		}
		case "tool/call": {
			const callId = data.callId;
			const name = data.name;
			if (typeof callId !== "string" || typeof name !== "string") return [];
			const args = typeof data.arguments === "string" ? parseArgs(data.arguments) : data.arguments;
			return [{ type: "tool", tool: { id: callId, name, phase: "start", ...(args === undefined ? {} : { args }) } }];
		}
		case "tool/result": {
			const message = data.message as { toolCallId?: unknown; content?: unknown } | undefined;
			const callId = message?.toolCallId;
			if (typeof callId !== "string") return [];
			const text = textOf(message?.content);
			return [{ type: "tool", tool: { id: callId, name: "", phase: "end", ...(text ? { text } : {}) } }];
		}
		case "turn/start":
			return [{ type: "state", running: true }];
		case "turn/end": {
			const reason = data.reason as { kind?: unknown; error?: { message?: unknown } } | undefined;
			const updates: HarnessUpdate[] = [{ type: "state", running: false }];
			if (reason?.kind === "error" && typeof reason.error?.message === "string")
				updates.push({ type: "error", error: reason.error.message });
			return updates;
		}
		default:
			return [];
	}
}
