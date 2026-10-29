import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { type AgentConfig, parseAgentConfig } from "../config/index.js";
import { resolveProfile, testModel } from "../config/test-support.js";
import { createDelivery } from "../delivery/index.js";
import { loadPlugins } from "../plugins/index.js";
import { peerWorkspaceContext, systemSections } from "../prompt/index.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import { localEnvironment } from "../runtime/env.js";
import { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore, newEvent } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";
import { initHome, openKernel } from "./index.js";
import { withDefaultPeer } from "./peer.js";
import { filesFor, inspectionServices, profileFor } from "./workspace.js";

const base = (): AgentConfig => ({
	schema: 1,
	id: "main",
	name: "Main",
	owner: "person:owner",
	defaultProfile: "owner",
	profiles: { owner: { level: "bypass" } },
	bindings: [{ id: "broad", match: {}, session: "main", profile: "owner" }],
});

test("default peer resets every private context/prompt/tool source and keeps explicit bindings", () => {
	const agent = base();
	agent.defaults = {
		model: "openai/gpt-6-luna",
		thinking: "high",
		fallback: { models: ["openai/gpt-6-luna"], after: 2 },
		level: "bypass",
		tools: { offer: ["*"], search: ["*"] },
		plugins: ["memory"],
		skills: ["*"],
		contexts: ["private-memory"],
		instructions: "OWNER-SECRET",
		env: "private",
		prompt: { sections: [], overrides: { framework: "SECRET-PROMPT" } },
		limits: { maxTurns: 999 },
	};
	const generated = withDefaultPeer(agent);
	const peer = resolveProfile(generated.profiles.peer!, generated.defaults);
	expect(peer).toMatchObject({
		model: "openai/gpt-6-luna",
		thinking: "high",
		fallback: agent.defaults.fallback,
		capabilities: ["read", "message"],
		tools: { offer: ["read", "grep", "skill_view", "agent_ask"], search: [] },
		contexts: ["peer-workspace"],
		plugins: [],
		skills: [],
		env: "local",
		prompt: { overrides: {} },
	});
	expect(peer.level).toBeUndefined();
	expect(peer.prompt.sections).not.toEqual([]);
	expect(peer.limits.maxTurns).toBe(100);
	expect(peer.instructions).not.toContain("OWNER-SECRET");
	expect(generated.bindings[0]).toEqual({
		id: "peer",
		match: { channel: "agent", kind: "agent" },
		session: "ephemeral",
		profile: "peer",
		reply: "none",
	});
	expect(generated.bindings.slice(1)).toEqual(agent.bindings);
	expect(agent.profiles.peer).toBeUndefined();
	expect(() => parseAgentConfig(stringify(generated), "agent.yaml", "main")).not.toThrow();
});

test.each([null, "true", 0, 1, {}, []].map((value) => [value]))("rejects non-boolean isolated %j", (value) => {
	expect(() => withDefaultPeer(base(), value)).toThrow("boolean");
});

test.each([
	{},
	{ channel: "agent" },
	{ kind: "agent" },
	{ channel: ["cli", "agent"], kind: ["parent-request", "agent"] },
	{ channel: "agent", kind: "agent", from: "owner" as const, type: "other.event", conv: "conv:cli:private" },
])("isolated conservatively rejects possible agent/agent match %j", (match) => {
	const agent = base();
	agent.bindings[0]!.match = match;
	expect(() => withDefaultPeer(agent, true)).toThrow("isolated cannot receive");
});

test("isolated keeps disjoint bindings, collisions never overwrite and isolated is not persisted", () => {
	const agent = base();
	agent.bindings[0]!.match = { channel: "agent", kind: "parent-request" };
	expect(withDefaultPeer(agent, true)).toEqual(agent);
	agent.bindings[0]!.id = "peer";
	expect(() => withDefaultPeer(agent)).toThrow("collision");
	expect(withDefaultPeer(agent, true)).toEqual(agent);
	agent.bindings = [];
	agent.profiles.peer = {};
	expect(() => withDefaultPeer(agent)).toThrow("collision");
});

test("init and all preset creation paths generate peer; isolated input is creation-only; old disk config stays unchanged", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const isolatedHome = await mkdtemp(join(tmpdir(), "ya-"));
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const initial = parse(await readFile(file, "utf8"));
		expect(initial.bindings[0]).toMatchObject({ id: "peer", profile: "peer", reply: "none" });
		// Existing Agent lacking peer remains untouched on startup/reload.
		delete initial.profiles.peer;
		initial.bindings.shift();
		const old = stringify(initial);
		await writeFile(file, old);
		kernel = await openKernel(home);
		expect(await readFile(file, "utf8")).toBe(old);
		await kernel.management({
			action: "presets.create",
			id: "arbitrary",
			value: {
				description: "Custom preset",
				instructions: "PRIVATE-INSTRUCTION",
				prompt: { sections: [], overrides: { framework: "PRIVATE-PROMPT" } },
			},
		});
		for (const preset of ["jarvis", "default-agent", "arbitrary"]) {
			const id = `created-${preset}`;
			await kernel.management({
				action: "agents.create",
				id,
				preset,
				value: { name: id, work: "Peer configuration verification", owner: "person:owner", bindings: [] },
			});
			const generated = (await kernel.management({ action: "agents.show", id })) as AgentConfig;
			expect(generated.bindings[0]).toMatchObject({ id: "peer", profile: "peer" });
			expect(generated.profiles.peer!.instructions).not.toContain("PRIVATE-INSTRUCTION");
			expect(generated.profiles.peer!.prompt!.overrides).toEqual({});
		}
		const input = { name: "Isolated", work: "Configuration verification", owner: "person:owner", bindings: [] };
		await kernel.management({
			action: "agents.create",
			id: "isolated",
			preset: "arbitrary",
			value: { ...input, isolated: true },
		});
		const stored = parse(await readFile(join(home, "agents/isolated/agent.yaml"), "utf8"));
		expect(stored.bindings).toEqual([]);
		expect(stored).not.toHaveProperty("isolated");
		for (const isolated of [null, "false", 1])
			await expect(
				kernel.management({
					action: "agents.create",
					id: "invalid",
					preset: "arbitrary",
					value: { ...input, isolated },
				}),
			).rejects.toThrow("boolean");
		await expect(
			kernel.management({
				action: "agents.create",
				id: "invalid",
				preset: "arbitrary",
				value: { ...input, isolated: true, bindings: [{ id: "broad", match: {}, session: "main" }] },
			}),
		).rejects.toThrow("isolated cannot receive");
		await expect(
			kernel.management({
				action: "agents.create",
				id: "invalid",
				preset: "arbitrary",
				value: { ...input, bindings: [{ id: "peer", match: { channel: "cli" }, session: "main" }] },
			}),
		).rejects.toThrow("collision");
		await initHome(isolatedHome, "owner", { model: testModel, isolated: true });
		const isolatedMain = parse(await readFile(join(isolatedHome, "agents/main/agent.yaml"), "utf8"));
		expect(isolatedMain.profiles.peer).toBeUndefined();
		expect(isolatedMain.bindings.map((b: { id: string }) => b.id)).toEqual([
			"owner",
			"card-owner",
			"card-visitor",
			"card-group",
		]);
		await expect(
			initHome(join(isolatedHome, "invalid"), "owner", { model: testModel, isolated: "true" as unknown as boolean }),
		).rejects.toThrow("boolean");
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
		await rm(isolatedHome, { recursive: true, force: true });
	}
}, 30000);

test("core workspace context works without plugins, loads only own two files, rejects symlink escape", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		const config = { schema: 1 as const, agents: [{ id: "main", workspace: "./agents/main" }] };
		const plugins = await loadPlugins(
			home,
			config,
			inspectionServices(home, config, () => {}),
		);
		const files = filesFor(home, config, plugins, "main");
		await files.writeFile("SOUL.md", "OWN-SOUL");
		await files.writeFile("AGENTS.md", "OWN-WORK");
		await files.writeFile("memory/private.md", "DO-NOT-PRELOAD");
		const agent = withDefaultPeer(base(), false, "local", testModel);
		const session = { ...profileFor(home, config, agent, "peer"), id: "context" };
		const options = { contexts: plugins.contexts, workspace: () => files };
		const text = (await systemSections(session, options)).join("\n");
		expect(text).toContain("OWN-SOUL");
		expect(text).toContain("OWN-WORK");
		expect(text).not.toContain("DO-NOT-PRELOAD");
		await writeFile(join(home, "outside.md"), "OUTSIDE");
		await rm(join(session.cwd, "SOUL.md"));
		await symlink(join(home, "outside.md"), join(session.cwd, "SOUL.md"));
		await expect(systemSections(session, options)).rejects.toThrow("escapes workspace");
		await rm(join(session.cwd, "SOUL.md"));
		await symlink("AGENTS.md", join(session.cwd, "SOUL.md"));
		expect((await systemSections(session, options)).join("\n")).toContain("OWN-WORK");
		await rm(join(session.cwd, "SOUL.md"));
		await rm(join(session.cwd, "AGENTS.md"));
		expect((await systemSections(session, options)).join("\n")).not.toContain("OWN-WORK");
		expect(
			await peerWorkspaceContext.render({
				agent: "",
				profile: "peer",
				session: "task",
				workspace: {
					read: async () => {
						throw new Error("must not read");
					},
				},
			}),
		).toBeUndefined();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("actual router chooses generated ephemeral peer ahead of broad owner, parent-request and no-binding stay compatible", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const db = await openDatabase(":memory:");
	let runtime: Runtime | undefined;
	try {
		const store = await createStore(db);
		const agent = withDefaultPeer(base(), false, "local", testModel);
		// Passive admission exercises real routing/session/runtime without a model or fabricated reply.
		agent.bindings[0]!.wake = "write";
		agent.bindings[1]!.wake = "write";
		const agents = new Map([[agent.id, agent]]);
		const config = { schema: 1 as const, defaultModel: testModel, agents: [{ id: "main", workspace: home }] };
		const sessions = createSessions({
			store,
			agents,
			homePresets: new Map(),
			pluginPresets: new Map(),
			home,
			config,
			version: "test",
			runtime: () => runtime!,
		});
		runtime = await Runtime.open({ home, db, config, resolveSession: sessions.resolveSession });
		const router = createRouter({ store, sessions, runtime: () => runtime!, agents });
		const event = await router.emit({
			type: "message.in",
			from: "acct:agent:other",
			conv: "conv:agent:other",
			data: { kind: "agent", text: "Routing verification", target: "main" },
		});
		expect(event.routes?.[0]).toMatchObject({ agent: "main", binding: "peer", wake: "write" });
		const session = await store.sessions.get(event.routes![0]!.session!);
		expect(session).toMatchObject({ profile: "peer", mode: "ephemeral" });
		expect((await sessions.resolveSession(session!.id)).resolved.capabilities).toEqual(["read", "message"]);
		const parent = await router.emit({
			type: "message.in",
			from: "acct:agent:main",
			conv: "conv:agent:main",
			data: { kind: "parent-request", text: "Parent compatibility", target: "main" },
		});
		expect(parent.routes?.[0]?.binding).toBe("broad");
		agents.set("other", { ...agent, id: "other" });
		agents.set("third", { ...agent, id: "third" });
		const delivery = createDelivery({ store, agents, channels: new Map(), runtime: () => runtime!, sessions });
		const ask = createCoreTools({
			store,
			agents,
			sessions,
			runtime: () => runtime!,
			delivery,
			ask: router.ask,
			getPreset: () => undefined,
		}).find((tool) => tool.name === "agent_ask")!;
		const nested = newEvent({
			type: "message.in",
			parent: event.id,
			from: "acct:agent:main",
			conv: "conv:agent:main",
			data: { target: "third", kind: "agent", text: "Nested collaboration" },
		});
		await store.events.append(nested);
		const background = newEvent({
			type: "runtime.tool-result",
			parent: nested.id,
			from: "system:runtime",
			data: { job: "causal-boundary" },
		});
		await store.events.append(background);
		for (const origin of [event, nested, background]) {
			const result = await ask.execute(
				{ agent: "other", text: "Must reject causal ring" },
				{
					agent: origin === event ? "main" : "third",
					profile: "peer",
					session: session!.id,
					capabilities: ["read", "message"],
					env: localEnvironment(home),
					event: origin,
					signal: new AbortController().signal,
				},
			);
			expect(result).toMatchObject({ isError: true });
			expect(result.text).toContain("形成环");
		}

		agent.bindings = [];
		const missing = await router.emit({
			type: "message.in",
			from: "acct:agent:other",
			conv: "conv:agent:other",
			data: { kind: "agent", text: "No binding", target: "main" },
		});
		expect(missing.routes?.[0]).toMatchObject({ binding: null, dropped: "no-binding" });
	} finally {
		await runtime?.close();
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
