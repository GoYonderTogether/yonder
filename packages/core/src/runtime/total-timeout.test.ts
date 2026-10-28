import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import { expect, test } from "vitest";
import { FileCredentials } from "./credentials.js";
import { buildModels } from "./models.js";

// A real loopback HTTP server speaking OpenAI chat-completions SSE: it answers headers and one content chunk
// promptly, then goes silent without closing. Only a whole-request deadline can end such a request.
async function stalledServer() {
	const sockets = new Set<import("node:net").Socket>();
	const server = createServer((request, response) => {
		request.resume();
		response.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = { id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [] as unknown[] };
		response.write(
			`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }] })}\n\n`,
		);
	});
	server.on("connection", (socket) => sockets.add(socket));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing loopback address");
	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((done) => server.close(() => done()));
		},
	};
}

const ping = {
	messages: [{ role: "user" as const, content: "ping", timestamp: Date.now() }],
};

function modelsFor(baseUrl: string, home: string, timeouts: { firstTokenMs?: number; totalMs?: number }) {
	const auth = join(home, "auth.json");
	writeFileSync(auth, JSON.stringify({ local: { type: "api_key", key: "loopback-key" } }));
	return buildModels(
		new FileCredentials(auth),
		{
			local: {
				baseUrl,
				api: "openai-completions",
				apiKey: "loopback-key",
				models: [{ id: "m", name: "m", input: ["text"], contextWindow: 8000, maxTokens: 256 }],
			},
		},
		{},
		{},
		undefined,
		timeouts,
	);
}

test("a stream that stalls after its first token fails retryably at totalMs", async () => {
	const server = await stalledServer();
	const home = mkdtempSync(join(tmpdir(), "yonder-total-"));
	try {
		const models = modelsFor(server.baseUrl, home, { firstTokenMs: 60000, totalMs: 1500 });
		const model = models.getModel("local", "m");
		if (!model) throw new Error("local/m missing");
		const started = Date.now();
		const message = await models.streamSimple(model, ping, { maxTokens: 64 }).result();
		expect(Date.now() - started).toBeLessThan(10000);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("exceeded 1500ms total");
		expect(isRetryableAssistantError(message)).toBe(true);
	} finally {
		await server.close();
		rmSync(home, { recursive: true, force: true });
	}
});

test("a caller abort ends as aborted and the guard leaves no listener on the caller signal", async () => {
	const server = await stalledServer();
	const home = mkdtempSync(join(tmpdir(), "yonder-total-"));
	try {
		const models = modelsFor(server.baseUrl, home, { totalMs: 60000 });
		const model = models.getModel("local", "m");
		if (!model) throw new Error("local/m missing");
		const controller = new AbortController();
		let added = 0;
		let removed = 0;
		const add = controller.signal.addEventListener.bind(controller.signal);
		const remove = controller.signal.removeEventListener.bind(controller.signal);
		controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
			if (args[0] === "abort") added++;
			return add(...args);
		}) as typeof add;
		controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
			if (args[0] === "abort") removed++;
			return remove(...args);
		}) as typeof remove;
		setTimeout(() => controller.abort(), 500);
		const message = await models.streamSimple(model, ping, { maxTokens: 64, signal: controller.signal }).result();
		expect(message.stopReason).toBe("aborted");
		expect(added).toBeGreaterThan(0);
		expect(removed).toBeGreaterThanOrEqual(1);
	} finally {
		await server.close();
		rmSync(home, { recursive: true, force: true });
	}
});

test("a finished request removes its caller-signal listener", async () => {
	const home = mkdtempSync(join(tmpdir(), "yonder-total-"));
	const server = createServer((request, response) => {
		request.resume();
		response.writeHead(200, { "content-type": "text/event-stream" });
		const base = { id: "c", object: "chat.completion.chunk", created: 1, model: "m" };
		response.write(
			`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "pong" } }] })}\n\n`,
		);
		response.write(
			`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
		);
		response.end("data: [DONE]\n\n");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing loopback address");
		const models = modelsFor(`http://127.0.0.1:${address.port}/v1`, home, { totalMs: 60000 });
		const model = models.getModel("local", "m");
		if (!model) throw new Error("local/m missing");
		const controller = new AbortController();
		let live = 0;
		const add = controller.signal.addEventListener.bind(controller.signal);
		const remove = controller.signal.removeEventListener.bind(controller.signal);
		controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
			if (args[0] === "abort") live++;
			return add(...args);
		}) as typeof add;
		controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
			if (args[0] === "abort") live--;
			return remove(...args);
		}) as typeof remove;
		const message = await models.streamSimple(model, ping, { maxTokens: 64, signal: controller.signal }).result();
		expect(message.stopReason, message.errorMessage).toBe("stop");
		await new Promise((done) => setImmediate(done));
		expect(live).toBeLessThanOrEqual(0);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		rmSync(home, { recursive: true, force: true });
	}
});
