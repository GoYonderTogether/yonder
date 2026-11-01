import { expect, it } from "vitest";
import type { Conversation } from "../src/api/types";
import { readConversation } from "../src/lib/chatRead";

it("reading an older history window preserves newer unread mentions", () => {
	const c = { id: "c", last: { seq: 100 }, unread: 4, mentionUnread: true } as Conversation;
	expect(readConversation(c, 60)).toBe(c);
	expect(readConversation(c, 100)).toMatchObject({ unread: 0, mentionUnread: false });
});
