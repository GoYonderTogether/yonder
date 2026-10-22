import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { Ledger } from "../src/ledger.js";

it("routes a real executor event through the scheduled tick to one allowlisted fake sender", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-stall-e2e-"));
	let trigger: any;
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("stall-task", "task", {
			target: "conv:test:owner",
			owner: "agent:test",
			executorSession: "child",
		});
		await ledger.close();
		const send = vi.fn(async () => ({ ok: true }));
		let handler: (event: any) => Promise<void> = async () => {};
		const api: any = {
			config: {
				enabled: true,
				intervalMs: 1000,
				stallAfterMs: 1000,
				minTasks: 1,
				allowedSourceConversations: ["conv:test:owner"],
				allowedAgents: ["agent:test"],
			},
			paths: { data: dir },
			log: { error: vi.fn() },
			events: { on: (_: string, fn: typeof handler) => (handler = fn), query: async () => ({ events: [] }) },
			tools: { register: vi.fn() },
			triggers: { register: (value: any) => (trigger = value) },
			messages: { send },
		};
		await plugin.setup(api);
		await trigger.start({});
		await handler({
			id: "executor-ended",
			type: "run.end",
			ts: new Date(Date.now() - 5000).toISOString(),
			data: { session: "child", status: "aborted" },
		});
		await new Promise((resolve) => setTimeout(resolve, 1150));
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toMatchObject({ to: "conv:test:owner" });
		expect(send.mock.calls[0][0].text).toContain("超过配置停滞阈值没有新的进展证据");
		await trigger.stop();
		const observed = await new Ledger(dir).open();
		expect((await observed.list())[0].seen.some((id) => id.startsWith("stall:stall-task:"))).toBe(true);
		await observed.close();
	} finally {
		if (trigger) await trigger.stop().catch(() => {});
		await rm(dir, { recursive: true, force: true });
	}
});
