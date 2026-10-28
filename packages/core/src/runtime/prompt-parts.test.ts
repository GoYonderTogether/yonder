import { expect, test } from "vitest";
import { promptParts } from "./prompt-parts.js";

const keys = ["yonder", "framework", "skills", "context-agents-md"];

test("declared parts in order map to their own keys", () => {
	expect([
		...promptParts(
			[
				{ key: "framework", text: "F" },
				{ key: "context-agents-md", text: "A" },
			],
			keys,
		),
	]).toEqual([
		["framework", "F"],
		["context-agents-md", "A"],
	]);
});

test("unkeyed, unknown, repeated or reordered parts keep the single legacy block with identical text", () => {
	const legacy = (parts: Parameters<typeof promptParts>[0]) => [...promptParts(parts, keys)];
	expect(legacy(["a", "b"])).toEqual([["yonder", "a\n\nb"]]);
	expect(legacy([{ key: "other", text: "x" }])).toEqual([["yonder", "x"]]);
	expect(
		legacy([
			{ key: "skills", text: "S" },
			{ key: "framework", text: "F" },
		]),
	).toEqual([["yonder", "S\n\nF"]]);
	expect(
		legacy([
			{ key: "skills", text: "S" },
			{ key: "skills", text: "T" },
		]),
	).toEqual([["yonder", "S\n\nT"]]);
	expect(legacy([])).toEqual([]);
});
