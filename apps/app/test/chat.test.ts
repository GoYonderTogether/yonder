import { expect, test } from "vitest";
import { fromTranscript } from "../src/lib/chat";

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
