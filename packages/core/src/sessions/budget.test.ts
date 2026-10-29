import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseYonderConfig } from "../config/index.js";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { budgetBreaches, budgetEventType, budgetState, checkBudget } from "./budget.js";

// Real models only (WorkBuddy deepseek, keys from the pi credential store); nothing is stubbed.
const auth = process.env.YONDER_TEST_AUTH ?? resolve(homedir(), ".pi/agent/auth.json");
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth) && existsSync(catalog);

/** Recorded breach kinds, oldest first; a damaged row counts as unknown rather than failing the assertion. */
const eventKind = (data: string): string => {
	try {
		return (JSON.parse(data) as { kind?: string }).kind ?? "";
	} catch {
		return "";
	}
};
const eventKinds = async (db: Awaited<ReturnType<typeof openDatabase>>) =>
	(await db.all<{ data: string }>("SELECT data FROM y_events WHERE type = ? ORDER BY id", budgetEventType)).map((row) =>
		eventKind(row.data),
	);

test("only configured limits count as a breach, and 0 means unlimited", () => {
	const state = { tokens: 500, minutes: 3, wakeups: 2 };
	expect(budgetBreaches({ tokens: 0, overBudget: "record" }, state)).toEqual([]);
	expect(budgetBreaches(undefined, state)).toEqual([]);
	// Reaching a limit is not over it; every configured limit is checked on its own (M3).
	expect(budgetBreaches({ tokens: 500, maxMinutes: 3, maxWakeups: 2 }, state)).toEqual([]);
	expect(budgetBreaches({ tokens: 100, maxMinutes: 1, maxWakeups: 1, overBudget: "record" }, state)).toEqual([
		{ kind: "tokens", limit: 100, value: 500 },
		{ kind: "minutes", limit: 1, value: 3 },
		{ kind: "wakeups", limit: 1, value: 2 },
	]);
});

test("each breached limit is recorded once from the session's own usage", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-budget-"));
	const db = await openDatabase(join(home, "state.db"));
	try {
		await createStore(db);
		await db.run(
			"INSERT INTO y_sessions (id, agent, profile, mode, key, version, opened) VALUES (?, ?, ?, ?, ?, ?, ?)",
			7,
			null,
			"owner",
			"task",
			"key-7",
			"0.0.0",
			new Date(Date.now() - 120_000).toISOString(),
		);
		await db.run(
			"INSERT INTO y_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			"01BUDGETRUN00000000000000A",
			new Date(Date.now() - 60_000).toISOString(),
			"run.end",
			null,
			null,
			null,
			JSON.stringify({ session: "7", usage: { input: 600, output: 400 } }),
			null,
		);
		const config = parseYonderConfig(
			"schema: 1\nbudget:\n  tokens: 100\n  maxMinutes: 0.5\n  maxWakeups: 1\n  overBudget: record\n",
			"yonder.yaml",
		);
		const state = await budgetState(db, "7");
		expect(state.tokens).toBe(1000);
		expect(state.wakeups).toBe(1);
		expect(state.minutes).toBeGreaterThanOrEqual(1.9);
		// The run that just finished has no run.end yet, so its own usage and wakeup are added by the caller.
		await checkBudget({ db, config }, "7", { input: 10, output: 5 });
		await checkBudget({ db, config }, "7", { input: 10, output: 5 });
		expect((await eventKinds(db)).sort()).toEqual(["minutes", "tokens", "wakeups"]);
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});

test.skipIf(!real)(
	"low limits record budget.exceeded for every kind and the run still answers",
	async () => {
		const providers = (
			JSON.parse(readFileSync(catalog, "utf8")) as { providers: Record<string, Record<string, unknown>> }
		).providers;
		const home = await mkdtemp("/tmp/yonder-budget-live-");
		const db = await openDatabase(join(home, "state.db"));
		const store = await createStore(db);
		const config = parseYonderConfig(
			"schema: 1\nbudget:\n  tokens: 10\n  maxMinutes: 0.001\n  maxWakeups: 1\n  overBudget: record\n",
			"yonder.yaml",
		);
		const profile = resolveProfile({ model: "workbuddy/deepseek-v4.1-flash", thinking: "low", level: "readonly" });
		const runtime = await Runtime.open({
			home,
			db,
			config: {
				...config,
				credentials: auth,
				compaction: { enabled: false },
				retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
				models: { providers: { workbuddy: providers.workbuddy } },
			},
			resolveSession: async () => ({ agent: null, profile: "budget", cwd: home, resolved: profile }),
			// The kernel's delivery writes run.end for every finished run; this sink mirrors it so the session's own
			// history (usage, wakeups, start time) is what the budget check reads.
			onRun: async (id, run) => {
				await store.events.record({
					type: "run.end",
					data: { session: id, runId: run.runId, usage: run.usage, status: run.status },
				});
			},
		});
		try {
			const session = await runtime.create({ agent: null, profile: "budget", cwd: home });
			const first = await runtime.submit(session, { text: "Reply with the single word: pong" });
			expect(first.status, first.reason).toBe("done");
			// Over budget is recorded, not enforced: the run answered and the session accepts the next one (M5).
			// The first run has no earlier run.end, so the elapsed-time limit has no start to measure yet.
			expect((await eventKinds(db)).sort()).toEqual(["tokens"]);
			const second = await runtime.submit(session, { text: "Reply with the single word: pong" });
			expect(second.status, second.reason).toBe("done");
			expect((await eventKinds(db)).sort()).toEqual(["minutes", "tokens", "wakeups"]);
			// Nothing is recorded twice for the same session and kind.
			expect(await eventKinds(db)).toHaveLength(3);
		} finally {
			await runtime.close();
			await db.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
