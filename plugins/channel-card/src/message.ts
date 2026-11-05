import type { Attachment, EventInput, Ref, SocialMessageData } from "@yonder/sdk";

export function cardEndpoint(endpoint?: string): string {
	let url: URL;
	try {
		url = new URL(endpoint ?? "https://demo.zethai.cn");
	} catch {
		throw new Error("Card endpoint must be an HTTP(S) origin without credentials");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("Card endpoint must be an HTTP(S) origin without credentials");
	if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
		throw new Error("Card endpoint requires HTTPS outside loopback");
	return url.origin;
}

/** Confirm a returned link belongs to the configured card service origin. */
export function sameOrigin(value: string, origin: string): boolean {
	try {
		return new URL(value).origin === origin;
	} catch {
		return false;
	}
}

export function cardResponseError(status: number, path: string): string {
	return status === 404 && (path.startsWith("/api/device/poll") || path === "/api/device/redeem")
		? "invalid_code"
		: status === 429 && path === "/api/device/redeem"
			? "rate_limited"
			: `Card HTTP ${status}`;
}

export function cardLoginCode(value: unknown, endpoint: string): { code: string; url: string } {
	const data = value as { code?: unknown; url?: unknown } | undefined;
	if (typeof data?.code !== "string" || !data.code || typeof data.url !== "string" || !sameOrigin(data.url, endpoint))
		throw new Error("Invalid card login response");
	return { code: data.code, url: data.url };
}

export interface Message {
	id: string;
	senderId: string;
	seq: number;
	createdAt: number;
	replyTo?: string;
	senderName?: string;
	senderIsBot?: boolean;
	content: {
		type: string;
		text?: string;
		mentions?: string[];
		url?: string;
		name?: string;
		bytes?: number;
		title?: string;
		body?: string;
	};
}

/** 补收消息超过这个时长才标注；刚断线几秒的补收不打扰 Bot。 */
const LATE_MS = 5 * 60_000;

/**
 * 设备重连时服务端补发的旧消息（帧上 replayed: true）。JV2-J03-10：35 分钟前的「起草名片 r2」被补收后
 * Bot 照做，覆盖了刚写好的新草稿。超过 LATE_MS 的补收消息在正文前标明发送时间，让 Bot 先核对是否已被新消息取代。
 */
export function lateNote(createdAt: number, text: string, now = Date.now()): string {
	if (now - createdAt < LATE_MS) return text;
	return `[补收：这条消息发于 ${new Date(createdAt).toISOString()}，设备离线期间未送达。若其中的操作已被之后的消息取代，不要再执行，先向对方确认。]\n${text}`;
}

export function socialMentions(
	value: unknown,
	mentioned: boolean,
	kind?: unknown,
): SocialMessageData & { mentions: { bot: boolean } } {
	const record =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as { mentions?: unknown; senderRole?: unknown })
			: undefined;
	const mentions =
		record?.mentions && typeof record.mentions === "object" && !Array.isArray(record.mentions)
			? (record.mentions as { bot?: unknown })
			: undefined;
	const role = record?.senderRole;
	return {
		mentions: { bot: typeof mentions?.bot === "boolean" ? mentions.bot : mentioned },
		...(kind === "group" &&
		(role === "group-owner" || role === "group-admin" || role === "member" || role === "unknown")
			? { senderRole: role }
			: {}),
	};
}

export function validateDeviceMessage(data: Record<string, unknown>, kinds: string[]): Message {
	const m = data.message as Message;
	if (
		typeof data.convId !== "string" ||
		!kinds.includes(String(data.convKind)) ||
		typeof data.mentioned !== "boolean" ||
		!m ||
		typeof m.id !== "string" ||
		typeof m.senderId !== "string" ||
		!Number.isInteger(m.seq) ||
		m.seq < 1 ||
		!Number.isFinite(m.createdAt) ||
		!m.content
	)
		throw new Error("Invalid device message");
	return m;
}

export function validateAgentMappings(rows: unknown, agents: Array<{ id: string }>): Map<string, string> {
	if (
		!Array.isArray(rows) ||
		rows.length !== agents.length ||
		rows.some((row) => !row || typeof row.id !== "string" || !agents.some((agent) => agent.id === row.key)) ||
		new Set(rows.map((row) => row.key)).size !== agents.length
	)
		throw new Error("Invalid card Agent mapping");
	return new Map(rows.map((row) => [row.key as string, row.id as string]));
}

export function cardTarget(
	target: string,
	instance: string,
	mappings: Map<string, string>,
	hasAttachments: boolean,
): { kind: "acct" | "conv"; key: string; id: string; agentId: string } | undefined {
	const [kind, targetInstance, key, id, extra] = target.split(":");
	const agentId = key && mappings.get(key);
	if (!["acct", "conv"].includes(kind ?? "") || targetInstance !== instance || extra || hasAttachments) return;
	if (!key || !id || !agentId) return;
	return { kind: kind as "acct" | "conv", key, id, agentId };
}

export function cardMentions(instance: string, key: string, mentions: Ref[] = []): string[] | undefined {
	const prefix = `acct:${instance}:${key}:`;
	const result: string[] = [];
	for (const ref of mentions) {
		if (!ref.startsWith(prefix) || !/^[0-9a-f-]{36}$/i.test(ref.slice(prefix.length))) return;
		result.push(ref.slice(prefix.length));
	}
	return result;
}

export function cardMessageEvent(
	instance: string,
	agent: string,
	data: Record<string, unknown>,
	m: Message,
): EventInput {
	const content = m.content;
	const attachments: Attachment[] = [];
	if (content.type === "image" || content.type === "file") {
		if (typeof content.url !== "string") throw new Error("Invalid device attachment");
		attachments.push({
			kind: content.type,
			mime: content.type === "image" ? "image/*" : "application/octet-stream",
			uri: content.url,
			...(content.name !== undefined ? { name: content.name } : {}),
			...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
		});
	}
	const raw = content.type === "interactive" ? `${content.title ?? ""}\n${content.body ?? ""}` : (content.text ?? "");
	const text = data.replayed === true ? lateNote(m.createdAt, raw) : raw;
	const social = socialMentions(data.social, data.mentioned === true, data.convKind);
	return {
		type: "message.in",
		from: `acct:${instance}:${agent}:${m.senderId}`,
		conv: `conv:${instance}:${agent}:${data.convId}`,
		data: {
			kind: data.convKind,
			target: agent,
			mentioned: social.mentions.bot,
			social: {
				...social,
				...(data.convKind === "group" ? { room: `card:${instance}:${data.convId}` } : {}),
			},
			text,
			msgId: m.id,
			createdAt: String(m.createdAt),
			...(m.replyTo ? { replyTo: m.replyTo } : {}),
			...(m.senderName ? { name: m.senderName } : {}),
			...(typeof m.senderIsBot === "boolean" ? { senderIsBot: m.senderIsBot } : {}),
			...(Array.isArray(content.mentions)
				? { mentions: content.mentions.map((id) => `acct:${instance}:${agent}:${id}`) }
				: {}),
			...(attachments.length ? { attachments } : {}),
		},
	};
}
