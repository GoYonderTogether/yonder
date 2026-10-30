import type { Hook, PluginAPI, Tool, ToolContext } from "@yonder/sdk";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import { registerWatchContext } from "../src/watch-context.js";
import { watchMatches } from "../src/watch-rules.js";
import { registerWatchTools } from "../src/watch-tools.js";

// Reuse the redacted local-archive text already retained by summary.test.ts.
test("watch rules normalize words and exclusions take precedence", () => {
	expect(watchMatches("晚上七点老地方", { keywords: ["七点"] })).toBe(true);
	expect(watchMatches("晚上七点老地方", { keywords: ["七点"], exclude: ["老地方"] })).toBe(false);
	expect(watchMatches("晚上七点老地方", { keywords: ["收到"] })).toBe(false);
	expect(watchMatches("é", { keywords: ["e\u0301"] })).toBe(true);
});

test("watch tools reject empty rules and do not accept authorization changes through rollback", () => {
	const tools = new Map<string, Tool["parameters"]>();
	registerWatchTools((name, _description, schema) => {
		tools.set(name, schema);
	});
	const control = tools.get("watch_control")!;
	expect(Check(control, { id: "listen", op: "rollback", expectedVersion: 2, version: 1, reason: "规则回退" })).toBe(
		true,
	);
	expect(
		Check(control, { id: "listen", op: "rules", expectedVersion: 2, rules: { keywords: [] }, reason: "空规则" }),
	).toBe(false);
	expect(
		Check(control, {
			id: "listen",
			op: "rollback",
			expectedVersion: 2,
			version: 1,
			reason: "规则回退",
			notification: { to: "owner" },
		}),
	).toBe(false);
});

test("read-only guidance is attached only to an actual watch input", async () => {
	let hook: Hook | undefined;
	registerWatchContext({
		hooks: {
			register: (value: Hook) => {
				hook = value;
			},
		},
	} as PluginAPI);
	const ctx = { event: { type: "wechat-archive.material", from: "plugin:wechat-archive" } } as ToolContext;
	expect(await hook!.beforeRequest!([], ctx)).toBeUndefined();
	ctx.event!.type = "wechat-archive.watch";
	const result = await hook!.beforeRequest!([], ctx);
	expect(result?.messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("NO_REPLY") });
	expect(result?.messages.at(-1)).toMatchObject({ content: expect.stringContaining("notification.to") });
	ctx.event!.from = "plugin:other";
	expect(await hook!.beforeRequest!([], ctx)).toBeUndefined();
});

test("watch send guard uses the real session key before a batch receipt exists", async () => {
	const { DatabaseSync } = await import("node:sqlite");
	const { Watches } = await import("../src/watches.js");
	const db = new DatabaseSync(":memory:");
	let key = "conv:conv:wechat-archive:watch:main:listen";
	let mode = "persistent";
	let checked = 0;
	let allowed = true;
	const owner = { agent: "main", profile: "owner", session: "session" };
	const api = {
		sessions: { get: async () => ({ ...owner, key, mode }) },
		events: { query: async () => ({ events: [] }) },
		agents: {
			inspectBinding: async () => {
				checked++;
			},
		},
	} as unknown as PluginAPI;
	const watches = new Watches(
		api,
		db,
		(chat) => {
			if (!allowed) throw Error("WECHAT_CHAT_OUT_OF_SCOPE");
			return String(chat);
		},
		async () => 0,
	);
	db.prepare("INSERT INTO watches VALUES(?,?,?)").run(
		"main",
		"listen",
		JSON.stringify({
			...owner,
			id: "listen",
			conv: key.slice(5),
			chat: "Msg_abc",
			notification: { to: "acct:cli:owner", via: "cli" },
			ownerSession: owner.session,
			ownerProfile: owner.profile,
			version: 1,
			state: "active",
			cursor: 539241,
			rules: { keywords: ["七点"] },
		}),
	);
	try {
		await expect(watches.beforeSend("conv:cli:group", owner)).rejects.toThrow("PRIVATE_TARGET_REQUIRED");
		expect(checked).toBe(0);
		await watches.beforeSend("acct:cli:owner", owner);
		expect(checked).toBe(1);
		mode = "main";
		key = "main";
		await watches.beforeSend("conv:cli:group", owner);
		expect(checked).toBe(1);
		allowed = false;
		const paused = (await watches.tool(
			"watch_control",
			{ id: "listen", op: "pause", expectedVersion: 1, reason: "暂停已撤回授权的来源" },
			owner as ToolContext,
		)) as { watch: { state: string; cursor: number }; route: { valid: boolean } };
		expect(paused.watch).toMatchObject({ state: "paused", cursor: 539241 });
		expect(paused.route.valid).toBe(false);
		await expect(
			watches.tool(
				"watch_control",
				{ id: "listen", op: "resume", from: "paused", expectedVersion: 1, reason: "恢复" },
				owner as ToolContext,
			),
		).rejects.toThrow("OUT_OF_SCOPE");
		const deleted = (await watches.tool(
			"watch_control",
			{ id: "listen", op: "delete", expectedVersion: 1, reason: "停用" },
			owner as ToolContext,
		)) as { watch: { state: string } };
		expect(deleted.watch.state).toBe("deleted");
	} finally {
		db.close();
	}
});
