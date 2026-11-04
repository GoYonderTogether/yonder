/**
 * Device-channel frames this connector speaks (spec 23 §2). The connector implements a
 * subset of the existing `/ws/device` protocol; anything not listed is ignored rather
 * than treated as a protocol error.
 */

/** Frames the connector sends to the cloud. */
export type OutboundFrame =
	| { type: "hello"; workProtocol?: 1 }
	| { type: "ack"; agentId: string; convId: string; seq: number }
	| { type: "send"; ref: string; agentId: string; convId: string; content: MessageContent; replyTo?: string }
	| { type: "work.response"; requestId: string; ok: true; result: unknown }
	| { type: "work.response"; requestId: string; ok: false; error: { code: string; message: string } }
	| { type: "work.event"; channelId: string; frame: unknown };

/** Content the device may send; the cloud validates the same subset in `messageInput`. */
export type MessageContent =
	| { type: "text"; text: string }
	| { type: "markdown"; text: string }
	| { type: "error"; text: string }
	/** Cloud-validated interactive/image/file payloads the DSH adapter reports or converts. */
	| { type: "interactive" | "image" | "file"; [key: string]: unknown };

export interface CloudMessage {
	id: string;
	convId: string;
	seq: number;
	senderId: string;
	content: MessageContent;
	replyTo?: string;
	createdAt: number;
	senderName?: string;
	senderIsBot?: boolean;
}

/** Downlink `message`, `sent` and `error` frames (spec 16 §3). */
export type InboundFrame =
	| {
			type: "message";
			agentId: string;
			convId: string;
			convKind: "dm" | "group" | "notice";
			mentioned: boolean;
			message: CloudMessage;
			replayed?: boolean;
	  }
	| { type: "sent"; ref?: string; message: CloudMessage }
	| { type: "error"; ref?: string; error: string }
	| { type: "work.request"; requestId: string; ownerId: string; deviceId: string; method: string; params: unknown }
	| { type: "work.cancel"; requestId: string; ownerId: string; deviceId: string }
	| { type: "work.open"; channelId: string; ownerId: string; deviceId: string }
	| { type: "work.frame"; channelId: string; ownerId: string; deviceId: string; frame: unknown }
	| { type: "work.close"; channelId: string; ownerId: string; deviceId: string };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Parse one frame. Returns undefined for anything the connector does not implement. */
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
			return {
				type: "message",
				agentId: data.agentId,
				convId: data.convId,
				convKind: kind,
				mentioned: data.mentioned === true,
				message,
				...(data.replayed === true ? { replayed: true } : {}),
			};
		}
		case "sent": {
			const message = cloudMessage(data.message);
			if (!message) return undefined;
			return { type: "sent", message, ...(typeof data.ref === "string" ? { ref: data.ref } : {}) };
		}
		case "error":
			// The backend's current error frame carries no ref; treat it as unconfirmed rather than as success.
			return { type: "error", error: typeof data.error === "string" ? data.error : "error" };
		case "work.request": {
			if (
				typeof data.requestId !== "string" ||
				typeof data.ownerId !== "string" ||
				typeof data.deviceId !== "string" ||
				typeof data.method !== "string"
			)
				return undefined;
			return {
				type: "work.request",
				requestId: data.requestId,
				ownerId: data.ownerId,
				deviceId: data.deviceId,
				method: data.method,
				params: data.params,
			};
		}
		case "work.cancel":
			if (typeof data.requestId !== "string") return undefined;
			return {
				type: "work.cancel",
				requestId: data.requestId,
				ownerId: String(data.ownerId),
				deviceId: String(data.deviceId),
			};
		case "work.open":
		case "work.frame":
		case "work.close": {
			if (typeof data.channelId !== "string") return undefined;
			const base = { channelId: data.channelId, ownerId: String(data.ownerId), deviceId: String(data.deviceId) };
			if (data.type === "work.frame") return { type: "work.frame", ...base, frame: data.frame };
			return { type: data.type, ...base };
		}
		default:
			return undefined;
	}
}

function cloudMessage(value: unknown): CloudMessage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	if (
		typeof row.id !== "string" ||
		typeof row.convId !== "string" ||
		typeof row.seq !== "number" ||
		typeof row.senderId !== "string" ||
		typeof row.createdAt !== "number"
	)
		return undefined;
	const content = row.content;
	if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
	const item = content as Record<string, unknown>;
	if (item.type === "text" || item.type === "markdown" || item.type === "error") {
		if (typeof item.text !== "string") return undefined;
	} else if (item.type === "interactive" || item.type === "image" || item.type === "file") {
		// Supported by the cloud; the DSH adapter converts or reports them, so keep them opaque here.
	} else return undefined;
	return {
		id: row.id,
		convId: row.convId,
		seq: row.seq,
		senderId: row.senderId,
		content: content as MessageContent,
		...(typeof row.replyTo === "string" ? { replyTo: row.replyTo } : {}),
		createdAt: row.createdAt,
		...(typeof row.senderName === "string" ? { senderName: row.senderName } : {}),
		...(typeof row.senderIsBot === "boolean" ? { senderIsBot: row.senderIsBot } : {}),
	};
}

/** True for a canonical lowercase/uppercase UUID; the cloud rejects anything else with `invalid_request`. */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Work methods this connector implements (spec 23 §2.4). Anything else answers `unsupported`. */
export const WORK_METHODS = [
	"sessions.list",
	"sessions.open",
	"sessions.submit",
	"sessions.transcript",
	"sessions.abort",
] as const;
export type WorkMethod = (typeof WORK_METHODS)[number];
export const isWorkMethod = (value: string): value is WorkMethod => (WORK_METHODS as readonly string[]).includes(value);

/** Gateway-shaped frame the connector relays inside `work.event` (spec 19 §3). */
export type StreamFrame =
	| { t: "ready"; sub: string; gap: boolean; cursor: string; result: unknown }
	| { t: "ev"; sub: string; seq: number; cursor: string; type: string; ts: string; data: unknown }
	| { t: "end"; sub: string; reason: string; error?: { code: string; message: string } }
	| { t: "pong"; n?: number };

export function parseStreamFrame(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const frame = value as Record<string, unknown>;
	return typeof frame.t === "string" ? frame : undefined;
}
