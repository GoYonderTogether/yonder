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
}
export async function historyPage(client: FeishuApi, query: HistoryQuery, signal: AbortSignal) {
	if (query.start !== undefined && query.end !== undefined && query.start > query.end)
		throw new Error("History start must not exceed end");
	const params = new URLSearchParams({
		container_id_type: query.thread ? "thread" : "chat",
		container_id: query.thread || query.chat,
		sort_type: "ByCreateTimeAsc",
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
/** Preserve full originals while keeping each model-facing text input within the frozen budget. */
export function recoveryBatches(messages: Prepared[], maxBytes = 64 * 1024): Prepared[][] {
	const groups = new Map<string, Prepared[]>();
	for (const message of messages) {
		const key = JSON.stringify([message.input.conv, message.input.from]);
		const group = groups.get(key) ?? [];
		group.push(message);
		groups.set(key, group);
	}
	const batches: Prepared[][] = [];
	for (const group of groups.values()) {
		let batch: Prepared[] = [],
			size = 0;
		for (const message of group) {
			const text = string(object(message.input.data).text);
			// One unusually large native message is split, with its original identity retained on every piece.
			let part = "",
				partBytes = 0;
			const parts: string[] = [];
			for (const char of text) {
				const bytes = Buffer.byteLength(char);
				if (partBytes + bytes > maxBytes) {
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
				const bytes = Buffer.byteLength(text);
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
	return {
		...first.input,
		data: {
			...first.input.data,
			msgId: id,
			text: data.map((row) => string(row.text)).join("\n\n"),
			mentioned: data.some((row) => row.mentioned),
			attachments,
			recovery: true,
			originals: batch.map((row) => row.original),
		},
	};
}
