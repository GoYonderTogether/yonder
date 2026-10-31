import type { QQBotInboundMessage } from "@tencent-connect/qqbot-nodejs";
import { type Attachment, acct, conv, type EventInput } from "@yonder/sdk";
import type { Config } from "./config.js";

type InboundMedia = NonNullable<QQBotInboundMessage["attachments"]>[number];

const mediaKind = (mime: string): Attachment["kind"] =>
	mime.startsWith("image/")
		? "image"
		: mime.startsWith("audio/")
			? "audio"
			: mime.startsWith("video/")
				? "video"
				: "file";

/** Platform media becomes real attachments; anything but an https URL is dropped, never guessed. */
export function attachmentsOf(items: InboundMedia[] | undefined): Attachment[] {
	return (items ?? []).flatMap((item) => {
		const uri = item.url;
		if (!uri?.startsWith("https://")) return [];
		const mime = item.content_type?.trim() || "application/octet-stream";
		return [
			{
				kind: mediaKind(mime),
				mime,
				uri,
				...(item.filename ? { name: item.filename } : {}),
				...(item.size ? { bytes: item.size } : {}),
			},
		];
	});
}

/** Count of inbound attachments the channel dropped (only https URLs are accepted). */
export function droppedAttachments(msg: QQBotInboundMessage, event: EventInput): number {
	const received = msg.attachments?.length ?? 0;
	const kept = (event.data as { attachments?: unknown[] }).attachments?.length ?? 0;
	return Math.max(0, received - kept);
}

/** A quoted reply only survives in msg_elements[0]; the reference index alone carries no text. */
export function quoteOf(msg: QQBotInboundMessage): { text: string } | undefined {
	const text = msg.msgElements?.[0]?.content?.trim();
	return msg.refMsgIdx !== undefined && text ? { text } : undefined;
}

/**
 * QQ 群 @ 在推送里带 nickname/username，这是本机唯一能知道「被 @ 的是谁」的来源：openid 是每个机器人
 * 各自一套的不透明 ID，换了机器人就变，也没有公开接口反查昵称。只照抄平台给的字段，不推断、不编造。
 */
function mentionNames(id: string, mentions: NonNullable<QQBotInboundMessage["mentions"]>) {
	const names: Record<string, string> = {};
	for (const mention of mentions) {
		const openid = mention.member_openid ?? mention.user_openid ?? mention.id;
		const name = mention.nickname ?? mention.username;
		if (mention.scope === "all" || !openid || !name) continue;
		if (!/^[A-Za-z0-9_-]+$/.test(openid)) continue;
		names[acct(id, openid)] = name;
	}
	return Object.keys(names).length ? { mentionNames: names } : {};
}

/** 平台把 @ 写成 `<@openid>` 或 `<@!openid>`，正文里只剩标记；能对上昵称的就换成 `@昵称`。 */
function readableMentions(
	text: string,
	id: string,
	mentions: NonNullable<QQBotInboundMessage["mentions"]>,
): { text: string; selfMentions?: string[] } {
	const byOpenid = new Map<string, { ref: string; name?: string; self: boolean }>();
	for (const mention of mentions) {
		const openid = mention.member_openid ?? mention.user_openid ?? mention.id;
		if (mention.scope === "all" || !openid || !/^[A-Za-z0-9_-]+$/.test(openid)) continue;
		const name = mention.nickname ?? mention.username;
		byOpenid.set(openid, { ref: acct(id, openid), ...(name ? { name } : {}), self: mention.is_you === true });
	}
	const selfMentions = [...new Set([...byOpenid.values()].filter((entry) => entry.self).map((entry) => entry.ref))];
	const readable = text.replace(/<@!?([A-Za-z0-9_-]+)>/g, (marker, openid: string) => {
		const entry = byOpenid.get(openid);
		if (!entry?.name) return marker;
		return entry.self ? `@我（${entry.name}）` : `@${entry.name}`;
	});
	return { text: readable, ...(selfMentions.length ? { selfMentions } : {}) };
}

export function incoming(
	id: string,
	config: Config,
	msg: QQBotInboundMessage,
	mentioned = msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
		msg.mentions?.some((mention) => mention.is_you === true) === true,
): EventInput | undefined {
	const text = msg.content.trim();
	const attachments = attachmentsOf(msg.attachments);
	const quote = quoteOf(msg);
	if (!msg.messageId || !msg.senderId || (!text && !attachments.length)) return;
	if (
		msg.kind !== "c2c" &&
		(msg.kind !== "group" || !["GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"].includes(msg.rawEventType))
	)
		return;
	const group = msg.kind === "group";
	const targetId = group ? msg.groupOpenid : msg.senderId;
	if (!targetId || ![targetId, msg.senderId].every((value) => /^[A-Za-z0-9_-]+$/.test(value)))
		throw new Error("QQ message has invalid identity");
	const allowed = group ? config.allowedGroups : config.allowedUsers;
	if (allowed && !allowed.includes(targetId)) return;
	const createdAt = Date.parse(msg.timestamp);
	// 群消息里 @ 只剩 `<@openid>` 标记；先换成可读昵称，模型才知道这条在说谁、是不是在叫自己。
	const readable = group && msg.mentions ? readableMentions(text, id, msg.mentions) : { text };
	// 平台的 @ 事实以推送为准；正文里明确 @ 到本机器人也算一次点名，两者取或，不互相否定。
	const selfMentioned = (readable.selfMentions?.length ?? 0) > 0;
	const botMentioned = mentioned || selfMentioned;
	return {
		type: "message.in",
		from: acct(id, msg.senderId),
		conv: conv(id, `${group ? "group" : "c2c"}:${targetId}`),
		data: {
			kind: group ? "group" : "dm",
			text: readable.text,
			...(attachments.length ? { attachments } : {}),
			...(quote ? { quote } : {}),
			msgId: msg.messageId,
			...(group
				? { mentioned: botMentioned, social: { mentions: { bot: botMentioned }, nativeKind: msg.rawEventType } }
				: {}),
			...(Number.isFinite(createdAt) ? { createdAt: String(createdAt) } : {}),
			...(msg.senderName ? { name: msg.senderName } : {}),
			...(msg.senderIsBot !== undefined ? { senderIsBot: msg.senderIsBot } : {}),
			...(group && msg.mentions
				? {
						mentions: [
							...new Set(
								msg.mentions.flatMap((mention) => {
									const openid = mention.member_openid ?? mention.user_openid ?? mention.id;
									return mention.scope !== "all" && openid && /^[A-Za-z0-9_-]+$/.test(openid) ? [acct(id, openid)] : [];
								}),
							),
						],
						// 平台给的昵称/用户名只随本条消息到达一次，内核之后无法再查；照原样带出，不推断。
						...mentionNames(id, msg.mentions),
					}
				: {}),
			...(group && (msg.msgIdx || msg.refMsgIdx)
				? {
						qq: {
							...(msg.msgIdx ? { msgIdx: msg.msgIdx } : {}),
							...(msg.refMsgIdx ? { refMsgIdx: msg.refMsgIdx } : {}),
						},
					}
				: {}),
		},
	};
}
