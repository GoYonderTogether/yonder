import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMarkdownTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text, visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import { MessagePresentation } from "./message-presentation.js";
import { hideReplyMarker, sameDirectory } from "./terminal.js";

test("current-folder session filter accepts real directory aliases and keeps other paths separate", () => {
	const root = mkdtempSync(join(tmpdir(), "yonder-cwd-"));
	try {
		const alias = join(root, "alias");
		symlinkSync(root, alias);
		expect(sameDirectory(root, alias)).toBe(true);
		expect(sameDirectory(root, tmpdir())).toBe(false);
		expect(sameDirectory(root, join(root, "missing"))).toBe(false);
		expect(sameDirectory("/remote/path", "/remote/path")).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("inline markers share the content row and native outer padding becomes one separator", () => {
	const user = new MessagePresentation(
		new UserMessageComponent("测试对话\n身份标识紧贴正文", getMarkdownTheme(), 0),
		"›",
		true,
	);
	const rows = user.render(40);
	const plain = rows.map(stripTerminalSequences).map((line) => line.trimEnd());
	expect(plain).toEqual(["", " › 测试对话", " › 身份标识紧贴正文"]);
	expect(rows[1]).toMatch(/48;/);
	expect(rows.join("")).toContain("\x1b]133;A\x07");
	const reply = new MessagePresentation(new Text("测试对话\n身份标识紧贴正文", 0, 1), "•");
	expect(
		reply
			.render(40)
			.map(stripTerminalSequences)
			.map((line) => line.trimEnd()),
	).toEqual(["", " • 测试对话", "   身份标识紧贴正文"]);
	for (const width of [1, 4, 12, 40])
		expect(user.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
});

test("NO_REPLY prefixes are hidden only while streaming", () => {
	for (const text of ["N", "NO", "NO_", "NO_REPL"]) {
		expect(hideReplyMarker(text, true)).toBe(true);
		expect(hideReplyMarker(text, false)).toBe(false);
	}
	expect(hideReplyMarker(" NO_REPLY ", false)).toBe(true);
	expect(hideReplyMarker("NO_REPLY means no message", false)).toBe(false);
});
