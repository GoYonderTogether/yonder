import type { Conversation } from "../api/types";
/** A historical window cannot clear notices for newer messages. */
export function readConversation(item: Conversation, through: number): Conversation {
	return through >= (item.last?.seq ?? 0) ? { ...item, unread: 0, mentionUnread: false } : item;
}
