import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector, tempHome } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import plugin from "../src/index.js";

afterEach(() => vi.restoreAllMocks());
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

async function setup(capabilities = ["read", "network", "admin"], channelInstances = ["a"]) {
	const { api: base, registrations } = createRegistrationCollector();
	const data = await tempHome("feishu-chats-");
	await plugin.setup({
		...base,
		paths: { data },
		credentials: { get: async () => ({ type: "api_key", key: "local-test-secret" }) },
	} as unknown as PluginAPI);
	registrations.channels[0]?.create("a", { appId: "cli_test", secret: "slot" });
	const calls: string[] = [];
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		calls.push(`${init?.method ?? "GET"} ${url}`);
		if (path.endsWith("tenant_access_token/internal"))
			return response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
		return response({ code: 0, data: { items: [] } });
	});
	const ctx = {
		capabilities,
		channelInstances,
		signal: new AbortController().signal,
	} as unknown as ToolContext;
	const tool = registrations.tools.find((item) => item.name === "channel-feishu_chats");
	if (!tool) throw new Error("Feishu chats tool was not registered");
	return { calls, ctx, tool };
}

test("lists only groups in one bounded page and maps natural names to complete refs", async () => {
	const { tool, ctx, calls } = await setup();
	vi.stubGlobal("fetch", async (url: string) => {
		const parsed = new URL(url);
		calls.push(`${parsed.pathname}?${parsed.searchParams}`);
		if (parsed.pathname.endsWith("tenant_access_token/internal"))
			return response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
		return response({
			code: 0,
			data: {
				items: [
					{ chat_id: "oc_p1", name: "Yonder P1渠道验收 2026-10-19", chat_mode: "group" },
					{ chat_id: "oc_other", name: "Other group", chat_mode: "group" },
					{ chat_id: "oc_dm", name: "Owner DM", chat_mode: "p2p" },
				],
				has_more: true,
				page_token: "next-page",
			},
		});
	});
	const result = JSON.parse(
		(await tool.execute({ instance: "a", name: "P1", pageToken: "previous", pageSize: 17 }, ctx)).text,
	);
	expect(result).toEqual({
		ok: true,
		items: [{ name: "Yonder P1渠道验收 2026-10-19", chatId: "oc_p1", conv: "conv:a:oc_p1" }],
		ambiguousNames: [],
		hasMore: true,
		truncated: true,
		nextPageToken: "next-page",
	});
	const request = calls.find((call) => call.includes("/im/v1/chats?"));
	expect(request).toContain("page_size=17");
	expect(request).toContain("page_token=previous");
	const allCalls = calls.join("\n");
	expect(allCalls).not.toContain("/members");
	expect(allCalls).not.toContain("/messages");
});

test("reports duplicate names instead of selecting a chat", async () => {
	const { tool, ctx } = await setup();
	vi.stubGlobal("fetch", async (url: string) =>
		new URL(url).pathname.endsWith("tenant_access_token/internal")
			? response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 })
			: response({
					code: 0,
					data: {
						items: [
							{ chat_id: "oc_one", name: "Ops", chat_mode: "group" },
							{ chat_id: "oc_two", name: "Ops", chat_mode: "group" },
						],
						has_more: false,
					},
				}),
	);
	const result = JSON.parse((await tool.execute({ instance: "a", name: "ops" }, ctx)).text);
	expect(result.ambiguousNames).toEqual(["Ops"]);
	expect(result.items).toHaveLength(2);
});

test("enforces instance and admin boundaries before any network request", async () => {
	const { tool, ctx, calls } = await setup(["read", "network"], []);
	const result = await tool.execute({ instance: "a" }, ctx);
	expect(result.isError).toBe(true);
	expect(calls).toHaveLength(0);
	const noAdmin = await tool.execute({ instance: "a" }, { ...ctx, channelInstances: ["a"] } as ToolContext);
	expect(noAdmin.isError).toBe(true);
	expect(calls).toHaveLength(0);
});

test("surfaces actual permission errors with existing scope guidance", async () => {
	const { tool, ctx } = await setup();
	vi.stubGlobal("fetch", async (url: string) =>
		new URL(url).pathname.endsWith("tenant_access_token/internal")
			? response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 })
			: response(
					{
						code: 99991672,
						msg: "denied",
						error: { permission_violations: [{ subject: "im:chat:readonly" }] },
					},
					400,
				),
	);
	const result = await tool.execute({ instance: "a" }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("required permissions=im:chat:readonly");
	expect(result.text).toContain("channel-feishu_scopes");
});
