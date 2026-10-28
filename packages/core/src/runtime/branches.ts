import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Conversation, EntryId } from "@earendil-works/pi-durable";
import type { Db } from "./db.js";
import { SessionDoc } from "./docs.js";

export async function forkConversation(parent: Conversation, id: string, at: number): Promise<string> {
	const entries = await parent.entries({ minEntryId: at as EntryId, maxEntryId: at as EntryId }, 1, undefined, C);
	if (entries.items[0]?.id !== at) throw new Error(`Entry ${at} is not visible in session ${id}`);
	const child = await parent.fork(
		at as EntryId,
		{
			ownership: { kind: "ownerless" },
			init: async (tx, childId) => {
				const state = await tx.doc(SessionDoc, childId);
				state.close = "manual";
				state.outbox = [];
				state.activityRunId = null;
				state.activityIssue = null;
				state.fallback = null;
			},
		},
		C,
	);
	return String(child.id);
}

export async function forkParent(db: Db, id: string): Promise<{ id: string; at: number } | undefined> {
	const row = await db.get<{ record: string }>("SELECT record FROM pi_conversations WHERE id = ?", Number(id));
	const parent = row && (JSON.parse(row.record) as { parent?: { conversationId: number; at: number } }).parent;
	return parent ? { id: String(parent.conversationId), at: parent.at } : undefined;
}
