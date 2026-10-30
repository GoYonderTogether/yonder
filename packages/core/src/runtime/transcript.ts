import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Conversation, EntryId, EntryRecord } from "@earendil-works/pi-durable";
import type { TranscriptItem } from "@yonder/sdk";
import type { Db } from "./db.js";
import { notificationOf } from "./notifications.js";

export function entryText(entry: EntryRecord | undefined): string {
	return (entry?.model ?? [])
		.flatMap((message) =>
			typeof message.content === "string"
				? [message.content]
				: message.content.filter((block) => block.type === "text").map((block) => block.text),
		)
		.join("\n");
}
export function transcriptItem(entry: EntryRecord): TranscriptItem {
	const notification = notificationOf(entry);
	const prepared =
		entry.kind === "yonder.prepared" ? entry.edits?.find((edit) => edit.action === "replace") : undefined;
	const messages = prepared && "messages" in prepared ? prepared.messages : entry.model;
	const timestamp = messages?.find((message) => typeof message.timestamp === "number")?.timestamp;
	return {
		...(notification ? { from: notification.from } : {}),
		id: Number(entry.id),
		kind: entry.kind,
		text: notification?.text ?? entryText(entry),
		...(timestamp === undefined ? {} : { timestamp }),
		...(prepared && "messages" in prepared
			? {
					target: Number(prepared.target),
					prepared: prepared.messages
						.flatMap((message) =>
							typeof message.content === "string"
								? [message.content]
								: message.content.filter((block) => block.type === "text").map((block) => block.text),
						)
						.join("\n"),
				}
			: {}),
		tools: (entry.model ?? []).flatMap((message) =>
			message.role === "assistant"
				? message.content
						.filter((block) => block.type === "toolCall")
						.map((block) => ({ name: block.name, args: block.arguments }))
				: [],
		),
		...(typeof entry.data === "object" && entry.data !== null && "event" in entry.data
			? { event: String(entry.data.event) }
			: {}),
	};
}

/** Resolve only the requested inputs. The conversation/id index stops at each matching edit. */
async function projectEntries(entries: EntryRecord[], db?: Db): Promise<TranscriptItem[]> {
	return Promise.all(
		entries.map(async (entry) => {
			const item = transcriptItem(entry);
			if (!db || entry.kind !== "yonder.message") return item;
			const row = await db.get<{ record: string }>(
				`SELECT record FROM pi_entries WHERE conversation_id = ? AND id > ?
			 AND json_extract(record, '$.kind') = 'yonder.prepared'
			 AND json_extract(record, '$.data.target') = ? ORDER BY id ASC LIMIT 1`,
				Number(entry.conversationId),
				Number(entry.id),
				Number(entry.id),
			);
			if (!row) return item;
			const prepared = transcriptItem(JSON.parse(row.record) as EntryRecord);
			const timestamp = item.timestamp ?? prepared.timestamp;
			return {
				...item,
				...(prepared.prepared === undefined ? {} : { prepared: prepared.prepared }),
				...(timestamp === undefined ? {} : { timestamp }),
			};
		}),
	);
}

/** Read the pinned pi-durable 1.3.0 entry format without migrations, recovery or writes. */
export async function readTranscript(
	db: Db,
	id: string,
	range: { from?: number; limit?: number } = {},
): Promise<TranscriptItem[]> {
	const rows = await db.all<{ record: string }>(
		`WITH RECURSIVE chain(id, upper_id) AS (
			SELECT id, NULL FROM pi_conversations WHERE id = ?
			UNION ALL
			SELECT json_extract(c.record, '$.parent.conversationId'),
				min(coalesce(chain.upper_id, json_extract(c.record, '$.parent.at')), json_extract(c.record, '$.parent.at'))
			FROM chain JOIN pi_conversations c ON c.id = chain.id
			WHERE json_extract(c.record, '$.parent.conversationId') IS NOT NULL
		)
		SELECT e.record FROM chain JOIN pi_entries e ON e.conversation_id = chain.id
		WHERE e.id >= ? AND (chain.upper_id IS NULL OR e.id <= chain.upper_id)
		ORDER BY e.id ASC LIMIT ?`,
		Number(id),
		range.from ?? 0,
		range.limit ?? 100,
	);
	return projectEntries(
		rows.map((row) => JSON.parse(row.record) as EntryRecord),
		db,
	);
}

/**
 * Page a conversation's transcript, keeping the bounds inside the scan so a one-entry read
 * does not decode the whole conversation. `before` pages newest-first and returns ascending.
 */
export async function transcriptPage(
	conversation: Conversation,
	range: { from?: number; limit?: number; before?: number } = {},
	db?: Db,
): Promise<TranscriptItem[]> {
	if (range.before !== undefined) {
		const page = await conversation.entries(
			{
				order: "descending",
				...(range.before > Number.MAX_SAFE_INTEGER - 1 ? {} : { maxEntryId: (range.before - 1) as EntryId }),
			},
			range.limit ?? 100,
			undefined,
			C,
		);
		return (await projectEntries([...page.items], db)).reverse();
	}
	const page = await conversation.entries(
		{ order: "ascending", ...(range.from === undefined ? {} : { minEntryId: range.from as EntryId }) },
		range.limit ?? 100,
		undefined,
		C,
	);
	return projectEntries([...page.items], db);
}
