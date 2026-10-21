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

test("owner sources share a steered main session while Feishu observers only write", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const identity = store.identity();
		await identity.createPerson({ id: "owner", name: "Owner" });
		await identity.link("acct:cli:owner", "person:owner");
		await identity.link("acct:feishu:owner", "person:owner");
		const agent = parseAgentConfig(
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: observer
profiles:
  owner: { level: standard }
  observer: { level: readonly }
bindings:
  - id: cli-owner
    match: { channel: cli, from: owner }
    session: main
    profile: owner
    busy: steer
  - id: feishu-owner
    match: { channel: feishu, from: owner }
    session: main
    profile: owner
    busy: steer
  - id: feishu-group-observer
    match: { channel: feishu, kind: group, from: [known, stranger] }
    session: { mode: persistent, per: conv }
    profile: observer
    wake: write
  - id: feishu-dm-observer
    match: { channel: feishu, kind: dm, from: [known, stranger] }
    session: { mode: persistent, per: conv }
    profile: observer
    wake: write
`,
			"agent.yaml",
			"main",
		);
		const submitted: Array<{ id: string; input: { wake: "run" | "write"; busy?: "followup" | "steer" } }> = [];
		let nextSession = 100;
		let submitDone!: () => void;
		const allSubmitted = new Promise<void>((resolve) => {
			submitDone = resolve;
		});
		const runtime = {
			create: async () => String(nextSession++),
			submit: async (id: string, input: { wake: "run" | "write"; busy?: "followup" | "steer" }) => {
				submitted.push({ id, input });
				if (submitted.length === 4) submitDone();
				return {
					runId: `run-${submitted.length}`,
					status: "done" as const,
					text: "",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
					inputs: [],
				};
			},
		} as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents: new Map([[agent.id, agent]]),
			homePresets: new Map(),
			pluginPresets: new Map(),
			home: "/tmp/yonder-routing",
			config: { agents: [{ id: "main", workspace: "./agents/main" }] } as YonderConfig,
			version: "0.1.0",
			runtime: () => runtime,
		});
		const commandSessions: string[] = [];
		const router = createRouter({
			store,
			sessions,
			runtime: () => runtime,
			agents: new Map([[agent.id, agent]]),
			onCommand: async (session) => {
				commandSessions.push(session.id);
				return undefined;
			},
		});
		const emit = (from: string, channel: string, room: string, kind: "dm" | "group") =>
			router.emit({
				type: "message.in",
				from,
				conv: `conv:${channel}:${room}`,
				data: { kind, text: "hello" },
			});
		const [cliOwner, feishuOwner, group, dm] = await Promise.all([
			emit("acct:cli:owner", "cli", "owner", "dm"),
			emit("acct:feishu:owner", "feishu", "owner", "dm"),
			emit("acct:feishu:other", "feishu", "group", "group"),
			emit("acct:feishu:other", "feishu", "dm", "dm"),
		]);
		await allSubmitted;
		const cliRoute = cliOwner.routes?.[0];
		const feishuRoute = feishuOwner.routes?.[0];
		const groupRoute = group.routes?.[0];
		const dmRoute = dm.routes?.[0];
		expect(cliRoute?.session).toBe(feishuRoute?.session);
		expect(cliRoute).toMatchObject({ wake: "run", busy: "steer" });
		expect(feishuRoute).toMatchObject({ wake: "run", busy: "steer" });
		expect(groupRoute).toMatchObject({ wake: "write", busy: "followup" });
		expect(dmRoute).toMatchObject({ wake: "write", busy: "followup" });
		expect(groupRoute?.session).not.toBe(cliRoute?.session);
		expect(dmRoute?.session).not.toBe(groupRoute?.session);
		expect(commandSessions).toHaveLength(2);
		expect(new Set(commandSessions)).toEqual(new Set([cliRoute?.session, feishuRoute?.session]));
		expect(submitted.filter(({ input }) => input.wake === "run").map(({ input }) => input.busy)).toEqual([
			"steer",
			"steer",
		]);
		expect(submitted).toHaveLength(4);
	} finally {
		await db.close();
	}
});
