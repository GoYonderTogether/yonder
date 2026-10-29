import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

// Real models only (WorkBuddy deepseek as primary, RightAPI glm as the fallback), both from the real catalog,
// with their keys from the pi credential store.
// The primary is unreachable because its port is genuinely closed; nothing is stubbed.
const auth = process.env.YONDER_TEST_AUTH ?? resolve(homedir(), ".pi/agent/auth.json");
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth) && existsSync(catalog);

test.skipIf(!real)(
	"models.chain supplies the fallback chain: a closed workbuddy port lands on glm-5.3-flash",
	async () => {
		const providers = (
			JSON.parse(readFileSync(catalog, "utf8")) as { providers: Record<string, Record<string, unknown>> }
		).providers;
		// A port that really refuses connections: bind it, read the number, close it, never listen again.
		const probe = createServer();
		await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
		const closed = (probe.address() as { port: number }).port;
		await new Promise<void>((done) => probe.close(() => done()));
		const home = await mkdtemp("/tmp/yonder-chain-config-");
		// The profile names no fallback of its own, so the home-wide models.chain is what makes this work.
		const profile = resolveProfile({ model: "workbuddy/deepseek-v4.1-flash", thinking: "low", level: "readonly" });
		const runtime = await Runtime.open({
			home,
			db: await openDatabase(`${home}/state.db`),
			config: {
				schema: 1,
				credentials: auth,
				compaction: { enabled: false },
				retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
				models: {
					chain: ["workbuddy", "rightapi-glm/glm-5.3-flash"],
					providers: {
						workbuddy: { ...providers.workbuddy, baseUrl: `http://127.0.0.1:${closed}/v1` },
						"rightapi-glm": providers["rightapi-glm"],
					},
				},
			},
			resolveSession: async () => ({ agent: null, profile: "chain", cwd: home, resolved: profile }),
		});
		try {
			expect(profile.fallback).toBeUndefined();
			const session = await runtime.create({ agent: null, profile: "chain", cwd: home });
			const result = await runtime.submit(session, { text: "Reply with the single word: pong" });
			expect(result.status, result.reason).toBe("done");
			expect(result.model).toBe("rightapi-glm/glm-5.3-flash");
		} finally {
			await runtime.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
