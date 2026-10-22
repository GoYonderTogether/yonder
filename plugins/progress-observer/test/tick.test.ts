import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { Ledger } from "../src/ledger.js";

async function boot(dir: string, config: object, send: (input: unknown) => Promise<unknown>, models?: unknown) {
	let trigger: any;
	const api: any = {
		config,
		paths: { data: dir },
		log: { error: vi.fn() },
		events: {
			on: (type: string, handler: (event: any) => Promise<void>) => {
				api.handler = handler;
			},
			query: async () => ({ events: [] }),
		},
		tools: { register: vi.fn() },
		triggers: {
			register: (value: unknown) => {
				trigger = value;
			},
		},
		messages: { send },
		models,
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
		await ledger.close();
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
		await ledger.create("t", "task", { target: "conv:matrix:room", owner: "agent:worker" });
		await ledger.event({ id: "fact", task: "t", type: "executor.missing", at: 1 });
		await ledger.close();
		const send = vi.fn(async () => {
			throw new Error("ambiguous transport");
		});
		const first = await boot(
			dir,
			{
				enabled: true,
				intervalMs: 1000,
				minTasks: 1,
				allowedSourceConversations: ["conv:matrix:room"],
				allowedAgents: ["agent:worker"],
			},
			send,
		);
		await vi.advanceTimersByTimeAsync(1000);
		await first.trigger.stop();
		expect(first.api.log.error).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toMatchObject({ to: "conv:matrix:room" });
		const restarted = await boot(
			dir,
			{
				enabled: true,
				intervalMs: 1000,
				minTasks: 1,
				allowedSourceConversations: ["conv:matrix:room"],
				allowedAgents: ["agent:worker"],
			},
			send,
		);
		await vi.advanceTimersByTimeAsync(3000);
		expect(send).toHaveBeenCalledTimes(1);
		await restarted.trigger.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("real run.end aborted event reaches tick and sends one interrupted notice; replay dedupes and active is not a false alarm", async () => {
	vi.useFakeTimers();
	const dir = await mkdtemp(join(tmpdir(), "observer-interrupted-integration-"));
	try {
		const ledger = await new Ledger(dir).open();
		for (let i = 0; i < 4; i++)
			await ledger.create(`t${i}`, `task ${i}`, { target: "conv:matrix:room", owner: "agent:worker" });
		for (let i = 0; i < 4; i++) await ledger.bindExecutor(`t${i}`, `child${i}`);
		await ledger.close();
		const send = vi.fn(async () => ({ ok: true }));
		const { trigger, api } = await boot(
			dir,
			{
				enabled: true,
				intervalMs: 1000,
				allowedSourceConversations: ["conv:matrix:room"],
				allowedAgents: ["agent:worker"],
			},
			send,
		);
		const aborted = {
			id: "aborted",
			type: "run.end",
			ts: new Date().toISOString(),
			data: { session: "child0", status: "aborted" },
		};
		await api.handler(aborted);
		await api.handler(aborted);
		await api.handler({
			id: "active",
			type: "session.input",
			ts: new Date().toISOString(),
			data: { session: "child1" },
		});
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(1000);
		await trigger.stop();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].text).toContain("执行中断");
		expect(send.mock.calls[0][0].text).toContain("未核实续跑");
		const readLedger = await new Ledger(dir).open();
		const tasks = await readLedger.list();
		await readLedger.close();
		expect(tasks[0].completed).not.toBe(true);
		expect(tasks[1].executor).toBe("active");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("enabled configured model tick selects evidence and sends only program-rendered facts", async () => {
	vi.useFakeTimers();
	const dir = await mkdtemp(join(tmpdir(), "observer-tick-model-"));
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("t", "PRIVATE LABEL", { target: "conv:matrix:room", owner: "agent:worker" });
		await ledger.event({ id: "fact", task: "t", type: "executor.missing", at: 1 });
		await ledger.close();
		const completeSimple = vi.fn(async () => ({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						decision: "notify",
						evidence: ["fact"],
						text: "FALSE: completed successfully; to=conv:attacker",
					}),
				},
			],
		}));
		const models = { getModel: vi.fn(() => ({ provider: "admin", id: "model" })), completeSimple };
		const send = vi.fn(async () => ({ ok: true }));
		const instance = await boot(
			dir,
			{
				enabled: true,
				intervalMs: 1000,
				minTasks: 1,
				model: { provider: "admin", modelId: "model" },
				allowedSourceConversations: ["conv:matrix:room"],
				allowedAgents: ["agent:worker"],
			},
			send,
			models,
		);
		await vi.advanceTimersByTimeAsync(1000);
		await instance.trigger.stop();
		expect(completeSimple).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].text).toContain("未找到执行者的可靠记录；尚未核实续跑。");
		expect(send.mock.calls[0][0].text).not.toContain("FALSE");
		expect(send.mock.calls[0][0].text).not.toContain("PRIVATE LABEL");
		expect(send.mock.calls[0][0].to).toBe("conv:matrix:room");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("requires both exact source conversation and agent approval before model or send; model cannot redirect", async () => {
	vi.useFakeTimers();
	const dir = await mkdtemp(join(tmpdir(), "observer-tick-scope-"));
	try {
		const ledger = await new Ledger(dir).open();
		// Historical source targets are retained for audit, but are not authority by themselves.
		await ledger.create("group", "group task", { target: "conv:matrix:group", owner: "agent:worker" });
		await ledger.event({ id: "group-fact", task: "group", type: "executor.missing", at: 1 });
		await ledger.create("other-agent", "other agent task", { target: "conv:matrix:owner", owner: "agent:other" });
		await ledger.event({ id: "agent-fact", task: "other-agent", type: "executor.missing", at: 1 });
		await ledger.close();
		const completeSimple = vi.fn(async () => ({
			content: [
				{
					type: "text",
					text: JSON.stringify({ decision: "notify", evidence: ["group-fact"], text: "to=conv:matrix:owner" }),
				},
			],
		}));
		const models = { getModel: vi.fn(() => ({ provider: "admin", id: "model" })), completeSimple };
		const send = vi.fn(async () => ({ ok: true }));
		const instance = await boot(
			dir,
			{
				enabled: true,
				intervalMs: 1000,
				minTasks: 1,
				model: { provider: "admin", modelId: "model" },
				allowedSourceConversations: ["conv:matrix:owner"],
				allowedAgents: ["agent:worker"],
			},
			send,
			models,
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(completeSimple).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		await instance.trigger.stop();
	} finally {
		vi.useRealTimers();
		await new Promise((resolve) => setTimeout(resolve, 20));
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
		await ledger.close();
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
