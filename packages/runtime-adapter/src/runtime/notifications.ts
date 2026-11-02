import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Conversation, EntryRecord } from "@earendil-works/pi-durable";

export interface Notification {
	id: number;
	from: string;
	event: string;
	text: string;
}

export function notificationOf(entry: EntryRecord): Notification | undefined {
	if (entry.kind !== "yonder.notification") return;
	const data = entry.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) return;
	if (typeof data.from !== "string" || typeof data.event !== "string" || typeof data.text !== "string") return;
	return { id: Number(entry.id), from: data.from, event: data.event, text: data.text };
}

export const notificationRequestId = (from: string, event: string) => `notification:${JSON.stringify([from, event])}`;

export async function writeNotification(conversation: Conversation, input: Omit<Notification, "id">) {
	const submission = await conversation.submit(
		{
			type: "write",
			requestId: notificationRequestId(input.from, input.event),
			entry: { kind: "yonder.notification", data: { ...input } },
		},
		C,
	);
	const result = await submission.wait(C);
	if (result.status !== "done" || result.type !== "write")
		throw new Error(`Notification not recorded: ${result.reason}`);
	return { session: String(conversation.id), event: input.event, entry: Number(result.entry), recorded: true as const };
}
