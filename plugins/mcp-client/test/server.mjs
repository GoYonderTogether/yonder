import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
export function createServer() {
	const server = new McpServer(
		{ name: "yonder-local-fs-verification", version: "1.0.0" },
		{ instructions: "Read local files only when explicitly requested." },
	);
	server.registerTool("read_file", { inputSchema: { path: z.string() } }, async ({ path }) => ({
		content: [{ type: "text", text: await readFile(path, "utf8") }],
	}));
	server.registerTool("process_id", { inputSchema: {} }, async () => ({
		content: [{ type: "text", text: String(process.pid) }],
	}));
	server.registerTool("wait", { inputSchema: {} }, async (_, extra) => {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, 60000);
			extra.signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(new Error("cancelled"));
				},
				{ once: true },
			);
		});
		return { content: [] };
	});
	server.registerResource("package", "file:///yonder/package.json", {}, async (uri) => ({
		contents: [{ uri: uri.href, text: await readFile(new URL("../../../package.json", import.meta.url), "utf8") }],
	}));
	server.registerPrompt("read-package", { argsSchema: {} }, async () => ({
		messages: [
			{
				role: "user",
				content: { type: "text", text: await readFile(new URL("../../../package.json", import.meta.url), "utf8") },
			},
		],
	}));
	return server;
}
if (process.argv[2] === "stdio") await createServer().connect(new StdioServerTransport());
