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
		await ledger.create("T", "task", { sourceSession: "source", sourceRun: "parent-event" });
		await ledger.create("T2", "parallel task", { sourceSession: "source", sourceRun: "parent-event" });
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
		let calls = 0;
		const api: any = {
			paths: { data: dir },
			events: {
				on: (_type: string, callback: any) => {
					handler = callback;
				},
				query: async (query: any) => {
					calls++;
					if (query.after === "cursor-1") return { events: [second, unknown] };
					return { events: [first], next: "cursor-1" };
				},
			},
			tools: {
				register: (item: any) => {
					tool = item;
				},
			},
			triggers: {
				register: (item: any) => {
					trigger = item;
				},
			},
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
		await trigger.stop();
		const replay = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(replay[0].seen).toEqual([]);
		await tool.execute(
			{ label: "Actual invocation" },
			{ agent: "main", session: "source", events: [{ id: "caller-input", type: "session.input" }] },
		);
		const registered = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8"));
		expect(registered[2]).toMatchObject({
			owner: "main",
			sourceSession: "source",
			sourceRun: "caller-input",
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
