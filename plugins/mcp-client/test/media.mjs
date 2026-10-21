import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import plugin from "../dist/index.js";

const audioPath = "/System/Library/Sounds/Glass.aiff";
const pngUrl = new URL("../../../skills/skill-creator/assets/skill-creator.png", import.meta.url);
if (process.argv[2] === "server") {
	const server = new McpServer({ name: "yonder-real-png-media", version: "1.0.0" });
	server.registerTool("read_png", { inputSchema: {} }, async () => {
		const bytes = await readFile(pngUrl);
		return {
			content: [
				{ type: "text", text: "Actual local PNG file" },
				{ type: "image", mimeType: "image/png", data: bytes.toString("base64") },
				{ type: "resource", resource: { uri: pngUrl.href, mimeType: "image/png", blob: bytes.toString("base64") } },
				{ type: "audio", mimeType: "audio/aiff", data: (await readFile(audioPath)).toString("base64") },
			],
			structuredContent: { uri: pngUrl.href, bytes: bytes.length },
		};
	});
	server.registerResource("png", pngUrl.href, { mimeType: "image/png" }, async () => ({
		contents: [{ uri: pngUrl.href, mimeType: "image/png", blob: (await readFile(pngUrl)).toString("base64") }],
	}));
	await server.connect(new StdioServerTransport());
} else {
	const data = await mkdtemp(join(tmpdir(), "yonder-mcp-media-"));
	const tools = new Map(),
		triggers = [];
	const ctx = {
		session: "session:media",
		env: { id: "node:local", cwd: process.cwd() },
		capabilities: ["read", "write", "message", "exec"],
		signal: new AbortController().signal,
	};
	try {
		await plugin.setup({
			version: "1",
			config: {
				servers: {
					png: { transport: "stdio", command: process.execPath, args: [fileURLToPath(import.meta.url), "server"] },
				},
			},
			paths: { data },
			credentials: { get: async () => undefined },
			tools: { register: (t) => tools.set(t.name, t) },
			contexts: { register() {} },
			triggers: { register: (t) => triggers.push(t) },
			events: { on() {} },
		});
		const bytes = await readFile(pngUrl);
		const result = await tools
			.get("mcp-client_stdio")
			.execute({ action: "call", server: "png", name: "read_png" }, ctx);
		assert.equal(result.isError, undefined, result.text);
		assert.deepEqual(Buffer.from(result.images[0].data, "base64"), bytes);
		assert.equal(result.images[0].mime, "image/png");
		assert.deepEqual(
			await readFile(fileURLToPath(result.attachments.find((item) => item.mime === "image/png").uri)),
			bytes,
		);
		assert.deepEqual(
			await readFile(fileURLToPath(result.attachments.find((item) => item.kind === "audio").uri)),
			await readFile(audioPath),
		);
		const parsed = JSON.parse(result.text);
		assert.equal(parsed.source.server, "png");
		assert.equal(parsed.source.name, "read_png");
		assert.equal(parsed.result.content[0].text, "Actual local PNG file");
		assert.equal(parsed.result.content[1].imageIndex, 0);
		assert.equal(parsed.result.content[2].resource.uri, pngUrl.href);
		assert.equal(parsed.result.structuredContent.bytes, bytes.length);
		assert.equal(parsed.result.structuredContent.uri, pngUrl.href);
		assert.ok(!result.text.includes(bytes.toString("base64")));
		assert.equal(parsed.result.content[1].data, undefined);
		assert.equal(parsed.result.content[3].data, undefined);
		assert.equal(parsed.result.content[2].resource.blob, undefined);
		const resource = await tools
			.get("mcp-client_stdio")
			.execute({ action: "read", server: "png", uri: pngUrl.href }, ctx);
		assert.equal(resource.isError, undefined, resource.text);
		assert.deepEqual(await readFile(fileURLToPath(resource.attachments[0].uri)), bytes);
		assert.equal(JSON.parse(resource.text).result.contents[0].blob, undefined);
		console.log(
			"PASS: real SDK PNG tool image maps to images, actual macOS audio and embedded/read resource blobs map to byte-identical artifact attachments, provenance/text/structuredContent retained; no base64 in text",
		);
	} finally {
		for (const trigger of triggers) await trigger.stop();
		await rm(data, { recursive: true, force: true });
	}
}
