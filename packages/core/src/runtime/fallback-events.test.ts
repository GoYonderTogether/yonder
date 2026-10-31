import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { stopNotice } from "../delivery/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import type { ModelFallbackEvent } from "./types.js";

// Real models (WorkBuddy deepseek as primary, RightAPI glm as fallback) behind a local HTTP boundary that can
// inject real 503 responses. Successful answers always come from the real upstream.
const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth) && existsSync(catalog);

test.skipIf(!real)(
	"fallback episodes emit model.fallback once each way, backoff restarts per model, exhaustion is explained",
	async () => {
		const providers = (JSON.parse(readFileSync(catalog, "utf8")) as { providers: Record<string, { baseUrl: string }> })
			.providers;
		const upstream = { wb: providers.workbuddy!.baseUrl, glm: providers["rightapi-glm"]!.baseUrl };
		const failing = new Set<string>();
		const calls: Array<{ route: string; at: number }> = [];
		const server = createServer(async (req, res) => {
			const [, route, ...rest] = (req.url ?? "").split("/");
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			calls.push({ route: route!, at: Date.now() });
			if (failing.has(route!)) {
				res.writeHead(503, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "503 controlled outage" } }));
				return;
			}
			try {
				const headers = new Headers();
				for (const [key, value] of Object.entries(req.headers))
					if (value && !["host", "connection", "content-length"].includes(key)) headers.set(key, String(value));
				const base = upstream[route as "wb" | "glm"].replace(/\/$/, "");
				const response = await fetch(`${base}/${rest.slice(1).join("/")}`, {
					method: req.method ?? "POST",
					headers,
					body: Buffer.concat(chunks),
				});
				res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/event-stream" });
				if (response.body)
					Readable.fromWeb(response.body)
						.on("error", () => res.destroy())
						.pipe(res);
				else res.end();
			} catch {
				res.destroy();
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const { port } = server.address() as { port: number };
		const home = await mkdtemp("/tmp/yonder-fallback-events-");
		const events: ModelFallbackEvent[] = [];
		const profile = resolveProfile({
			model: "workbuddy/deepseek-v4.1-flash",
			thinking: "low",
			// hold 0: every run starts on the primary again, so the episode edges are driven by real outcomes.
			fallback: { models: ["rightapi-glm/glm-5.3-flash"], hold: 0 },
			level: "readonly",
		});
		const runtime = await Runtime.open({
			home,
			db: await openDatabase(`${home}/state.db`),
			config: {
				schema: 1,
				credentials: auth,
				compaction: { enabled: false },
				retry: { maxRetries: 0, baseDelayMs: 300, maxDelayMs: 60000 },
				models: {
					providers: {
						workbuddy: { ...providers.workbuddy, baseUrl: `http://127.0.0.1:${port}/wb/v1` },
						"rightapi-glm": { ...providers["rightapi-glm"], baseUrl: `http://127.0.0.1:${port}/glm/v1` },
					},
				},
			},
			resolveSession: async () => ({ agent: null, profile: "fallback", cwd: home, resolved: profile }),
			onModelFallback: async (event) => {
				events.push(event);
			},
		});
		try {
			const session = await runtime.create({ agent: null, profile: "fallback", cwd: home });
			const ask = () => runtime.submit(session, { text: "Reply with the single word: pong" });

			failing.add("wb");
			const first = await ask();
			expect(first.status, first.reason).toBe("done");
			expect(first.model).toBe("rightapi-glm/glm-5.3-flash");
			expect(calls.map((call) => call.route)).toEqual(["wb", "wb", "wb", "glm"]);
			expect(events).toEqual([
				{
					session,
					state: "fallback",
					from: { provider: "workbuddy", model: "deepseek-v4.1-flash" },
					to: { provider: "rightapi-glm", model: "glm-5.3-flash" },
					reason: "unavailable",
				},
			]);

			calls.length = 0;
			expect((await ask()).model).toBe("rightapi-glm/glm-5.3-flash");
			expect(events).toHaveLength(1);

			failing.delete("wb");
			calls.length = 0;
			const back = await ask();
			expect(back.model).toBe("workbuddy/deepseek-v4.1-flash");
			expect(events.at(-1)).toEqual({
				session,
				state: "recovered",
				from: { provider: "rightapi-glm", model: "glm-5.3-flash" },
				to: { provider: "workbuddy", model: "deepseek-v4.1-flash" },
				reason: "unavailable",
			});
			expect(events).toHaveLength(2);

			failing.add("wb");
			failing.add("glm");
			calls.length = 0;
			const failed = await ask();
			expect(failed.status).toBe("error");
			expect(calls.map((call) => call.route)).toEqual(["wb", "wb", "wb", "glm", "glm", "glm"]);
			// The fallback model's first retry waits the base delay again, not the run's grown backoff.
			const gaps = calls.slice(1).map((call, i) => call.at - calls[i]!.at);
			expect(gaps[3]!).toBeLessThan(gaps[2]! + 1000);
			expect(gaps[3]!).toBeLessThan(2500);
			expect(stopNotice(failed.reason ?? "")).toMatch(
				/^【系统】模型链没有跑通，这一轮没有完成。\n详情：503 controlled outage\n处理：过一会儿回我一句/u,
			);
			expect(events).toHaveLength(2);
		} finally {
			await runtime.close();
			server.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	200000,
);
