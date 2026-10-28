import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

test.each([
	[401, 1, true],
	[404, 1, true],
	[429, 1, true],
	[500, 3, true],
	[0, 3, true],
	[400, 1, false],
])(
	"HTTP %i follows the native fallback policy",
	async (status, attempts, switches) => {
		const home = await mkdtemp("/tmp/yonder-http-fallback-");
		const calls: string[] = [];
		let recovered = false;
		const server = createServer(async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const model = (JSON.parse(body) as { model: string }).model;
			calls.push(model);
			if (model === "first" && !recovered) {
				if (status === 0) return;
				res.writeHead(status, { "content-type": "application/json", "retry-after": status === 429 ? "1" : "120" });
				res.end(JSON.stringify({ error: { message: `${status} controlled failure` } }));
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
			db: await openDatabase(`${home}/state.db`),
			config: {
				schema: 1,
				credentials: auth,
				compaction: { enabled: false },
				timeouts: { firstTokenMs: 100 },
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
			expect(Boolean(health.models["local/first@default"])).toBe(switches);
			if (status === 429) {
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
