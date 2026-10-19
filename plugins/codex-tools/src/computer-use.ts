import type { ToolResult } from "@yonder/sdk";
import { type AppServer, record } from "./app-server.js";

export function toolResult(value: unknown): ToolResult {
	const result = record(value);
	if (!Array.isArray(result.content)) throw new Error("CUA response omitted content");
	const texts = ["Source: official Codex Computer Use (local app-server)."];
	const images: NonNullable<ToolResult["images"]> = [];
	for (const entry of result.content) {
		const block = record(entry);
		if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
		else if (block.type === "image") {
			if (typeof block.mimeType !== "string" || typeof block.data !== "string")
				throw new Error("CUA image omitted mimeType/data");
			images.push({ mime: block.mimeType, data: block.data });
		} else texts.push(JSON.stringify(block));
	}
	if (result.structuredContent !== undefined) texts.push(JSON.stringify(result.structuredContent));
	return { text: texts.join("\n\n"), ...(images.length ? { images } : {}), isError: result.isError === true };
}
export async function desktopThread(client: AppServer, signal: AbortSignal): Promise<string> {
	const response = record(
		await client.request(
			"thread/start",
			{ ephemeral: true, cwd: client.cwd, approvalPolicy: "never", sandbox: "read-only" },
			signal,
		),
	);
	const id = record(response.thread).id;
	if (typeof id !== "string") throw new Error("Desktop thread/start omitted id");
	return id;
}
export async function computerStatus(client: AppServer, threadId: string, signal: AbortSignal): Promise<ToolResult> {
	const server = (await client.statuses(threadId, signal)).find((server) => server.name === "cua_repl");
	if (!server || !Object.keys(record(server.tools)).length)
		return {
			isError: true,
			text: "Official cua_repl MCP unavailable: check the installed Codex Computer Use plugin/service. Discovery does not confirm Accessibility or Screen Recording permissions. No alternate driver was used.",
		};
	return {
		text: JSON.stringify({
			source: "Codex app-server",
			status: "discovered",
			lifetime:
				"JS bindings persist only within the current Yonder run. run.end releases them; each new run must initialize with exactly one documented entry, then read its documentation.",
			permissions: "not verified; read actual app state to confirm",
			server: "cua_repl",
			tools: server.tools,
		}),
	};
}
export async function computerCall(
	client: AppServer,
	threadId: string,
	tool: "js" | "js_reset",
	args: unknown,
	signal: AbortSignal,
): Promise<ToolResult> {
	const server = (await client.statuses(threadId, signal)).find((server) => server.name === "cua_repl");
	if (!server || !record(server.tools)[tool])
		throw new Error(`Official cua_repl.${tool} unavailable; check Codex Computer Use installation/service`);
	const timeout = tool === "js" ? Number(record(args).timeout_ms ?? 30_000) : 30_000;
	return toolResult(
		await client.request(
			"mcpServer/tool/call",
			{ threadId, server: "cua_repl", tool, arguments: args },
			signal,
			timeout + 5_000,
		),
	);
}
