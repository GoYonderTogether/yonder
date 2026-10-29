import type { PluginAPI, SocialAPI, SocialPolicy, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { groupInfo, resolveTags, tagsPatch } from "../src/tags.js";
import { registerSocialTools } from "../src/tools.js";

interface Registered {
	name: string;
	capabilities?: string[];
	execute(args: unknown, ctx: ToolContext): Promise<{ text: string; isError?: boolean }>;
}

/**
 * 与 `packages/core/src/kernel/social.ts` 的 authorize/update 同规则的最小服务：
 * 写操作要 admin 能力加一条主人私聊事件，预览不落盘。插件只依赖 SDK，故测试里自建这份语义。
 */
function socialStore() {
	const policies = new Map<string, SocialPolicy>();
	const revisions = new Map<string, number>();
	const current = (conv: string) => String(revisions.get(conv) ?? 0);
	const authorize = (ctx: ToolContext) => {
		if (!ctx.capabilities.includes("admin")) throw new Error("forbidden: Tool scope denied");
		if (
			ctx.event?.type !== "message.in" ||
			(ctx.event.data as { kind?: string }).kind !== "dm" ||
			ctx.event.from !== "acct:cli:owner"
		)
			throw new Error("forbidden: An owner direct message is required");
	};
	const service: SocialAPI = {
		admitBatch: async () => undefined,
		inspect: async (request) => ({
			policy: policies.get(request.conv) ?? {},
			sources: {},
			revision: current(request.conv),
			capabilityGaps: [],
			routeReason: "test",
		}),
		update: async (request, ctx) => {
			if (!ctx) throw new Error("forbidden: Tool context required");
			authorize(ctx);
			const before = policies.get(request.conv) ?? {};
			const after: SocialPolicy = { ...before, ...request.patch };
			if (request.dryRun !== false) return { before, after, affected: [request.conv], revision: current(request.conv) };
			policies.set(request.conv, after);
			revisions.set(request.conv, (revisions.get(request.conv) ?? 0) + 1);
			return { before, after, affected: [request.conv], revision: current(request.conv) };
		},
		resume: async () => ({ accepted: false, revision: "" }),
	};
	return { service, policies };
}

function tools(service: SocialAPI) {
	const registered = new Map<string, Registered>();
	const api = {
		social: service,
		tools: { register: (tool: Registered) => registered.set(tool.name, tool) },
	} as unknown as PluginAPI;
	registerSocialTools(api);
	const call = async (name: string, args: Record<string, unknown>, ctx: ToolContext) => {
		const tool = registered.get(name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		const output = await tool.execute(args, ctx);
		return output.isError ? output : JSON.parse(output.text);
	};
	return { registered, call };
}

const ts = new Date().toISOString();
const owner = {
	agent: "main",
	profile: "guest",
	session: "s1",
	capabilities: ["read", "admin"],
	event: { id: "e1", ts, type: "message.in", from: "acct:cli:owner", data: { kind: "dm", text: "调整这个群" } },
} as unknown as ToolContext;
const stranger = {
	agent: "main",
	profile: "guest",
	session: "s1",
	capabilities: ["read"],
	event: { id: "e2", ts, type: "message.in", from: "acct:cli:stranger", data: { kind: "dm", text: "调整这个群" } },
} as unknown as ToolContext;
const conv = "conv:qq:group:a";

test("无标签时用默认值兜底，模式沿用群默认", () => {
	expect(resolveTags(undefined)).toEqual({ value: "medium", rhythm: "normal" });
	expect(resolveTags({ value: "high" })).toEqual({ value: "high", rhythm: "normal" });
	expect(groupInfo({ conv, policy: {}, revision: "0" })).toMatchObject({
		tags: { value: "medium", rhythm: "normal" },
		mode: "batch",
	});
	expect(
		groupInfo({ conv, policy: { tags: { value: "low", rhythm: "high" }, mode: "mention" }, revision: "1" }),
	).toMatchObject({ tags: { value: "low", rhythm: "high" }, mode: "mention" });
});

test("标签补丁只改传入的维度", () => {
	expect(tagsPatch({ value: "medium", rhythm: "high" }, { value: "low" })).toEqual({ value: "low", rhythm: "high" });
});

test("工具调整后 social.inspect 返回新标签与模式", async () => {
	const { service } = socialStore();
	const { registered, call } = tools(service);
	expect([...registered.keys()]).toEqual([
		"social_inspect",
		"social_update",
		"group_info",
		"group_tag_set",
		"group_mode_set",
	]);
	await call("group_tag_set", { agent: "main", conv, value: "high", reason: "主人关心的话题", dryRun: false }, owner);
	expect((await service.inspect({ agent: "main", conv }, owner)).policy).toMatchObject({
		tags: { value: "high", rhythm: "normal" },
	});
	await call("group_tag_set", { agent: "main", conv, rhythm: "low", reason: "消息太密", dryRun: false }, owner);
	await call("group_mode_set", { agent: "main", conv, mode: "mention", reason: "只看 @", dryRun: false }, owner);
	const inspected = await service.inspect({ agent: "main", conv }, owner);
	expect(inspected.policy).toMatchObject({ mode: "mention", tags: { value: "high", rhythm: "low" } });
	expect(await call("group_info", { agent: "main", conv }, owner)).toMatchObject({
		tags: { value: "high", rhythm: "low" },
		mode: "mention",
		revision: inspected.revision,
	});
});

test("预览不落盘，确认前的策略保持原样", async () => {
	const { service } = socialStore();
	const { call } = tools(service);
	const preview = await call("group_mode_set", { agent: "main", conv, mode: "digest", reason: "先看效果" }, owner);
	expect(preview).toMatchObject({ before: {}, after: { mode: "digest" } });
	expect((await service.inspect({ agent: "main", conv }, owner)).policy).toEqual({});
});

test("非主人调用被拒绝", async () => {
	const { service } = socialStore();
	const { call } = tools(service);
	const result = await call(
		"group_tag_set",
		{ agent: "main", conv, value: "low", reason: "降噪", dryRun: false },
		stranger,
	);
	expect(result).toEqual({ text: expect.stringContaining("forbidden"), isError: true });
	expect((await service.inspect({ agent: "main", conv }, owner)).policy).toEqual({});
});
