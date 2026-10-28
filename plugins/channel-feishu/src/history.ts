import type { Attachment, EventInput } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";
import { type ObjectValue, object, required, string } from "./protocol.js";

export interface HistoryQuery {
	chat: string;
	thread?: string;
	start?: number;
	end?: number;
	pageToken?: string;
	pageSize?: number;
	sort?: "asc" | "desc";
}
export async function historyPage(client: FeishuApi, query: HistoryQuery, signal: AbortSignal) {
	if (query.start !== undefined && query.end !== undefined && query.start > query.end)
		throw new Error("History start must not exceed end");
	const params = new URLSearchParams({
		container_id_type: query.thread ? "thread" : "chat",
		container_id: query.thread || query.chat,
		sort_type: query.sort === "desc" ? "ByCreateTimeDesc" : "ByCreateTimeAsc",
		page_size: String(query.pageSize ?? 50),
	});
	if (!query.thread) {
		if (query.start !== undefined) params.set("start_time", String(Math.floor(query.start / 1000)));
		if (query.end !== undefined) params.set("end_time", String(Math.floor(query.end / 1000) + 1));
	}
	if (query.pageToken) params.set("page_token", query.pageToken);
	const data = object((await client.request(`/im/v1/messages?${params}`, "GET", undefined, signal)).data);
	if (!Array.isArray(data.items)) throw new Error("Feishu history omitted items");
	const items = data.items.map(object).filter((item) => {
		if (item.chat_id !== query.chat) throw new Error("Feishu history returned a different source");
		const time = Number(item.create_time);
		if (!Number.isFinite(time)) throw new Error("Feishu history omitted creation time");
		return (query.start === undefined || time >= query.start) && (query.end === undefined || time <= query.end);
	});
	const next = data.has_more ? required(data.page_token, "History next page token") : undefined;
	return { items, ...(next ? { next } : {}) };
}

/** History and WebSocket messages enter the same identity/content/resource converter. */
export function historyEnvelope(item: ObjectValue, chat: string, kind: "dm" | "group", tenant: string): ObjectValue {
	const sender = object(item.sender);
	if (sender.id_type !== "open_id") throw new Error("Feishu history sender is not an open_id");
	return {
		sender: {
			sender_id: { open_id: required(sender.id, "History sender") },
			sender_type: sender.sender_type,
			tenant_key: string(sender.tenant_key) || tenant,
		},
		message: {
			...item,
			chat_id: chat,
			chat_type: kind === "dm" ? "p2p" : "group",
			message_type: required(item.msg_type, "History message type"),
			content: required(object(item.body).content, "History content"),
			mentions: Array.isArray(item.mentions)
				? item.mentions.map((mention) => ({ id: { open_id: string(object(mention).id) } }))
				: [],
		},
	};
}

export interface Prepared {
	key: string;
	input: EventInput;
	original: ObjectValue;
}
function recoveryHeader(message: Prepared): string {
	const original = message.original;
	const date = new Date(Number(original.createdAt));
	const time = original.createdAt && !Number.isNaN(date.getTime()) ? date.toISOString() : "unknown";
	const id = string(original.messageId) || string(original.msgId);
	const reply = string(original.replyTo);
	const thread = string(original.threadId);
	return `[恢复历史消息，非新发送 | 原发送时间: ${time} | 消息ID: ${id}${reply ? ` | 引用: ${reply}` : ""}${thread ? ` | 线程: ${thread}` : ""}]\n`;
}

/** Preserve full originals while keeping each model-facing text input within the frozen budget. */
export function recoveryBatches(messages: Prepared[], maxBytes = 64 * 1024): Prepared[][] {
	const groups: Prepared[][] = [];
	for (const message of messages) {
		const group = groups.at(-1);
		const previous = group?.[0];
		if (
			group &&
			previous &&
			previous.input.conv === message.input.conv &&
			previous.input.from === message.input.from &&
			string(object(previous.input.data).threadId) === string(object(message.input.data).threadId)
		)
			group.push(message);
		else groups.push([message]);
	}
	const batches: Prepared[][] = [];
	for (const group of groups) {
		let batch: Prepared[] = [],
			size = 0;
		for (const message of group) {
			const text = string(object(message.input.data).text);
			const headerBytes = Buffer.byteLength(recoveryHeader(message));
			const contentBudget = maxBytes - headerBytes;
			if (contentBudget < 0) throw new Error("Recovery metadata exceeds text budget");
			// One unusually large native message is split, with its original identity retained on every piece.
			let part = "",
				partBytes = 0;
			const parts: string[] = [];
			for (const char of text) {
				const bytes = Buffer.byteLength(char);
				if (bytes > contentBudget) throw new Error("Recovery metadata leaves insufficient text budget");
				if (partBytes + bytes > contentBudget) {
					parts.push(part);
					part = "";
					partBytes = 0;
				}
				part += char;
				partBytes += bytes;
			}
			parts.push(part);
			if (parts.length > 1) {
				if (batch.length) {
					batches.push(batch);
					batch = [];
					size = 0;
				}
				for (const [index, part] of parts.entries())
					batches.push([
						{
							...message,
							original: { ...message.original, complete: index === parts.length - 1, part: index },
							input: { ...message.input, data: { ...message.input.data, text: part } },
						},
					]);
			} else {
				const bytes = headerBytes + Buffer.byteLength(text);
				if (batch.length && size + 2 + bytes > maxBytes) {
					batches.push(batch);
					batch = [];
					size = 0;
				}
				batch.push(message);
				size += (batch.length > 1 ? 2 : 0) + bytes;
			}
		}
		if (batch.length) batches.push(batch);
	}
	return batches;
}

export function mergedInput(batch: Prepared[], id: string): EventInput {
	const first = batch[0];
	if (!first) throw new Error("Recovery batch is empty");
	const data = batch.map((row) => object(row.input.data));
	const attachments = data.flatMap((row) => (Array.isArray(row.attachments) ? (row.attachments as Attachment[]) : []));
	const mention = (key: string) => {
		const facts = data.map((row) => object(object(row.social).mentions)[key]);
		return facts.includes(true) ? true : facts.every((fact) => fact === false) ? false : undefined;
	};
	const bot = mention("bot");
	const everyone = mention("everyone");
	return {
		...first.input,
		data: {
			...first.input.data,
			msgId: id,
			text: batch.map((row) => recoveryHeader(row) + string(object(row.input.data).text)).join("\n\n"),
			mentioned: data.some((row) => row.mentioned),
			social: {
				mentions: {
					...(bot === undefined ? {} : { bot }),
					...(everyone === undefined ? {} : { everyone }),
				},
			},
			attachments,
			recovery: true,
			originals: batch.map((row) => row.original),
		},
	};
}
