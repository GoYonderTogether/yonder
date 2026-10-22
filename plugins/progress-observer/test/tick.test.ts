import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { Ledger } from "../src/ledger.js";

async function boot(dir: string, config: object, send: (input: unknown) => Promise<unknown>) {
	let trigger: any;
	const api: any = {
		config,
		paths: { data: dir },
		log: { error: vi.fn() },
		events: { on: vi.fn(), query: async () => ({ events: [] }) },
		tools: { register: vi.fn() },
		triggers: {
			register: (value: unknown) => {
				trigger = value;
			},
		},
		messages: { send },
	};
	await plugin.setup(api);
	await trigger.start({});
	return { trigger, api };
}

afterEach(() => vi.useRealTimers());

it("disabled by default does not send", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-tick-off-"));
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("t", "task", { target: "conv:matrix:room" });
		await ledger.event({ id: "fact", task: "t", type: "executor.missing", at: 1 });
		const send = vi.fn(async () => ({ ok: true }));
		const { trigger } = await boot(dir, {}, send);
		expect(send).not.toHaveBeenCalled();
		await trigger.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("enabled tick sends fallback once; durable unknown survives restart without retry", async () => {
	vi.useFakeTimers();
	const dir = await mkdtemp(join(tmpdir(), "observer-tick-on-"));
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("t", "task", { target: "conv:matrix:room" });
		await ledger.event({ id: "fact", task: "t", type: "executor.missing", at: 1 });
		const send = vi.fn(async () => {
			throw new Error("ambiguous transport");
		});
		const first = await boot(dir, { enabled: true, intervalMs: 1000, minTasks: 1 }, send);
		await vi.advanceTimersByTimeAsync(1000);
		await first.trigger.stop();
		expect(first.api.log.error).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toMatchObject({ to: "conv:matrix:room" });
		const restarted = await boot(dir, { enabled: true, intervalMs: 1000, minTasks: 1 }, send);
		await vi.advanceTimersByTimeAsync(3000);
		expect(send).toHaveBeenCalledTimes(1);
		await restarted.trigger.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("enabled tick never sends when source target is absent and clears its timer on stop", async () => {
	vi.useFakeTimers();
	const dir = await mkdtemp(join(tmpdir(), "observer-tick-target-"));
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("t", "task");
		await ledger.event({ id: "fact", task: "t", type: "executor.missing", at: 1 });
		const send = vi.fn(async () => ({ ok: true }));
		const { trigger } = await boot(dir, { enabled: true, intervalMs: 1000, minTasks: 1 }, send);
		await vi.advanceTimersByTimeAsync(1000);
		expect(send).not.toHaveBeenCalled();
		await trigger.stop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(send).not.toHaveBeenCalled();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
