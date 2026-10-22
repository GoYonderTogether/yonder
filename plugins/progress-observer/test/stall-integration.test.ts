import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { Ledger } from "../src/ledger.js";

const source = "conv:test:owner";
const owner = "agent:test";

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("timed out waiting for scheduled stall tick");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

async function setup(dir: string, send: ReturnType<typeof vi.fn>, config: Record<string, unknown> = {}) {
	let trigger: { start(context: unknown): Promise<void>; stop(): Promise<void> } | undefined;
	let handler: (event: Record<string, unknown>) => Promise<void> = async () => {};
	const logError = vi.fn();
	const api = {
		config: {
			enabled: true,
			intervalMs: 1000,
			stallAfterMs: 1000,
			minTasks: 1,
			allowedSourceConversations: [source],
			allowedAgents: [owner],
			...config,
		},
		paths: { data: dir },
		log: { error: logError },
		events: {
			on: (_: string, fn: typeof handler) => (handler = fn),
			query: async () => ({ events: [] }),
		},
		tools: { register: vi.fn() },
		triggers: { register: (value: typeof trigger) => (trigger = value) },
		messages: { send },
	} as unknown as PluginAPI;
	await plugin.setup(api);
	if (!trigger) throw new Error("reconcile trigger was not registered");
	await trigger.start({});
	return { trigger, event: handler, api, logError };
}

async function seed(dir: string, id: string, taskConfig: Record<string, unknown> = {}) {
	const ledger = await new Ledger(dir).open();
	await ledger.create(id, "task", {
		target: source,
		owner,
		executorSession: `child:${id}`,
		...taskConfig,
	});
	await ledger.close();
}

it("deduplicates the same stall evidence window across trigger close/reopen with the same data path", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-stall-restart-"));
	const send = vi.fn(async () => ({ ok: true }));
	let first: Awaited<ReturnType<typeof setup>> | undefined;
	let reopened: Awaited<ReturnType<typeof setup>> | undefined;
	try {
		await seed(dir, "restart-task");
		first = await setup(dir, send);
		await first.event({
			id: "old-run-end",
			type: "run.end",
			ts: new Date(Date.now() - 10_000).toISOString(),
			data: { session: "child:restart-task", status: "aborted" },
		});
		await waitFor(() => send.mock.calls.length === 1);
		await first.trigger.stop();
		first = undefined;

		reopened = await setup(dir, send);
		await new Promise((resolve) => setTimeout(resolve, 1150));
		expect(send).toHaveBeenCalledTimes(1);
		await reopened.trigger.stop();
		reopened = undefined;
		const durable = await new Ledger(dir).open();
		const task = (await durable.list())[0];
		await durable.close();
		expect(task.seen.filter((id) => id === `stall:restart-task:${task.lastExecutorEventAt}:0`)).toHaveLength(1);
	} finally {
		await first?.trigger.stop().catch(() => {});
		await reopened?.trigger.stop().catch(() => {});
		await rm(dir, { recursive: true, force: true });
	}
});

it("does not call model or sender for quiet evidence or either rejected allowlist", async () => {
	for (const scenario of ["quiet", "source", "agent"] as const) {
		const dir = await mkdtemp(join(tmpdir(), `observer-stall-${scenario}-`));
		const send = vi.fn(async () => ({ ok: true }));
		const completeSimple = vi.fn(async () => ({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						decision: "notify",
						evidence: ["stall:blocked:1:0"],
						text: "not sent",
					}),
				},
			],
		}));
		let active: Awaited<ReturnType<typeof setup>> | undefined;
		try {
			await seed(dir, "blocked");
			if (scenario === "quiet") {
				const ledger = await new Ledger(dir).open();
				await ledger.event({
					id: "quiet-now",
					task: "blocked",
					type: "quiet",
					at: Date.now(),
					until: Date.now() + 60_000,
				});
				await ledger.close();
			}
			active = await setup(dir, send, {
				...(scenario === "source" ? { allowedSourceConversations: ["conv:other:owner"] } : {}),
				...(scenario === "agent" ? { allowedAgents: ["agent:other"] } : {}),
				model: { provider: "local-test", modelId: "model" },
			});
			active.api.models = {
				getModel: vi.fn(() => ({ provider: "local-test", id: "model" })),
				completeSimple,
			};
			await active.event({
				id: `old-${scenario}`,
				type: "run.end",
				ts: new Date(Date.now() - 10_000).toISOString(),
				data: { session: "child:blocked", status: "aborted" },
			});
			await new Promise((resolve) => setTimeout(resolve, 1150));
			expect(completeSimple, scenario).not.toHaveBeenCalled();
			expect(send, scenario).not.toHaveBeenCalled();
			await active.trigger.stop();
			active = undefined;
		} finally {
			await active?.trigger.stop().catch(() => {});
			await rm(dir, { recursive: true, force: true });
		}
	}
});

it("treats aged done-but-unaccepted work as missing progress, and opens one new window per milestone", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-stall-window-"));
	const send = vi.fn(async () => ({ ok: true }));
	let active: Awaited<ReturnType<typeof setup>> | undefined;
	try {
		await seed(dir, "window-task");
		active = await setup(dir, send, { stallAfterMs: 3000 });
		await active.event({
			id: "done-not-accepted",
			type: "run.end",
			ts: new Date(Date.now() - 10_000).toISOString(),
			data: { session: "child:window-task", status: "done" },
		});
		await waitFor(() => send.mock.calls.length === 1);
		expect(send.mock.calls[0][0].text).toContain("超过配置停滞阈值没有新的进展证据");
		expect(send.mock.calls[0][0].text).not.toMatch(/任务已完成|结果已完成|执行成功/);

		await active.trigger.stop();
		active = undefined;
		const ledger = await new Ledger(dir).open();
		const before = (await ledger.list())[0];
		const priorWindow = `stall:window-task:${before.lastExecutorEventAt}:0`;
		expect(before.seen).toContain(priorWindow);
		const milestoneAt = Date.now();
		await ledger.event({
			id: "genuine-milestone",
			task: "window-task",
			type: "milestone",
			at: milestoneAt,
			value: "checkpoint",
		});
		await ledger.close();
		active = await setup(dir, send, { stallAfterMs: 3000 });
		await new Promise((resolve) => setTimeout(resolve, 1100));
		expect(send).toHaveBeenCalledTimes(1);
		await waitFor(() => send.mock.calls.length === 2, 4000);
		expect(send.mock.calls[1][0].text).toContain("超过配置停滞阈值没有新的进展证据");
		await active.trigger.stop();
		active = undefined;
		const after = await new Ledger(dir).open();
		const task = (await after.list())[0];
		await after.close();
		expect(task.lastMilestoneAt).toBe(milestoneAt);
		expect(task.seen).toContain(`stall:window-task:${task.lastExecutorEventAt}:${milestoneAt}`);
		expect(task.seen.filter((id) => id.startsWith("stall:window-task:")).length).toBe(2);
	} finally {
		await active?.trigger.stop().catch(() => {});
		await rm(dir, { recursive: true, force: true });
	}
});

it("uses a resumed session input as the next real evidence window exactly once", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-stall-resume-"));
	const send = vi.fn(async () => ({ ok: true }));
	let active: Awaited<ReturnType<typeof setup>> | undefined;
	try {
		await seed(dir, "resume-task");
		active = await setup(dir, send, { stallAfterMs: 2000 });
		await active.event({
			id: "old-interruption",
			type: "run.end",
			ts: new Date(Date.now() - 10_000).toISOString(),
			data: { session: "child:resume-task", status: "aborted" },
		});
		await waitFor(() => send.mock.calls.length === 1);
		const resumedAt = Date.now();
		await active.event({
			id: "resumed-input",
			type: "session.input",
			ts: new Date(resumedAt).toISOString(),
			data: { session: "child:resume-task" },
		});
		await new Promise((resolve) => setTimeout(resolve, 1100));
		expect(send).toHaveBeenCalledTimes(1);
		await waitFor(() => send.mock.calls.length === 2, 3000);
		await new Promise((resolve) => setTimeout(resolve, 1100));
		expect(send).toHaveBeenCalledTimes(2);
		await active.trigger.stop();
		active = undefined;
		const ledger = await new Ledger(dir).open();
		const task = (await ledger.list())[0];
		await ledger.close();
		expect(task.lastExecutorEventAt).toBe(resumedAt);
		expect(task.seen).toContain(`stall:resume-task:${resumedAt}:0`);
	} finally {
		await active?.trigger.stop().catch(() => {});
		await rm(dir, { recursive: true, force: true });
	}
});
