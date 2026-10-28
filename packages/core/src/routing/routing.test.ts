import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createRouter } from "./index.js";
import { socialDecision } from "./social.js";

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
			{ agent: "main", binding: "first", session: "42", wake: "write", busy: "steer", waiting: false },
		]);
		expect(cron.routes).toEqual([
			{ agent: "main", binding: "cron", session: "43", wake: "run", busy: "steer", waiting: false },
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
		expect(groupRoute).toMatchObject({ wake: "write", busy: "steer" });
		expect(dmRoute).toMatchObject({ wake: "write", busy: "steer" });
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

test("multiAgent targets only its own bound agent; ordinary channels cannot target", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const make = (id: string, bound: boolean) =>
			parseAgentConfig(
				`schema: 1\nid: ${id}\nname: ${id}\nowner: person:owner\ndefaultProfile: guest\nprofiles:\n  guest: {}\nbindings: ${bound ? "\n  - id: incoming\n    match: { channel: card, kind: dm }\n    session: { mode: persistent, per: conv }\n    wake: write" : "[]"}\n`,
				"agent.yaml",
				id,
			);
		const agents = new Map([
			["one", make("one", true)],
			["two", make("two", true)],
			["unbound", make("unbound", false)],
		]);
		let session = 0;
		const sessions = {
			ensureAgent: async (agent: string, profile: string) => ({ session: { id: String(++session), agent, profile } }),
		} as unknown as Parameters<typeof createRouter>[0]["sessions"];
		const channels = new Map<string, import("@yonder/sdk").Channel>([
			["card", { multiAgent: true } as import("@yonder/sdk").Channel],
		]);
		// wake:write never calls a model; no runtime is needed to inspect durable routes.
		const router = createRouter({
			store,
			sessions,
			agents,
			channels,
			runtime: () => {
				throw new Error("No model");
			},
		});
		const input = (target: string) => ({
			type: "message.in",
			from: "acct:card:two:human",
			conv: "conv:card:two:dm",
			data: { target, kind: "dm", text: "hello" },
		});
		let event = await router.emit(input("two"));
		expect(event.routes?.map((r) => [r.agent, r.binding, r.dropped])).toEqual([
			["one", null, "no-binding"],
			["two", "incoming", undefined],
			["unbound", null, "no-binding"],
		]);
		event = await router.emit(input("unbound"));
		expect(event.routes?.every((r) => r.dropped === "no-binding")).toBe(true);
		channels.set("card", { multiAgent: false } as import("@yonder/sdk").Channel);
		event = await router.emit(input("two"));
		expect(event.routes?.filter((r) => r.binding).map((r) => r.agent)).toEqual(["one", "two"]);
	} finally {
		await db.close();
	}
});

test("social router isolates owner DMs and authorized groups and records its decisions", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().link("acct:chat:owner", "person:owner");
		await store.identity().link("acct:other:owner", "person:owner");
		const agent = parseAgentConfig(`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: { level: readonly }
social:
  enabled: true
  authorized:
    conversations: ["conv:chat:group", "conv:chat:group2"]
bindings:
  - id: owner
    match: { from: owner }
    session: main
  - id: group
    match: { kind: group }
    session: { mode: persistent, per: conv }
  - id: batch
    match: { type: social.batch-ready }
    session: { mode: persistent, per: conv }
    reply: none
`);
		const agents = new Map([[agent.id, agent]]);
		const keys = new Map<string, string>();
		const sessions = {
			ensureAgent: async (_agent: string, _profile: string, key: string) => {
				if (!keys.has(key)) keys.set(key, String(keys.size + 1));
				return { session: { id: keys.get(key) }, profileMismatch: false };
			},
		} as unknown as Parameters<typeof createRouter>[0]["sessions"];
		const router = createRouter({
			store,
			sessions,
			agents,
			runtime: () => {
				throw new Error("No model");
			},
		});
		const emit = (from: string, conv: string, kind: string, extra = {}) =>
			router.emit({ type: "message.in", from, conv, data: { kind, ...extra } });
		const owner1 = await emit("acct:chat:owner", "conv:chat:owner", "dm");
		const owner2 = await emit("acct:other:owner", "conv:other:owner", "dm");
		const group = await emit("acct:chat:owner", "conv:chat:group", "group", { mentioned: true });
		const group2 = await emit("acct:chat:user", "conv:chat:group2", "group", { mentioned: true });
		const batched = await emit("acct:chat:user", "conv:chat:group", "group");
		expect(batched.routes?.[0]?.wake).toBe("write");
		const revision = socialDecision(agent, batched, undefined)?.revision;
		const batch = (extra = {}) =>
			router.emit({
				type: "social.batch-ready",
				from: "plugin:social",
				conv: "conv:chat:group",
				data: { agent: "main", through: batched.id, sourceEvents: [batched.id], policyRevision: revision, ...extra },
			});
		expect((await batch()).routes?.[0]?.session).toBe(batched.routes?.[0]?.session);
		expect((await batch({ policyRevision: "stale" })).routes?.[0]?.session).toBeUndefined();
		expect((await batch({ agent: "other" })).routes?.[0]?.session).toBeUndefined();
		expect((await batch({ sourceEvents: [group2.id, batched.id] })).routes?.[0]?.session).toBeUndefined();
		expect((await batch({ sourceEvents: [] })).routes?.[0]?.session).toBeUndefined();
		const stranger = await emit("acct:chat:user", "conv:chat:private", "dm");
		expect(owner1.routes?.[0]?.session).toBe(owner2.routes?.[0]?.session);
		expect(group.routes?.[0]?.binding).toBe("group");
		expect(new Set([owner1.routes?.[0]?.session, group.routes?.[0]?.session, group2.routes?.[0]?.session]).size).toBe(
			3,
		);
		expect(stranger.routes?.[0]?.session).toBeUndefined();
		const events = await store.events.query({ limit: 100 });
		expect(events.events.filter((e) => e.type === "routing.social-decision")).toHaveLength(6);
	} finally {
		await db.close();
	}
});

test("social mapping limits the candidates without bypassing their bindings", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const make = (id: string, extra: object, bindings: object[]) =>
			parseAgentConfig(
				JSON.stringify({
					schema: 1,
					id,
					name: id,
					owner: "person:owner",
					defaultProfile: "guest",
					profiles: { guest: { level: "readonly" } },
					bindings,
					...extra,
				}),
			);
		const match = { id: "group", match: { kind: "group" }, session: { mode: "persistent", per: "conv" } };
		const main = make(
			"main",
			{
				social: {
					enabled: true,
					authorized: { conversations: ["conv:chat:group"] },
					mappings: [{ subject: "conv:chat:group", agent: "child", profile: "guest" }],
				},
			},
			[match],
		);
		const child = make("child", {}, [match]);
		const legacy = make("legacy", {}, [match]);
		const agents = new Map([
			[main.id, main],
			[child.id, child],
			[legacy.id, legacy],
		]);
		const sessions = {
			ensureAgent: async (id: string) => ({ session: { id }, profileMismatch: false }),
		} as unknown as Parameters<typeof createRouter>[0]["sessions"];
		const router = createRouter({
			store,
			sessions,
			agents,
			runtime: () => {
				throw new Error("No model");
			},
		});
		const event = await router.emit({
			type: "message.in",
			from: "acct:chat:user",
			conv: "conv:chat:group",
			data: { kind: "group", mentioned: true },
		});
		expect(event.routes?.filter((route) => route.session).map((route) => route.agent)).toEqual(["child"]);
		child.bindings = [];
		const unbound = await router.emit({
			type: "message.in",
			from: "acct:chat:user",
			conv: "conv:chat:group",
			data: { kind: "group", mentioned: true },
		});
		expect(unbound.routes?.every((route) => !route.session)).toBe(true);
	} finally {
		await db.close();
	}
});

test("social scope does not steal other instances or legacy fan-out with real sessions", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const make = (id: string, instance?: string) =>
			parseAgentConfig(
				JSON.stringify({
					schema: 1,
					id,
					name: id,
					owner: "person:owner",
					defaultProfile: "guest",
					profiles: { guest: { level: "readonly", ...(instance ? { channelInstances: [instance] } : {}) } },
					bindings: [
						{ id: "input", match: { kind: "dm" }, session: { mode: "persistent", per: "conv" }, wake: "write" },
					],
					...(instance ? { social: { enabled: true, authorized: { accounts: [`acct:${instance}:user`] } } } : {}),
				}),
			);
		const list = [make("social-a", "a"), make("social-b", "b"), make("legacy1"), make("legacy2")];
		const agents = new Map(list.map((agent) => [agent.id, agent]));
		let next = 0;
		const runtime = {
			create: async () => String(++next),
			submit: async () => ({}),
			notify: async () => {},
		} as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents,
			homePresets: new Map(),
			pluginPresets: new Map(),
			home: "/tmp/social-scope",
			config: { agents: list.map((a) => ({ id: a.id, workspace: `./agents/${a.id}` })) } as YonderConfig,
			version: "0.1.0",
			runtime: () => runtime,
		});
		const router = createRouter({ store, sessions, agents, runtime: () => runtime });
		const send = (instance: string) =>
			router.emit({
				type: "message.in",
				from: `acct:${instance}:user`,
				conv: `conv:${instance}:dm`,
				data: { kind: "dm" },
			});
		const a = await send("a");
		const b = await send("b");
		expect(a.routes?.filter((r) => r.session).map((r) => r.agent)).toEqual(["social-a", "legacy1", "legacy2"]);
		expect(b.routes?.filter((r) => r.session).map((r) => r.agent)).toEqual(["social-b", "legacy1", "legacy2"]);
		expect((await store.sessions.get(a.routes![0]!.session!))?.key).toBe("conv:conv:a:dm");
	} finally {
		await db.close();
	}
});

test("social decision and input roll back together when audit storage fails", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await db.run(
			"CREATE TRIGGER fail_social BEFORE INSERT ON y_events WHEN NEW.type = 'routing.social-decision' BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
		);
		const agent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "main",
				owner: "person:owner",
				defaultProfile: "guest",
				profiles: { guest: {} },
				bindings: [],
				social: { enabled: true },
			}),
		);
		const router = createRouter({
			store,
			agents: new Map([[agent.id, agent]]),
			sessions: {} as Parameters<typeof createRouter>[0]["sessions"],
			runtime: () => {
				throw new Error("No model");
			},
		});
		const input = {
			type: "message.in",
			from: "acct:chat:user",
			conv: "conv:chat:dm",
			data: { kind: "dm", msgId: "id" },
		};
		await expect(router.emit(input)).rejects.toThrow("audit failure");
		expect(await store.events.findInput(input)).toBeUndefined();
		await db.run("DROP TRIGGER fail_social");
		expect((await router.emit(input)).routes?.[0]?.dropped).toBe("no-binding");
		expect((await store.events.query({ limit: 100 })).events.map((e) => e.type)).toEqual([
			"message.in",
			"routing.social-decision",
		]);
	} finally {
		await db.close();
	}
});
