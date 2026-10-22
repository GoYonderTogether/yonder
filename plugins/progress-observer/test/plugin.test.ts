import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import plugin from "../src/index.js";
import { Ledger } from "../src/ledger.js";

it("reconciles pages without guessing task-session associations, deduplicates replays and retains unknown tasks", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observer-plugin-"));
	try {
		const ledger = await new Ledger(dir).open();
		await ledger.create("T", "task", { owner: "main", sourceSession: "source", sourceRun: "parent-event" });
		await ledger.create("T2", "parallel task", { owner: "main", sourceSession: "source", sourceRun: "parent-event" });
		await ledger.close();
		const first = {
			id: "open",
			type: "session.open",
			parent: "parent-event",
			ts: new Date(1).toISOString(),
			data: { session: "child", mode: "task" },
		};
		const second = {
			id: "end",
			type: "run.end",
			ts: new Date(2).toISOString(),
			data: { session: "child", status: "done" },
		};
		const unknown = {
			id: "orphan",
			type: "run.end",
			ts: new Date(3).toISOString(),
			data: { session: "unregistered-child", status: "done" },
		};
		let handler: ((event: any) => Promise<void>) | undefined;
		let trigger: any;
		let tool: any;
		let bindTool: any;
		let calls = 0;
		let links: any[] = [];
		const api: any = {
			paths: { data: dir },
			events: {
				on: (_type: string, callback: any) => {
					handler = callback;
				},
				query: async (query: any) => {
					calls++;
					if (query.type === "task.linked") return { events: links };
					if (query.after === "cursor-1") return { events: [second, unknown] };
					return { events: [first], next: "cursor-1" };
				},
			},
			tools: {
				register: (item: any) => {
					if (item.name === "progress-observer_task_bind") bindTool = item;
					else tool = item;
				},
			},
			triggers: {
				register: (item: any) => {
					trigger = item;
				},
			},
			sessions: { get: async (id: string) => ({ id, mode: "task", parent: "source" }) },
			log: { error: () => {} },
		};
		await plugin.setup(api);
		await trigger.start({});
		expect(calls).toBe(2);
		const state = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(state[0]).toMatchObject({ executor: "none", accepted: "unknown" });
		expect(state[0].executorSession).toBeUndefined();
		expect(state[0].seen).toEqual([]);
		expect(state[1].executorSession).toBeUndefined();
		expect(state[1].seen).toEqual([]);
		await handler?.(second);
		const replay = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(replay[0].seen).toEqual([]);
		await tool.execute(
			{ label: "Actual invocation", to: "conv:evil:room" },
			{
				agent: "main",
				session: "source",
				event: { id: "caller-input", type: "message.in", conv: "conv:real:room" },
				events: [{ id: "spoof", type: "message.in", conv: "conv:evil:room" }],
			},
		);
		const registered = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(registered[2]).toMatchObject({
			owner: "main",
			sourceSession: "source",
			sourceRun: "caller-input",
			target: "conv:real:room",
		});
		for (const [label, event, args] of [
			["acct source", { id: "acct-event", type: "message.in", conv: "acct:feishu:user-1" }, {}],
			["invalid source", { id: "bad-event", type: "message.in", conv: "conv:BAD:room" }, {}],
			["model target ignored", { id: "model-target", type: "message.in", conv: undefined }, { to: "conv:forged:room" }],
			["non-message", { id: "non-message", type: "session.input", conv: "conv:real:room" }, {}],
			["missing source", undefined, {}],
		] as const) {
			await tool.execute(
				{ label, ...args },
				{
					agent: "main",
					session: "source",
					event,
					events: [{ id: "history", type: "message.in", conv: "conv:history:room" }],
				},
			);
		}
		const boundary = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(boundary[3]).toMatchObject({ sourceRun: "acct-event", target: "acct:feishu:user-1" });
		expect(boundary[4]).toMatchObject({ sourceRun: "bad-event" });
		expect(boundary[4].target).toBeUndefined();
		expect(boundary[5]).toMatchObject({ sourceRun: "model-target" });
		expect(boundary[5].target).toBeUndefined();
		for (const item of boundary.slice(6)) {
			expect(item.sourceRun).toBeUndefined();
			expect(item.target).toBeUndefined();
		}
		expect(boundary[6].sourceSession).toBe("source");
		// Durable task.linked evidence is replayable and uniquely binds parallel work.
		links = [
			{ from: "system:runtime", data: { parentSession: "source", childSession: "child", sourceEvent: "parent-event" } },
			{
				from: "system:runtime",
				data: { parentSession: "different-owner", childSession: "child-2", sourceEvent: "parent-event" },
			},
		];
		api.sessions.get = async (id: string) => ({ id, mode: "task", parent: "source" });
		const bindCtx = { agent: "main", session: "source", events: [{ id: "parent-event", type: "session.input" }] };
		await expect(bindTool.execute({ taskId: "T", executorSession: "child" }, bindCtx)).resolves.toMatchObject({
			text: expect.stringContaining("Bound"),
		});
		await expect(bindTool.execute({ taskId: "T2", executorSession: "child-2" }, bindCtx)).rejects.toThrow(
			"runtime task.linked",
		);
		links = [
			{ from: "someone:else", data: { parentSession: "source", childSession: "other", sourceEvent: "parent-event" } },
		];
		await expect(bindTool.execute({ taskId: "T", executorSession: "other" }, bindCtx)).rejects.toThrow(
			"runtime task.linked",
		);
		await expect(
			bindTool.execute({ taskId: "T", executorSession: "other" }, { ...bindCtx, agent: "other" }),
		).rejects.toThrow("does not belong");
		await tool.execute(
			{ label: "Unknown source" },
			{ agent: "main", session: "source", events: [{ id: "noise", type: "run.start" }] },
		);
		const afterUnknown = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(afterUnknown.at(-1).sourceRun).toBeUndefined();
		await trigger.stop();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
