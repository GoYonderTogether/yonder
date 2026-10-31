import { expect, it } from "vitest";
import { editedMentions, type MentionToken, mentionMetadata, mentionQuery } from "../src/lib/mentions";

it("only opens a mention query at the caret after an @ token", () => {
	expect(mentionQuery("邮箱 a@b", 6)).toBeNull();
	expect(mentionQuery("你好@", 3)).toEqual({ start: 2, end: 3, query: "" });
	expect(mentionQuery("你好 @研究", 6)).toEqual({ start: 3, end: 6, query: "研究" });
	expect(mentionQuery("@张三 后面", 3)).toEqual({ start: 0, end: 3, query: "张三" });
});
it("preserves recipient identity across unrelated edits, drops partial deletions and never creates ghost mentions", () => {
	const text = "@同名 在吗",
		tokens: MentionToken[] = [{ start: 0, end: 3, label: "@同名", id: "first" }];
	expect(mentionMetadata(text, tokens)).toEqual({ mentions: ["first"] });
	const moved = editedMentions(text, `你好 ${text}`, tokens);
	expect(mentionMetadata(`你好 ${text}`, moved)).toEqual({ mentions: ["first"] });
	expect(editedMentions(text, "@同 在吗", tokens)).toEqual([]);
	expect(editedMentions(text, "@同名x 在吗", tokens)).toEqual(tokens);
	expect(mentionMetadata("手动@同名", [])).toEqual({});
});
it("collects multiple unique recipients and an explicit all marker", () => {
	expect(
		mentionMetadata("@所有人 @甲 @甲", [
			{ start: 0, end: 4, label: "@所有人", all: true },
			{ start: 5, end: 7, label: "@甲", id: "a" },
			{ start: 8, end: 10, label: "@甲", id: "a" },
		]),
	).toEqual({ mentions: ["a"], mentionAll: true });
});
