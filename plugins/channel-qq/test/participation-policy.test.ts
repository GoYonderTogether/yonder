import type { PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { GroupParticipation } from "../src/participation.js";

test("group admission defaults to all and honors configured overrides", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq", 60, {
		allowedGroups: ["authorized"],
		groupParticipation: { quiet: "record", explicit: "all", mention: "mention" },
		groupKeywords: ["urgent"],
	});
	const accept = (group: string, text: string, mentioned = false) =>
		groups.accept({
			id: `${group}-${text}`,
			ts: new Date().toISOString(),
			type: "message.in",
			conv: `conv:qq:group:${group}`,
			data: { kind: "group", text, mentioned },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		} as YEvent);
	accept("default", "ordinary");
	accept("quiet", "urgent", true);
	accept("authorized", "ordinary");
	accept("explicit", "ordinary");
	accept("mention", "urgent");
	accept("direct", "hello", true);
	const scheduled = groups
		.status()
		.filter((state) => state.nextAt)
		.map((state) => state.conv);
	expect(scheduled).toEqual([
		"conv:qq:group:default",
		"conv:qq:group:authorized",
		"conv:qq:group:explicit",
		"conv:qq:group:mention",
		"conv:qq:group:direct",
	]);
	groups.stop();
});

test("conflicting old and new mention facts do not trigger participation", () => {
	const warnings: unknown[] = [];
	const groups = new GroupParticipation(
		{ log: { warn: (...args: unknown[]) => warnings.push(args) } } as unknown as PluginAPI,
		"qq",
		60,
		{ groupParticipation: { g: "mention" } },
	);
	groups.accept({
		id: "1",
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:qq:group:g",
		data: { mentioned: true, social: { mentions: { bot: false } } },
		routes: [{ wake: "write" }],
	} as YEvent);
	expect(groups.status()[0]?.nextAt).toBeUndefined();
	expect(warnings).toHaveLength(1);
	groups.stop();
});

test("a plain message is not an @ and bot messages remain background", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq", 3, {
		groupParticipation: { mention: "mention" },
	});
	const timestamp = Date.now();
	const accept = (id: string, group: string, mentioned: boolean, senderIsBot = false) =>
		groups.accept({
			id,
			ts: new Date(timestamp).toISOString(),
			type: "message.in",
			conv: `conv:qq:group:${group}`,
			data: { kind: "group", text: "在吗", mentioned, senderIsBot },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		} as YEvent);
	accept("1", "mention", false);
	accept("2", "ordinary", false);
	accept("3", "bot", true, true);
	const due = Object.fromEntries(groups.status().map((state) => [state.conv, state.nextAt]));
	expect(due["conv:qq:group:mention"]).toBeUndefined();
	expect(due["conv:qq:group:ordinary"]).toBe(new Date(timestamp + 3000).toISOString());
	expect(due["conv:qq:group:bot"]).toBeUndefined();
	accept("4", "ordinary", true);
	const immediate = groups.status().find((state) => state.conv === "conv:qq:group:ordinary")?.nextAt;
	expect(Date.parse(immediate ?? "")).toBeLessThan(timestamp + 3000);
	groups.stop();
});

test("status separates unknown QQ scope, exact recorded native ingress, and local group policy", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq-main", 60, {
		allowedGroups: ["observed"],
		groupParticipation: { observed: "mention" },
	});
	const accept = (instance: string, group: string, id: string, routed = true) =>
		groups.accept({
			id,
			ts: "2026-11-03T10:00:00.000Z",
			type: "message.in",
			from: `acct:${instance}:owner`,
			conv: `conv:${instance}:group:${group}`,
			data: {
				kind: "group",
				text: "ordinary message",
				mentioned: false,
				social: { nativeKind: "GROUP_MESSAGE_CREATE", mentions: { bot: false } },
			},
			routes: routed ? [{ agent: "main", binding: "group", wake: "write" }] : [],
		} as YEvent);
	accept("qq-main", "observed", "10");
	accept("qq-main", "formerly-allowed", "11", false);
	accept("qq-other", "observed", "12");
	const states = Object.fromEntries(groups.status().map((state) => [state.conv, state]));
	expect(Object.keys(states)).toEqual(["conv:qq-main:group:observed", "conv:qq-main:group:formerly-allowed"]);
	expect(states["conv:qq-main:group:observed"]).toMatchObject({
		platformReceiveScope: "unknown",
		lastNativeIngress: {
			basis: "recorded-event",
			eventId: "10",
			ts: "2026-11-03T10:00:00.000Z",
			nativeKind: "GROUP_MESSAGE_CREATE",
			mentioned: false,
		},
		localPolicy: { allowedByConfig: true, participation: "mention" },
	});
	expect(states["conv:qq-main:group:formerly-allowed"]).toMatchObject({
		platformReceiveScope: "unknown",
		lastNativeIngress: { basis: "recorded-event", eventId: "11", nativeKind: "GROUP_MESSAGE_CREATE" },
		localPolicy: { allowedByConfig: false, participation: "all" },
	});
	groups.stop();
});

test("a group without any legacy run binding records one diagnostic instead of pausing or erroring", async () => {
	const logs: Array<{ level: string; message: string }> = [];
	const asks: unknown[] = [];
	const recorded: YEvent[] = [
		{
			id: "1",
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:qq:group:g",
			data: { kind: "group", text: "普通消息" },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		},
		{
			id: "2",
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:qq:group:g",
			data: { kind: "group", text: "又一条" },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		},
	];
	const api = {
		log: {
			info: (message: string) => logs.push({ level: "info", message }),
			warn: (message: string) => logs.push({ level: "warn", message }),
		},
		events: {
			query: async (query: { type?: string; after?: string }) =>
				query.type === "message.in"
					? { events: recorded.filter((event) => !query.after || event.id > query.after) }
					: { events: [] },
			ask: async (input: unknown) => {
				asks.push(input);
				// 没有 `channel-qq.group-batch` 运行绑定：路由返回零结果。
				return { event: { id: "batch" }, results: [] };
			},
			emit: async () => ({ id: "read" }),
		},
	} as unknown as PluginAPI;
	const groups = new GroupParticipation(api, "qq", 0, {});
	groups.accept({
		id: "1",
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:qq:group:g",
		data: { kind: "group", text: "普通消息" },
		routes: [{ agent: "main", binding: "group", wake: "write" }],
	} as YEvent);
	groups.accept({
		id: "2",
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:qq:group:g",
		data: { kind: "group", text: "又一条" },
		routes: [{ agent: "main", binding: "group", wake: "write" }],
	} as YEvent);
	// 只有一次诊断，不按每条消息重复刷日志。
	await expect.poll(() => asks.length, { timeout: 3000 }).toBeGreaterThan(0);
	await expect.poll(() => logs.length, { timeout: 3000 }).toBe(1);
	expect(logs[0]).toMatchObject({ level: "info" });
	expect(logs[0]?.message).toContain("social.batch-ready");
	// 没有暂停状态，也没有错误。
	const state = groups.status()[0];
	expect(state).toMatchObject({ conv: "conv:qq:group:g" });
	expect(state?.error).toBeUndefined();
	expect(state?.nextAt).toBeUndefined();
	groups.stop();
});
