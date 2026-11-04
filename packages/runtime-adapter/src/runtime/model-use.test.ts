import { expect, test } from "vitest";
import { type ModelQuotaPort, ModelUse } from "./model-use.js";

/** A port that keeps every call in order, so the test can assert exactly what the runtime asked for. */
function port(options: { refuse?: string } = {}) {
	const calls: Array<{ kind: "check" | "record"; run?: string; tokens?: { input: number; output: number } }> = [];
	const value: ModelQuotaPort = {
		async check({ run }) {
			calls.push({ kind: "check", ...(run ? { run } : {}) });
			return options.refuse;
		},
		async record({ run }, tokens) {
			calls.push({ kind: "record", ...(run ? { run } : {}), tokens });
		},
	};
	return { calls, port: value };
}

test("charges the provider's billed input and output and never cache reads", async () => {
	const { calls, port: quota } = port();
	const use = new ModelUse(() => quota);
	// A full provider usage record carries cacheRead/cacheWrite too; only input + output are charged.
	const withCache = { input: 900, output: 100, cacheRead: 50_000, cacheWrite: 0 };
	await use.charge("session", "run-1", withCache);
	await use.charge("session", "run-1", { ...withCache, input: 1000, output: 0 });
	await use.settle("session", "run-1", { input: 1900, output: 100 });
	expect(calls.map((call) => call.tokens)).toEqual([
		{ input: 900, output: 100 },
		{ input: 1000, output: 0 },
	]);
});

test("settlement charges what the attempts did not: compaction inside the same run", async () => {
	const { calls, port: quota } = port();
	const use = new ModelUse(() => quota);
	await use.charge("session", "run-2", { input: 400, output: 100 });
	// The run's total also contains a 500-token compaction summary; settlement charges exactly that difference.
	await use.settle("session", "run-2", { input: 900, output: 100 });
	expect(calls.map((call) => call.tokens)).toEqual([
		{ input: 400, output: 100 },
		{ input: 500, output: 0 },
	]);
	// A run whose attempts already cover the total charges nothing twice.
	await use.charge("session", "run-3", { input: 700, output: 300 });
	await use.settle("session", "run-3", { input: 700, output: 300 });
	expect(calls.filter((call) => call.run === "run-3")).toHaveLength(1);
});

test("a host without a quota port is asked nothing", async () => {
	const use = new ModelUse(undefined);
	expect(use.port("session")).toBeUndefined();
	await expect(use.charge("session", "run-4", { input: 10, output: 10 })).resolves.toBeUndefined();
	await expect(use.settle("session", "run-4", { input: 20, output: 10 })).resolves.toBeUndefined();
	expect(await use.check("session", "run-4")).toBeUndefined();
});

test("the host's refusal is passed through verbatim as the run's reason", async () => {
	const { port: quota } = port({ refuse: "本周的模型额度已用完（已用 1000 / 1000 tokens），下周一会重置。" });
	const use = new ModelUse(() => quota);
	expect(await use.check("session", "run-5")).toBe("本周的模型额度已用完（已用 1000 / 1000 tokens），下周一会重置。");
});

test("abandoned runs drop their bookkeeping without touching what was already charged", async () => {
	const { calls, port: quota } = port();
	const use = new ModelUse(() => quota);
	await use.charge("session", "run-6", { input: 10, output: 5 });
	use.forget("run-6");
	await use.settle("session", "run-6", { input: 10, output: 5 });
	// Nothing was charged twice after forgetting.
	expect(calls).toHaveLength(1);
});
