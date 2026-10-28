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
	return {
		...(notification ? { from: notification.from } : {}),
		id: Number(entry.id),
		kind: entry.kind,
		text: notification?.text ?? entryText(entry),
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

/** Read the pinned pi-durable 1.3.0 entry format without migrations, recovery or writes. Yonder does not fork conversations. */
export async function readTranscript(
	db: Db,
	id: string,
	range: { from?: number; limit?: number } = {},
): Promise<TranscriptItem[]> {
	const rows = await db.all<{ record: string }>(
		"SELECT record FROM pi_entries WHERE conversation_id = ? AND id >= ? ORDER BY id ASC LIMIT ?",
		Number(id),
		range.from ?? 0,
		range.limit ?? 100,
	);
	return rows.map((row) => transcriptItem(JSON.parse(row.record) as EntryRecord));
}

/**
 * Page a conversation's transcript, keeping the bounds inside the scan so a one-entry read
 * does not decode the whole conversation. `before` pages newest-first and returns ascending.
 */
export async function transcriptPage(
	conversation: Conversation,
	range: { from?: number; limit?: number; before?: number } = {},
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
		return page.items.map(transcriptItem).reverse();
	}
	const page = await conversation.entries(
		{ order: "ascending", ...(range.from === undefined ? {} : { minEntryId: range.from as EntryId }) },
		range.limit ?? 100,
		undefined,
		C,
	);
	return page.items.map(transcriptItem);
}
