import { expect, test } from "vitest";
import { fromTranscript } from "../src/work/lib/chat";

test("retains durable tool results in their original order", () => {
	const items = fromTranscript([
		{ id: 1, kind: "pi.assistant", text: "", tools: [{ name: "read", args: {} }] },
		{ id: 2, kind: "pi.tool-result", text: "file contents", tools: [] },
		{ id: 3, kind: "pi.assistant", text: "done", tools: [] },
	]);
	expect(items.map((item) => [item.role, item.text])).toEqual([
		["assistant", ""],
		["tool-result", "file contents"],
		["assistant", "done"],
	]);
});

test("keeps attachment-only inputs and distinct files across transcript reloads", () => {
	const attachments = [
		{ kind: "file" as const, mime: "text/plain", uri: "file:///uploads/a.txt", name: "a.txt" },
		{ kind: "image" as const, mime: "image/png", uri: "file:///uploads/b.png", name: "b.png" },
	];
	const items = fromTranscript(
		attachments.map((attachment, index) => ({
			id: index + 1,
			kind: "yonder.message",
			text: "",
			attachments: [attachment],
		})),
	);
	expect(items).toHaveLength(2);
	expect(items.map((item) => item.attachments?.[0].name)).toEqual(["a.txt", "b.png"]);
});
