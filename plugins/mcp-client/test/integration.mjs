import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import plugin from "../dist/index.js";
import { createServer } from "./server.mjs";

const data = await mkdtemp(join(tmpdir(), "yonder-mcp-check-"));
const tools = new Map();
const contexts = [];
const triggers = [];
const handlers = new Map();
const api = {
	version: "1",
	config: {},
	paths: { data },
	credentials: { get: async () => undefined },
	tools: { register: (t) => tools.set(t.name, t) },
	contexts: { register: (c) => contexts.push(c) },
	triggers: { register: (t) => triggers.push(t) },
	events: { on: (name, fn) => handlers.set(name, fn) },
};
const controller = new AbortController();
const ctx = {
	session: "session:1",
	capabilities: ["read", "write", "message", "exec", "network"],
	env: { id: "node:local" },
	signal: controller.signal,
};
async function call(kind, args, context = ctx) {
	const reply = await tools.get(`mcp-client_${kind}`).execute(args, context);
	assert.equal(reply.isError, undefined, reply.text);
	return JSON.parse(reply.text);
}
const servers = [];
const transports = [];
const protocols = [];
try {
	await plugin.setup(api);
	const command = process.execPath;
	const args = [fileURLToPath(new URL("./server.mjs", import.meta.url)), "stdio"];
	await call("stdio", {
		action: "connect",
		server: "fs",
		config: { transport: "stdio", command, args },
		persistence: "persistent",
	});
	assert.equal(JSON.parse(await readFile(join(data, "servers.json"), "utf8"))['["session:1","fs"]'].command, command);
	async function verify(kind, server) {
		const list = await call(kind, { action: "tools", server });
		assert.ok(list.result.tools.some((t) => t.name === "read_file" && t.inputSchema.properties.path));
		const actual = await readFile("package.json", "utf8");
		const read = await call(kind, {
			action: "call",
			server,
			name: "read_file",
			arguments: { path: fileURLToPath(new URL("../../../package.json", import.meta.url)) },
		});
		assert.equal(read.result.content[0].text, actual);
		assert.equal((await call(kind, { action: "resources", server })).result.resources.length, 1);
		assert.equal(
			(await call(kind, { action: "read", server, uri: "file:///yonder/package.json" })).result.contents[0].text,
			actual,
		);
		assert.equal((await call(kind, { action: "prompts", server })).result.prompts[0].name, "read-package");
		assert.equal(
			(await call(kind, { action: "prompt", server, name: "read-package" })).result.messages[0].content.text,
			actual,
		);
		assert.ok((await call(kind, { action: "instructions", server })).result.instructions);
	}
	await verify("stdio", "fs");
	assert.ok((await contexts[0].render(ctx)).includes("untrusted"));
	const denied = await tools
		.get("mcp-client_stdio")
		.execute({ action: "tools", server: "fs" }, { ...ctx, capabilities: ["read"] });
	assert.equal(denied.isError, true);
	const isolated = await tools
		.get("mcp-client_stdio")
		.execute({ action: "tools", server: "fs" }, { ...ctx, session: "session:2" });
	assert.equal(isolated.isError, true);
	const pid = Number(
		(await call("stdio", { action: "call", server: "fs", name: "process_id" })).result.content[0].text,
	);
	process.kill(pid, "SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, 100));
	await verify("stdio", "fs");
	const abort = new AbortController();
	const waiting = tools
		.get("mcp-client_stdio")
		.execute({ action: "call", server: "fs", name: "wait" }, { ...ctx, signal: abort.signal });
	setTimeout(() => abort.abort(), 30);
	assert.equal((await waiting).isError, true);
	for (const kind of ["http", "sse"]) {
		let transport;
		const server = createHttpServer(async (req, res) => {
			try {
				if (kind === "sse" && req.method === "GET" && req.url === "/sse") {
					transport = new SSEServerTransport("/messages", res);
					transports.push(transport);
					const mcp = createServer();
					protocols.push(mcp);
					await mcp.connect(transport);
					return;
				}
				if (kind === "sse") {
					await transport.handlePostMessage(req, res);
					return;
				}
				if (!transport) {
					transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
					transports.push(transport);
					const mcp = createServer();
					protocols.push(mcp);
					await mcp.connect(transport);
				}
				await transport.handleRequest(req, res);
			} catch (error) {
				res.writeHead(500);
				res.end(String(error));
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		servers.push(server);
		const url = `http://127.0.0.1:${server.address().port}/${kind === "sse" ? "sse" : "mcp"}`;
		await call("http", { action: "connect", server: kind, config: { transport: kind, url } });
		await verify("http", kind);
	}
	await handlers.get("session.close")({ data: { session: ctx.session } });
	const stopped = await tools.get("mcp-client_stdio").execute({ action: "tools", server: "fs" }, ctx);
	assert.equal(stopped.isError, true);
	await plugin.setup({ ...api, tools: { register: (t) => tools.set(t.name, t) } });
	await call("stdio", { action: "tools", server: "fs" });
	const finalPid = Number(
		(await call("stdio", { action: "call", server: "fs", name: "process_id" })).result.content[0].text,
	);
	for (const trigger of triggers) await trigger.stop();
	assert.throws(() => process.kill(finalPid, 0), { code: "ESRCH" });
	console.log(
		"PASS: real SDK stdio/StreamableHTTP/SSE initialization, schema discovery, filesystem tool/resource/prompt, instructions provenance, persistence, capability and session boundaries, process-loss reconnect, cancellation, session cleanup",
	);
} finally {
	for (const trigger of triggers) await trigger.stop();
	for (const protocol of protocols) await protocol.close();
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	await rm(data, { recursive: true, force: true });
}
