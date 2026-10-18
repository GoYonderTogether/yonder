import type { EntryRecord } from "@earendil-works/pi-durable";
import type { TranscriptItem } from "@yonder/sdk";
import type { Db } from "./db.js";

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
	return {
		id: Number(entry.id),
		kind: entry.kind,
		text: entryText(entry),
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
