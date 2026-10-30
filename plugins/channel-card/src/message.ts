import type { SocialMessageData } from "@yonder/sdk";
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
