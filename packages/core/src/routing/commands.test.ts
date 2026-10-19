import type { RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import { channelChatCommands, chatCommands } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import type { DeliveryService } from "../delivery/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { chatCommand, runChannelCommand } from "./commands.js";

async function setup() {
	const db = await openDatabase(":memory:");
	const store = await createStore(db);
	const session: SessionInfo = {
		id: "1",
		agent: "main",
		profile: "guest",
		mode: "persistent",
		key: "conv:feishu:thread",
		version: "0.1.0",
		opened: new Date().toISOString(),
	};
	const agent = parseAgentConfig(
		`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: { level: readonly }
bindings: []
`,
		"agent.yaml",
		"main",
	);
	await store.sessions.put(session);
	const aborted: string[] = [];
	const runtime = {
		abort: async (id: string) => {
			aborted.push(id);
		},
	} as Runtime;
	const sessions = createSessions({
		store,
		agents: new Map([[agent.id, agent]]),
		homePresets: new Map(),
		pluginPresets: new Map(),
		home: "/tmp/yonder-command-test",
		config: { schema: 1, agents: [{ id: "main", workspace: "." }] } satisfies YonderConfig,
		version: "0.1.0",
		runtime: () => runtime,
	});
	const sends: Array<{ event: YEvent; text: string }> = [];
	const delivery = {
		async sendCommand(_session: SessionInfo, event: YEvent, text: string) {
			sends.push({ event, text });
			return { ok: true };
		},
	} as DeliveryService;
	return { db, store, session, sessions, sends, delivery, aborted };
}

const skills = async () => ({ skills: [], issues: [], index: "", estimatedTokens: 0 });

function event(id: string, text: string): YEvent {
	return { id, ts: new Date().toISOString(), type: "message.in", conv: "conv:feishu:thread", data: { text } };
}

test("help uses shared commands and excludes commands absent from the CLI", async () => {
	const ctx = await setup();
	try {
		const result = await runChannelCommand(ctx.session, event("e-help", "/help"), {
			store: ctx.store,
			sessions: ctx.sessions,
			delivery: ctx.delivery,
			skills,
		});
		expect(result?.text).toContain("/help");
		expect(result?.text).toContain("/session");
		expect(result?.text).toContain("/skills");
		expect(result?.text).toContain("/stop");
		expect(result?.text).not.toMatch(/\/(status|history)\b/);
		expect(channelChatCommands.map(({ name }) => name)).toEqual(["session", "skills", "stop", "help"]);
		expect(chatCommands.some(({ name }) => name === "history" || name === "status")).toBe(false);
	} finally {
		await ctx.db.close();
	}
});

test("stop aborts only the supplied session", async () => {
	const ctx = await setup();
	try {
		await runChannelCommand(ctx.session, event("e-stop", "/stop"), {
			store: ctx.store,
			sessions: ctx.sessions,
			delivery: ctx.delivery,
			skills,
		});
		expect(ctx.aborted).toEqual([ctx.session.id]);
	} finally {
		await ctx.db.close();
	}
});

test("duplicate delivery and recovered replay do not repeat command side effects", async () => {
	const ctx = await setup();
	try {
		const input = event("e-replay", "/stop");
		const services = { store: ctx.store, sessions: ctx.sessions, delivery: ctx.delivery, skills };
		const first = await runChannelCommand(ctx.session, input, services);
		const replay = await runChannelCommand(ctx.session, input, services);
		expect(first?.status).toBe("done");
		expect(replay?.status).toBe("done");
		expect(ctx.aborted).toEqual([ctx.session.id]);
		expect(ctx.sends).toHaveLength(1);
	} finally {
		await ctx.db.close();
	}
});

test("escaped slash text is ordinary input and /new reports terminal-only", async () => {
	const ctx = await setup();
	try {
		const services = { store: ctx.store, sessions: ctx.sessions, delivery: ctx.delivery, skills };
		expect(chatCommand("//普通文本")).toBeUndefined();
		expect(await runChannelCommand(ctx.session, event("e-escaped", "//普通文本"), services)).toBeUndefined();
		const result: RunResult | undefined = await runChannelCommand(ctx.session, event("e-new", "/new"), services);
		expect(result?.text).toContain("仅适用于终端交互");
		expect(ctx.sends).toHaveLength(1);
	} finally {
		await ctx.db.close();
	}
});
