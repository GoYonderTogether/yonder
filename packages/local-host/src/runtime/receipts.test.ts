import type { RunReceiptState } from "@earendil-works/pi-durable";
import { resolveProfile } from "@yonder/local-host/config/test-support";
import { emptyUsage } from "@yonder/runtime-adapter/runtime/docs";
import type { RuntimeInternals } from "@yonder/runtime-adapter/runtime/instance";
import { receiptRun } from "@yonder/runtime-adapter/runtime/receipts";
import { expect, test, vi } from "vitest";

// Offline native-receipt/storage fixtures; no model or generated response is involved.
function fixture() {
	const config = { agent: null, profile: "check", cwd: "/tmp", resolved: resolveProfile({}) };
	const saved = { config: JSON.stringify(config), usageBefore: emptyUsage(), toolTasks: [] };
	const completed = new Set<string>();
	const state = { config, visibility: new AbortController(), timer: setTimeout(() => {}, 60_000) };
	const rt = {
		finishing: new Map(),
		harness: { snapshot: vi.fn(async () => saved) },
		storage: { submission: vi.fn(async () => undefined) },
		settleActivity: vi.fn(async () => {}),
		sources: vi.fn(async () => []),
		watch: { record: vi.fn(async () => {}) },
		outbox: { note: vi.fn(async () => {}) },
		idleChanged: vi.fn(async () => {}),
		limits: { states: new Map([["1", state]]) },
		submissions: new Map([["1", {}]]),
		configured: new Map([["1", config]]),
		options: {
			settled: vi.fn(async (_session: string, key: string) => completed.has(key)),
			onUsageSettled: vi.fn(async () => {}),
			onRun: vi.fn(async (_session: string, run: { runId: string }) => {
				completed.add(run.runId);
			}),
			onReport: vi.fn(),
		},
	};
	const receipt = {
		inputs: [1],
		usage: {},
		settlement: { status: "unanswered", reason: "aborted" },
	} as unknown as RunReceiptState;
	const finish = (key = "1") => receiptRun(rt as unknown as RuntimeInternals, "1", key, receipt);
	return { rt, state, finish };
}

test("concurrent and repeated receipt reads settle once, while continuation receipts still settle", async () => {
	const { rt, state, finish } = fixture();
	const [first, concurrent] = await Promise.all([finish(), finish()]);
	expect(concurrent).toEqual(first);
	expect(await finish()).toEqual(first);
	expect(rt.options.onUsageSettled).toHaveBeenCalledTimes(1);
	expect(rt.options.onRun).toHaveBeenCalledTimes(1);
	await finish("2");
	expect(rt.options.onUsageSettled).toHaveBeenCalledTimes(2);
	expect(state.visibility.signal.aborted).toBe(true);
	expect(rt.finishing.size).toBe(0);
});

test("health persistence failure is reported without losing durable completion or cleanup", async () => {
	const { rt, state, finish } = fixture();
	const failure = new Error("health persistence unavailable");
	rt.watch.record.mockRejectedValueOnce(failure);
	await finish();
	expect(rt.options.onReport).toHaveBeenCalledWith(failure);
	expect(rt.options.onRun).toHaveBeenCalledTimes(1);
	expect(state.visibility.signal.aborted).toBe(true);
	expect(rt.limits.states.size).toBe(0);
	expect(rt.submissions.size).toBe(0);
	expect(rt.configured.size).toBe(0);
});

test.each(["snapshot", "outbox", "completion"])(
	"%s failure remains retryable and releases active state",
	async (stage) => {
		const { rt, state, finish } = fixture();
		const failure = new Error(`${stage} unavailable`);
		if (stage === "snapshot") rt.harness.snapshot.mockRejectedValueOnce(failure);
		if (stage === "outbox") rt.outbox.note.mockRejectedValueOnce(failure);
		if (stage === "completion") rt.options.onRun.mockRejectedValueOnce(failure);
		await expect(finish()).rejects.toThrow(failure);
		expect(state.visibility.signal.aborted).toBe(true);
		expect(rt.limits.states.size).toBe(0);
		expect(rt.submissions.size).toBe(0);
		expect(rt.finishing.size).toBe(0);
		await expect(finish()).resolves.toMatchObject({ status: "aborted" });
	},
);
