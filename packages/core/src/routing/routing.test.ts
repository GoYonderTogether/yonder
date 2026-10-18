import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createRouter } from "./index.js";

test("routes to the first matching binding and derives its conversation key", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const agent = parseAgentConfig(
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: {}
bindings:
  - id: first
    match: { channel: cli, kind: group }
    session: { mode: persistent, per: conv }
    profile: guest
    wake: write
  - id: second
    match: { channel: cli }
    session: { mode: persistent, per: conv }
    profile: guest
  - id: cron
    match: { type: trigger-cron.fired }
    session: main
    profile: guest
`,
			"agent.yaml",
			"main",
		);
		let submitted: (input: { wake?: string }) => void = () => {};
		let nextSession = 42;
		const runtime = {
			create: async () => String(nextSession++),
			submit: async (_id: string, input: { wake?: "run" | "write"; event?: { id: string } }) => {
				submitted(input);
				return {
					runId: "run",
					status: "done" as const,
					text: "",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
					inputs: input.event ? [input.event.id] : [],
				};
			},
		} as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents: new Map([[agent.id, agent]]),
			homePresets: new Map(),
			pluginPresets: new Map(),
			home: "/tmp/yonder",
			config: { agents: [{ id: "main", workspace: "./agents/main" }] } as YonderConfig,
			version: "0.1.0",
			runtime: () => runtime,
		});
		const router = createRouter({ store, sessions, runtime: () => runtime, agents: new Map([[agent.id, agent]]) });
		let submitDone!: () => void;
		let submits = 0;
		const wasSubmitted = new Promise<void>((resolve) => {
			submitDone = resolve;
		});
		submitted = () => {
			if (++submits === 2) submitDone();
		};
		const event = await router.emit({
			type: "message.in",
			from: "acct:cli:owner",
			conv: "conv:cli:room",
			data: { kind: "group", text: "hello" },
		});
		const cron = await router.emit({ type: "trigger-cron.fired", from: "plugin:trigger-cron", data: {} });
		await wasSubmitted;
		expect(event.routes).toEqual([
			{ agent: "main", binding: "first", session: "42", wake: "write", busy: "followup", waiting: false },
		]);
		expect(cron.routes).toEqual([
			{ agent: "main", binding: "cron", session: "43", wake: "run", busy: "followup", waiting: false },
		]);
		expect((await store.sessions.get("42"))?.key).toBe("conv:conv:cli:room");
	} finally {
		await db.close();
	}
});
