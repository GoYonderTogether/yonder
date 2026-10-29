import type { RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import { channelChatCommands, chatCommands } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import type { DeliveryService } from "../delivery/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { chatCommand, extraSlashCommands, runChannelCommand } from "./commands.js";

async function setup(level = "readonly", capabilities?: string[]) {
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
  guest: { ${capabilities ? `capabilities: ${JSON.stringify(capabilities)}` : `level: ${level}`} }
bindings: []
`,
		"agent.yaml",
		"main",
	);
	await store.sessions.put(session);
	const aborted: string[] = [];
	const bg: unknown[] = [];
	const runtime = {
		sessionState: async () => undefined,
		sessionConfig: async () => ({ resolved: { capabilities: capabilities ?? ["read", "admin", "network"] } }),
		backgroundList: async (id: string) => {
			bg.push(["list", id]);
			return [];
		},
		backgroundAction: async (id: string, action: unknown) => {
			bg.push([id, action]);
			return { ok: true };
		},
		abort: async (id: string) => {
			aborted.push(id);
		},
	} as unknown as Runtime;
	const sessions = createSessions({
		store,
		agents: new Map([[agent.id, agent]]),
		homePresets: new Map(),
		pluginPresets: new Map(),
		home: "/tmp/yonder-command-test",
		config: { schema: 1, defaultModel: testModel, agents: [{ id: "main", workspace: "." }] } satisfies YonderConfig,
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
	return { db, store, session, sessions, sends, delivery, aborted, bg };
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
		expect(result?.text).toContain("/model");
		expect(result?.text).toContain("/effort");
		expect(result?.text).toContain("/compact");
		expect(result?.text).toContain("/status");
		expect(result?.text).toContain("/bg");
		expect(result?.text).not.toMatch(/\/history\b/);
		expect(channelChatCommands.map(({ name }) => name)).toEqual([
			"model",
			"effort",
			"status",
			"bg",
			"compact",
			"session",
			"connect",
			"skills",
			"stop",
			"help",
		]);
		expect(chatCommands.some(({ name }) => name === "history")).toBe(false);
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

test.each(["/refine skills\n保留原始文本", "/plugin-command argument", "/", "/MODEL", "/model-extra", "/help extra"])(
	"unknown slash %j falls through without command records, policy lookup or delivery",
	async (text) => {
		const ctx = await setup();
		try {
			const input = event("e-unknown", text);
			const original = structuredClone(input);
			const result = await runChannelCommand(ctx.session, input, {
				store: ctx.store,
				sessions: {
					resolveSession: async () => {
						throw new Error("Unknown slash must reach normal admission, not command policy");
					},
				} as unknown as typeof ctx.sessions,
				delivery: ctx.delivery,
				skills,
			});
			expect(result).toBeUndefined();
			expect(input).toEqual(original);
			expect(ctx.sends).toEqual([]);
			expect((await ctx.store.events.query({})).events).toEqual([]);
		} finally {
			await ctx.db.close();
		}
	},
);

test.each([
	...chatCommands.map(({ name }) => `/${name}`),
	"/model openai/gpt-6-luna",
	"/effort high",
	"/status details",
	"/bg logs 1",
	"/bg kill 1",
	"/compact focus",
	"/connect cli",
])("recognized builtin %s never falls through, even on a permission error", async (text) => {
	const ctx = await setup("standard", []);
	try {
		const result = await runChannelCommand(ctx.session, event("e-denied", text), {
			store: ctx.store,
			sessions: ctx.sessions,
			delivery: ctx.delivery,
			skills,
		});
		expect(result).toMatchObject({ status: "error", text: "当前来源没有读取会话权限" });
		expect(ctx.sends).toHaveLength(1);
		expect((await ctx.store.events.query({ type: "channel.command" })).events).toHaveLength(1);
		expect((await ctx.store.events.query({ type: "channel.command.result" })).events).toHaveLength(1);
	} finally {
		await ctx.db.close();
	}
});

test("connect commands require admin+network and use the shared channel login without a model", async () => {
	for (const [level, allowed] of [
		["readonly", false],
		["bypass", true],
	] as const) {
		const ctx = await setup(level);
		let calls = 0;
		try {
			const result = await runChannelCommand(ctx.session, event(`connect-${level}`, "/connect wechat-primary"), {
				store: ctx.store,
				sessions: ctx.sessions,
				delivery: ctx.delivery,
				skills,
				login: async (instance) => {
					calls++;
					return { status: "wait", instance: instance!, qrcodeUrl: "https://example.invalid/protocol-login" };
				},
			});
			expect(calls).toBe(allowed ? 1 : 0);
			expect(result?.status).toBe(allowed ? "done" : "error");
			if (allowed) expect(result?.text).toContain("https://example.invalid/protocol-login");
			else expect(result?.text).toContain("admin + network");
		} finally {
			await ctx.db.close();
		}
	}
});

test("extra slash commands and bg aliases route to their handlers", async () => {
	const ctx = await setup("bypass");
	try {
		let reloads = 0;
		const services = {
			store: ctx.store,
			sessions: ctx.sessions,
			delivery: ctx.delivery,
			skills,
			reload: async () => {
				reloads++;
			},
		};
		const run = (id: string, text: string) => runChannelCommand(ctx.session, event(id, text), services);
		expect(extraSlashCommands.find(({ name }) => name === "kill")?.argumentHint).toBe("<id>");
		await run("x-jobs", "/jobs");
		await run("x-logs", "/logs 3");
		await run("x-kill", "/kill 3");
		expect(ctx.bg).toEqual([
			["list", "1"],
			["1", { action: "log", id: "3" }],
			["1", { action: "kill", id: "3" }],
		]);
		expect((await run("x-kill-bad", "/kill abc"))?.status).toBe("error");
		expect((await run("x-reload", "/reload"))?.text).toContain("Reloaded");
		expect(reloads).toBe(1);
		expect((await run("x-name", "/name 周报讨论"))?.text).toContain("周报讨论");
		expect((await ctx.store.sessions.get("1"))?.title).toBe("周报讨论");
		expect((await run("x-trust", "/trust /tmp/project"))?.status).toBe("done");
		expect((await ctx.store.events.query({ type: "session.trust" })).events[0]?.data).toMatchObject({
			directory: "/tmp/project",
		});
		expect((await run("x-copy-none", "/copy"))?.status).toBe("error");
		await ctx.store.events.record({
			type: "message.out",
			conv: "conv:feishu:thread",
			data: { text: "上一条回复", session: "1", to: "conv:feishu:thread", delivery: {} },
		});
		expect((await run("x-copy", "/copy"))?.text).toBe("上一条回复");
		const settings = JSON.parse((await run("x-settings", "/settings"))?.text ?? "{}");
		expect(settings).toMatchObject({ session: "1", agent: "main", title: "周报讨论" });
	} finally {
		await ctx.db.close();
	}
});

test("admin-only extra commands are refused without admin", async () => {
	const ctx = await setup("readonly");
	try {
		const result = await runChannelCommand(ctx.session, event("x-ro", "/name x"), {
			store: ctx.store,
			sessions: ctx.sessions,
			delivery: ctx.delivery,
			skills,
		});
		expect(result).toMatchObject({ status: "error", text: "/name 需要 admin 权限" });
	} finally {
		await ctx.db.close();
	}
});
