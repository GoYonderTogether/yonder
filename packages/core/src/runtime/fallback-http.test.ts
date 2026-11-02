import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase, openRuntimeStorage } from "./db.js";
import { Runtime } from "./index.js";

test.each([
	[401, 0, 1, true, true],
	// A controlled response can be delayed by ordinary loopback/event-loop scheduling.
	[401, 200, 1, true, true],
	[404, 0, 1, true, true],
	[429, 0, 1, true, true],
	[500, 0, 1, true, true],
	// A request that never got an answer says nothing about the candidate: it switches and records no hold.
	[0, 0, 3, true, false],
	[400, 0, 1, false, false],
])(
	"HTTP %i follows the native fallback policy after %i ms",
	async (status, responseDelayMs, attempts, switches, held) => {
		const home = await tempHome("yonder-http-fallback-");
		const calls: string[] = [];
		let recovered = false;
		const server = createServer(async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const model = (JSON.parse(body) as { model: string }).model;
			calls.push(model);
			if (model === "first" && !recovered) {
				if (status === 0) return;
				const respond = () => {
					res.writeHead(status, { "content-type": "application/json", "retry-after": status === 429 ? "1" : "120" });
					res.end(JSON.stringify({ error: { message: `${status} controlled failure` } }));
				};
				if (responseDelayMs && calls.length === 1) {
					const timer = setTimeout(respond, responseDelayMs);
					res.once("close", () => clearTimeout(timer));
				} else respond();
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(
				`data: ${JSON.stringify({ id: "response", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
			);
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const { port } = server.address() as { port: number };
		const auth = `${home}/auth.json`;
		await writeFile(auth, JSON.stringify({ local: { type: "api_key", key: "local-test-key" } }));
		const profile = resolveProfile({
			model: "local/first",
			fallback: { models: ["local/second"], hold: 600 },
			level: "readonly",
		});
		const runtime = await Runtime.open({
			home,
			storage: await openRuntimeStorage(await openDatabase(`${home}/state.db`)),
			config: {
				schema: 1,
				credentials: auth,
				compaction: { enabled: false },
				// Only the silent-response case tests the 100 ms guard. HTTP status cases
				// must classify their actual response rather than race CI scheduling.
				timeouts: { firstTokenMs: status === 0 ? 100 : 5000 },
				retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
				models: {
					providers: {
						local: {
							baseUrl: `http://127.0.0.1:${port}/v1`,
							api: "openai-completions",
							apiKey: "local-test-key",
							models: ["first", "second"].map((id) => ({
								id,
								name: id,
								input: ["text"],
								contextWindow: 8000,
								maxTokens: 256,
							})),
						},
					},
				},
			},
			resolveSession: async () => ({ agent: null, profile: "fallback", cwd: home, resolved: profile }),
		});
		try {
			const session = await runtime.create({ agent: null, profile: "fallback", cwd: home });
			const result = await runtime.submit(session, { text: "hello" });
			expect(calls, result.reason).toEqual([...Array(attempts).fill("first"), ...(switches ? ["second"] : [])]);
			expect(result.status).toBe(switches ? "done" : "error");
			const health = JSON.parse(
				await readFile(`${home}/.yonder/model-health.json`, "utf8").catch(() => '{"models":{}}'),
			) as { models: Record<string, unknown> };
			expect(Boolean(health.models["local/first@default"])).toBe(held);
			if (status === 429) {
				expect((health.models["local/first@default"] as { resetUntil?: number }).resetUntil).toBeGreaterThan(
					Date.now(),
				);
				expect((await runtime.submit(session, { text: "again" })).status).toBe("done");
				expect(calls).toEqual(["first", "second", "second"]);
				await new Promise((resolve) => setTimeout(resolve, 1100));
				recovered = true;
				expect((await runtime.submit(session, { text: "after reset" })).status).toBe("done");
				expect(calls).toEqual(["first", "second", "second", "first"]);
			}
		} finally {
			await runtime.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	30000,
);
