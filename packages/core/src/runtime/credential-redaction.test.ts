import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { buildModels } from "./models.js";

test("provider error bodies cannot persist a reflected request credential", async () => {
	const credential = randomBytes(24).toString("hex");
	let reflected = false;
	const server = createServer((request, response) => {
		const authorization = request.headers.authorization ?? "";
		reflected = authorization.includes(credential);
		response.writeHead(503, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: `HTTP 503 reflected ${authorization}` } }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Loopback server did not bind");
	const credentials: CredentialStore = {
		read: async () => ({ type: "api_key", key: credential }),
		list: async () => [],
		modify: async (_provider, update) => update({ type: "api_key", key: credential }),
		delete: async () => {},
	};
	try {
		const models = buildModels(credentials, { openai: { baseUrl: `http://127.0.0.1:${address.port}/v1` } });
		const model = models.getModel("openai", "gpt-6.1-sol");
		if (!model) throw new Error("OpenAI test model is unavailable");
		const result = await models
			.streamSimple(
				model,
				{ messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
				{ maxTokens: 16, maxRetries: 0 },
			)
			.result();
		expect(reflected).toBe(true);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("503");
		expect(JSON.stringify(result).includes(credential)).toBe(false);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
