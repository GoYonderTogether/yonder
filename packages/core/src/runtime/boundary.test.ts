import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real queued runs take their configuration at start and survive the preceding run's limit",
	async () => {
		const home = await mkdtemp("/tmp/yonder-boundary-");
		const db = await openDatabase(`${home}/state.db`);
		let profile = resolveProfile({ capabilities: ["exec"], tools: { offer: ["bash"] }, limits: { maxMinutes: 1 } });
		const runtime = await Runtime.open({
			home,
			db,
			config: { schema: 1, credentials: auth },
			resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
		});
		const queued = async () =>
			(await db.all<{ record: string }>("SELECT record FROM pi_submissions")).some(
				(row) => JSON.parse(row.record).status === "queued",
			);
		try {
			const session = await runtime.create({ agent: null, profile: "check", cwd: home });
			let started = false;
			const first = runtime.submit(session, {
				text: "Call bash twice sequentially. First command: sleep 3; printf first-tool. Wait for its result, then call bash with command: printf second-tool. After both tools, reply first-complete.",
				onOutput: (part) => {
					if (part.type === "tool" && part.phase === "start") started = true;
				},
			});
			await expect.poll(() => started, { timeout: 30000 }).toBe(true);
			const second = runtime.submit(session, { text: "Reply exactly second-complete. Do not call tools." });
			await expect.poll(queued, { timeout: 2000 }).toBe(true);
			profile = resolveProfile({
				model: "openai/gpt-6.1-sol",
				capabilities: ["read"],
				tools: { offer: ["read"] },
				limits: { maxMinutes: 1 },
			});
			const [a, b] = await Promise.all([first, second]);
			expect([a.status, b.status]).toEqual(["done", "done"]);
			expect(a.text).toContain("first-complete");
			expect(b.text).toContain("second-complete");
			expect(a.config?.resolved.model).toBe("openai/gpt-6-luna");
			expect(b.config?.resolved.model).toBe("openai/gpt-6.1-sol");
			const transcript = await runtime.transcript(session);
			expect(transcript.flatMap((item) => item.tools ?? []).filter((tool) => tool.name === "bash")).toHaveLength(2);
			const models = (
				await db.all<{ record: string }>(
					"SELECT record FROM pi_entries WHERE conversation_id = ? ORDER BY id",
					Number(session),
				)
			)
				.flatMap((row) => JSON.parse(row.record).model ?? [])
				.filter((message) => message.role === "assistant")
				.map((message) => message.model);
			expect(models.slice(0, -1).every((model) => model === "gpt-6-luna")).toBe(true);
			expect(models.at(-1)).toBe("gpt-6.1-sol");
			profile = resolveProfile({
				capabilities: ["exec"],
				tools: { offer: ["bash"] },
				limits: { maxTurns: 1, maxMinutes: 1 },
			});
			const limited = await runtime.create({ agent: null, profile: "check", cwd: home });
			started = false;
			const stopping = runtime.submit(limited, {
				text: "Call bash once with command: sleep 3; printf limit-check. Then report the output.",
				onOutput: (part) => {
					if (part.type === "tool" && part.phase === "start") started = true;
				},
			});
			await expect.poll(() => started, { timeout: 30000 }).toBe(true);
			const following = runtime.submit(limited, { text: "Reply exactly queued-after-limit. Do not call tools." });
			await expect.poll(queued, { timeout: 2000 }).toBe(true);
			profile = resolveProfile({ limits: { maxTurns: 5, maxMinutes: 1 } });
			const [c, d] = await Promise.all([stopping, following]);
			expect([c.status, c.reason, d.status]).toEqual(["limit", "maxTurns", "done"]);
			expect(d.text).toContain("queued-after-limit");
		} finally {
			await runtime.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	150000,
);

test("the run budget cancels context rendering before any model request", async () => {
	const home = await mkdtemp("/tmp/yonder-render-budget-");
	const runtime = await Runtime.open({
		home,
		db: await openDatabase(`${home}/state.db`),
		config: { schema: 1 },
		resolveSession: async () => ({
			agent: null,
			profile: "check",
			cwd: home,
			resolved: resolveProfile({ limits: { maxMinutes: 0.001 } }),
		}),
		sections: async (_session, signal) => {
			assert(signal);
			await once(signal, "abort");
			throw signal.reason;
		},
	});
	try {
		const session = await runtime.create({ agent: null, profile: "check", cwd: home });
		const run = await runtime.submit(session, { text: "N01 context cancellation verification" });
		expect([run.status, run.reason, run.usage.cost]).toEqual(["limit", "maxMinutes", 0]);
	} finally {
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});
