import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, resolveProfile, type YonderConfig } from "../config/index.js";
import { inboundNotification } from "../kernel/notifications.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createRouter } from "./index.js";

const conv = "conv:qq-main:group:G1";
const inbound = (data: Record<string, unknown>, overrides: Partial<YEvent> = {}): YEvent => ({
	id: "01K0000000000000000000000A",
	ts: new Date().toISOString(),
	type: "message.in",
	from: "acct:qq-main:OPENID1",
	conv,
	data,
	...overrides,
});

test("notification level decides which inbound events notify", () => {
	expect(inboundNotification(undefined, inbound({ kind: "group", text: "你好" }))).toEqual({
		from: "acct:qq-main:OPENID1",
		event: "01K0000000000000000000000A",
		text: "你好",
	});
	expect(inboundNotification({ default: "mute" }, inbound({ kind: "group", text: "你好" }))).toBeUndefined();
	expect(
		inboundNotification({ default: "mention" }, inbound({ kind: "group", text: "你好", mentioned: false })),
	).toBeUndefined();
	expect(
		inboundNotification({ default: "mention" }, inbound({ kind: "group", text: "你好", mentioned: true })),
	).toMatchObject({ text: "你好" });
	expect(
		inboundNotification(
			{ default: "all", conversations: { [conv]: "mute" } },
			inbound({ kind: "group", text: "你好" }),
		),
	).toBeUndefined();
	expect(
		inboundNotification(
			{ default: "mute", conversations: { [conv]: "mention" } },
			inbound({ kind: "group", text: "@我", mentioned: true }),
		),
	).toMatchObject({ text: "@我" });
	expect(inboundNotification(undefined, inbound({ kind: "group", text: "x".repeat(500) }))?.text).toHaveLength(120);
	expect(
		inboundNotification(
			undefined,
			inbound({ kind: "group", text: "", attachments: [{ kind: "image", mime: "image/png", uri: "https://x/y" }] }),
		),
	).toMatchObject({ text: "[1 个附件]" });
	expect(inboundNotification(undefined, inbound({ kind: "group", text: "  " }))).toBeUndefined();
});

test("only message.in and summary opt-ins notify, never internal run events", () => {
	expect(
		inboundNotification(
			undefined,
			inbound(
				{ summary: "张三: 在吗" },
				{ type: "wechat-archive.received", from: "plugin:wechat-archive", conv: "conv:wechat-archive:Msg_1" },
			),
		),
	).toEqual({ from: "plugin:wechat-archive", event: "01K0000000000000000000000A", text: "张三: 在吗" });
	expect(inboundNotification(undefined, inbound({ text: "结果" }, { type: "agent.result" }))).toBeUndefined();
	expect(inboundNotification(undefined, inbound({ summary: 42 }, { type: "wechat-archive.received" }))).toBeUndefined();
});

test("routed inbound messages record one notification per session at the configured level", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-notify-policy-"));
	let runtime: Runtime | undefined;
	try {
		const db = await openDatabase(join(home, "state.db"));
		const store = await createStore(db);
		const options = {
			home,
			config: { schema: 1 as const },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
		};
		runtime = await Runtime.open({ ...options, db });
		const current = runtime;
		const agent = parseAgentConfig(
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: {}
bindings:
  - id: qq
    match: { channel: qq-main, kind: group }
    session: { mode: persistent, per: conv }
    profile: guest
    wake: write
`,
			"agent.yaml",
			"main",
		);
		const agents = new Map([[agent.id, agent]]);
		const sessions = createSessions({
			store,
			home,
			config: { schema: 1, agents: [{ id: "main", workspace: "./agents/main" }] } as YonderConfig,
			version: "notification-policy",
			agents,
			pluginPresets: new Map(),
			homePresets: new Map(),
			runtime: () => current,
		});
		const router = createRouter({
			store,
			sessions,
			runtime: () => current,
			agents,
			notifications: { default: "mention", conversations: { "conv:qq-main:group:LOUD": "all" } },
		});
		const loud = "conv:qq-main:group:LOUD";
		const quiet = await router.emit({
			type: "message.in",
			from: "acct:qq-main:OPENID1",
			conv,
			data: { kind: "group", text: "普通消息", mentioned: false, msgId: "m1" },
		});
		await router.emit({
			type: "message.in",
			from: "acct:qq-main:OPENID1",
			conv,
			data: { kind: "group", text: "叫我了", mentioned: true, msgId: "m2" },
		});
		const loudEvent = await router.emit({
			type: "message.in",
			from: "acct:qq-main:OPENID1",
			conv: loud,
			data: { kind: "group", text: "全部提醒", mentioned: false, msgId: "m3" },
		});
		const session = quiet.routes?.[0]?.session;
		if (!session) throw new Error("routed session missing");
		const notifications = async (id: string) =>
			(await current.transcript(id)).filter((entry) => entry.kind === "yonder.notification");
		await expect.poll(() => notifications(session).then((rows) => rows.length)).toBe(1);
		expect(await notifications(session)).toMatchObject([{ text: "叫我了", from: "acct:qq-main:OPENID1" }]);
		const other = loudEvent.routes?.[0]?.session;
		if (!other) throw new Error("second routed session missing");
		await expect.poll(() => notifications(other).then((rows) => rows.length)).toBe(1);
		expect(await notifications(other)).toMatchObject([{ text: "全部提醒" }]);
		const unbound = await router.emit({
			type: "message.in",
			from: "acct:other:OPENID9",
			conv: "conv:other:group:X",
			data: { kind: "group", text: "别的渠道", mentioned: true, msgId: "m4" },
		});
		expect(unbound.routes?.map((route) => route.dropped)).toEqual(["no-binding"]);
		expect(await notifications(session)).toHaveLength(1);
		expect(await notifications(other)).toHaveLength(1);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
