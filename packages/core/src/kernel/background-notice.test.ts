import { expect, test } from "vitest";
import { completionNotice } from "./background.js";

test("a logged background job notice carries terminal metadata, not its output", () => {
	const output = "x".repeat(20000);
	const text = completionNotice({
		id: "12",
		name: "build <web>",
		outputFile: "/home/.yonder/background/12.log",
		result: { text: JSON.stringify({ output, exitCode: 2 }), images: [], isError: true },
	});
	expect(text).toBe(
		[
			"<background-task-notification>",
			"  <task-id>12</task-id>",
			"  <task-name>build &lt;web&gt;</task-name>",
			"  <status>failed</status>",
			"  <exit-code>2</exit-code>",
			"  <output-file>/home/.yonder/background/12.log</output-file>",
			'  <summary>Background task "build &lt;web&gt;" failed</summary>',
			"  <guidance>Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.</guidance>",
			"</background-task-notification>",
		].join("\n"),
	);
	expect(text).not.toContain("xxxx");
});

test("a job without a log file keeps its result in the notice", () => {
	const text = completionNotice({
		id: "7",
		name: "task_run",
		result: { text: "RESULT ok", images: [], isError: false },
	});
	expect(text).toContain("<status>completed</status>");
	expect(text).toContain("<result>RESULT ok</result>");
	expect(text).not.toContain("<output-file>");
});
