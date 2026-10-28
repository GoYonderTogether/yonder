import type { SessionsAPI, ToolContext } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { sessionDiagnostics } from "../src/diagnostic-mark.js";

vi.mock("../src/lens-mcp.js", () => ({ callLens: vi.fn(async (_name, args) => ({ text: JSON.stringify(args) })) }));

test("session diagnostics probes the session's edit and write paths", async () => {
	const sessions = {
		transcript: vi.fn(async () => [
			{
				id: 1,
				kind: "pi.assistant",
				text: "",
				tools: [
					{ name: "edit", args: { path: "a.ts" } },
					{ name: "write", args: { path: "b.ts" } },
					{ name: "read", args: { path: "c.ts" } },
					{ name: "edit", args: { path: "a.ts" } },
				],
			},
		]),
	} as unknown as SessionsAPI;
	const tool = sessionDiagnostics(sessions);
	const result = await tool.execute({ source: "session" }, { session: "42" } as ToolContext);
	expect(JSON.parse(result.text)).toMatchObject({ source: "lsp", scope: "paths", paths: ["a.ts", "b.ts"] });
	expect(sessions.transcript).toHaveBeenCalledWith("42", { from: 0, limit: 200 });
});
