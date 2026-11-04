/**
 * Device-channel frames this connector speaks (spec 23 §2) and the connector's
 * own state. The wire subset is identical to the DSH and Hermes connectors, so
 * the cloud and web clients need no per-framework branch. Anything not listed
 * here is ignored rather than treated as a protocol error.
 */

export type MessageContent =
	| { type: "text"; text: string }
	| { type: "markdown"; text: string }
	| { type: "error"; text: string }
	| { type: "interactive" | "image" | "file"; [key: string]: unknown };

export interface CloudMessage {
	id: string;
	convId: string;
	seq: number;
	senderId: string;
	content: MessageContent;
	createdAt: number;
	replyTo?: string;
	senderName?: string;
	senderIsBot?: boolean;
}

export type InboundFrame =
	| {
			type: "message";
			agentId: string;
			convId: string;
			convKind: "dm" | "group" | "notice";
			mentioned: boolean;
			replayed?: boolean;
			message: CloudMessage;
	  }
	| { type: "sent"; ref?: string; message: CloudMessage }
	| { type: "error"; ref?: string; error: string }
	| {
			type: "work.request";
			requestId: string;
			ownerId: string;
			deviceId: string;
			method: string;
			params: unknown;
	  }
	| { type: "work.cancel"; requestId: string; ownerId: string; deviceId: string }
	| { type: "work.open" | "work.close"; channelId: string; ownerId: string; deviceId: string }
	| { type: "work.frame"; channelId: string; ownerId: string; deviceId: string; frame: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Work methods this connector implements (spec 23 §2.4); anything else answers `unsupported`. */
export const WORK_METHODS = [
	"sessions.list",
	"sessions.open",
	"sessions.submit",
	"sessions.transcript",
	"sessions.abort",
] as const;

function cloudMessage(value: unknown): CloudMessage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	if (
		typeof row.id !== "string" ||
		typeof row.convId !== "string" ||
		typeof row.seq !== "number" ||
		typeof row.senderId !== "string" ||
		typeof row.createdAt !== "number" ||
		!row.content ||
		typeof row.content !== "object" ||
		Array.isArray(row.content)
	)
		return undefined;
	const content = row.content as Record<string, unknown>;
	if (
		content.type !== "text" &&
		content.type !== "markdown" &&
		content.type !== "error" &&
		content.type !== "interactive" &&
		content.type !== "image" &&
		content.type !== "file"
	)
		return undefined;
	if (
		(content.type === "text" || content.type === "markdown" || content.type === "error") &&
		typeof content.text !== "string"
	)
		return undefined;
	const message: CloudMessage = {
		id: row.id,
		convId: row.convId,
		seq: row.seq,
		senderId: row.senderId,
		content: row.content as MessageContent,
		createdAt: row.createdAt,
	};
	if (typeof row.replyTo === "string") message.replyTo = row.replyTo;
	if (typeof row.senderName === "string") message.senderName = row.senderName;
	if (typeof row.senderIsBot === "boolean") message.senderIsBot = row.senderIsBot;
	return message;
}

/** Parse one frame; undefined for anything the connector does not implement. */
export function parseFrame(raw: unknown): InboundFrame | undefined {
	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			return undefined;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const data = value as Record<string, unknown>;
	switch (data.type) {
		case "message": {
			if (typeof data.agentId !== "string" || typeof data.convId !== "string") return undefined;
			const message = cloudMessage(data.message);
			if (!message) return undefined;
			const kind = data.convKind;
			if (kind !== "dm" && kind !== "group" && kind !== "notice") return undefined;
			const frame: Extract<InboundFrame, { type: "message" }> = {
				type: "message",
				agentId: data.agentId,
				convId: data.convId,
				convKind: kind,
				mentioned: data.mentioned === true,
				message,
			};
			if (data.replayed === true) frame.replayed = true;
			return frame;
		}
		case "sent": {
			const message = cloudMessage(data.message);
			if (!message) return undefined;
			const frame: Extract<InboundFrame, { type: "sent" }> = { type: "sent", message };
			if (typeof data.ref === "string") frame.ref = data.ref;
			return frame;
		}
		case "error":
			// The backend's error frame carries no ref; unconfirmed, never success.
			return { type: "error", error: typeof data.error === "string" ? data.error : "error" };
		case "work.request":
		case "work.cancel": {
			if (typeof data.requestId !== "string" || typeof data.ownerId !== "string" || typeof data.deviceId !== "string")
				return undefined;
			if (data.type === "work.request" && typeof data.method !== "string") return undefined;
			if (data.type === "work.request") {
				const method = data.method;
				return {
					type: "work.request",
					requestId: data.requestId,
					ownerId: data.ownerId,
					deviceId: data.deviceId,
					method: typeof method === "string" ? method : "",
					params: data.params,
				};
			}
			return {
				type: "work.cancel",
				requestId: data.requestId,
				ownerId: data.ownerId,
				deviceId: data.deviceId,
			};
		}
		case "work.open":
		case "work.close": {
			if (typeof data.channelId !== "string") return undefined;
			return {
				type: data.type,
				channelId: data.channelId,
				ownerId: String(data.ownerId),
				deviceId: String(data.deviceId),
			};
		}
		case "work.frame": {
			if (typeof data.channelId !== "string") return undefined;
			return {
				type: "work.frame",
				channelId: data.channelId,
				ownerId: String(data.ownerId),
				deviceId: String(data.deviceId),
				frame: data.frame,
			};
		}
		default:
			return undefined;
	}
}

// ---- connector state (<OPENCLAW_STATE_DIR>/yonder/, spec 23 §3) ----

export interface ConnectorConfig {
	endpoint: string;
	deviceToken: string;
}

export interface ConnectorState {
	/** Harness agent key → local Gateway session key used for that Bot. */
	botSessions: Record<string, string>;
	/** `${agentId}:${convId}` → highest message seq accepted by the harness. */
	cursors: Record<string, number>;
}

export function emptyState(): ConnectorState {
	return { botSessions: {}, cursors: {} };
}

/** `<OPENCLAW_STATE_DIR>/yonder`; OPENCLAW_STATE_DIR defaults to `~/.openclaw`. */
export function stateDir(env: NodeJS.ProcessEnv = process.env, home = process.env.HOME ?? ""): string {
	const configured = env.OPENCLAW_STATE_DIR?.trim();
	const base = configured ? configured : joinPath(home, ".openclaw");
	return joinPath(base, "yonder");
}

function joinPath(...parts: string[]): string {
	return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
