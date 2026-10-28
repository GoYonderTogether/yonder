import { existsSync, readFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import { expect, test } from "vitest";
import { FileCredentials } from "./credentials.js";
import { buildModels } from "./models.js";

// Real endpoints only: the WorkBuddy gateway from the owner's pi model catalog, reached once directly and once
// through a local port that accepts the connection and never answers (a provider that hangs before its first token).
const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
const ready = process.env.YONDER_TEST_REAL === "1" && existsSync(auth) && existsSync(catalog);
const workbuddy = () =>
	(JSON.parse(readFileSync(catalog, "utf8")) as { providers: Record<string, unknown> }).providers.workbuddy as {
		baseUrl: string;
	};
const ping = {
	messages: [{ role: "user" as const, content: "Reply with the single word: pong", timestamp: Date.now() }],
};

test.skipIf(!ready)("a provider that never sends a first token fails retryably within firstTokenMs", async () => {
	const sockets: Socket[] = [];
	const silent = createServer((socket) => sockets.push(socket));
	await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
	try {
		const port = (silent.address() as { port: number }).port;
		const provider = { ...workbuddy(), baseUrl: `http://127.0.0.1:${port}/v1` };
		const models = buildModels(new FileCredentials(auth), { workbuddy: provider }, {}, {}, undefined, {
			firstTokenMs: 1500,
		});
		const model = models.getModel("workbuddy", "deepseek-v4.1-flash");
		if (!model) throw new Error("workbuddy/deepseek-v4.1-flash missing from catalog");
		const started = Date.now();
		const message = await models.streamSimple(model, ping, { maxTokens: 64 }).result();
		expect(Date.now() - started).toBeLessThan(10000);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("no first token within 1500ms");
		expect(isRetryableAssistantError(message)).toBe(true);
	} finally {
		for (const socket of sockets) socket.destroy();
		silent.close();
	}
});

test.skipIf(!ready)("a caller abort still ends as aborted, not as a timeout", async () => {
	const sockets: Socket[] = [];
	const silent = createServer((socket) => sockets.push(socket));
	await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
	try {
		const port = (silent.address() as { port: number }).port;
		const models = buildModels(
			new FileCredentials(auth),
			{ workbuddy: { ...workbuddy(), baseUrl: `http://127.0.0.1:${port}/v1` } },
			{},
			{},
			undefined,
			{ firstTokenMs: 60000 },
		);
		const model = models.getModel("workbuddy", "deepseek-v4.1-flash");
		if (!model) throw new Error("workbuddy/deepseek-v4.1-flash missing from catalog");
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 500);
		const message = await models.streamSimple(model, ping, { maxTokens: 64, signal: controller.signal }).result();
		expect(message.stopReason).toBe("aborted");
	} finally {
		for (const socket of sockets) socket.destroy();
		silent.close();
	}
});

test.skipIf(!ready)("a healthy provider answers through the guard", async () => {
	const models = buildModels(new FileCredentials(auth), { workbuddy: workbuddy() }, {}, {}, undefined, {
		firstTokenMs: 20000,
	});
	const model = models.getModel("workbuddy", "deepseek-v4.1-flash");
	if (!model) throw new Error("workbuddy/deepseek-v4.1-flash missing from catalog");
	const message = await models.streamSimple(model, ping, { maxTokens: 256 }).result();
	expect(message.stopReason, message.errorMessage).toBe("stop");
	expect(message.content.some((part) => part.type === "text" && /pong/i.test(part.text))).toBe(true);
});
