import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { FeishuChannel } from "../src/channel.js";
import plugin from "../src/index.js";

afterEach(() => vi.restoreAllMocks());
const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
async function setup(scopes: object[], capabilities = ["read", "network", "admin"]) {
	const collector = createRegistrationCollector();
	const data = await mkdtemp(join(tmpdir(), "feishu-scopes-"));
	const api = {
		...collector.api,
		paths: { data },
		credentials: { get: async () => ({ type: "api_key", key: "test-secret-value" }) },
		events: { ...collector.api.events, emit: vi.fn() },
	} as unknown as PluginAPI;
	await plugin.setup(api);
	await collector.registrations.channels[0]!.create("a", { appId: "cli_test", secret: "slot" });
	const calls: string[] = [];
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		calls.push(`${init?.method ?? "GET"} ${path}`);
		if (path.endsWith("tenant_access_token/internal"))
			return reply({ code: 0, tenant_access_token: "tok", expire: 7200 });
		if (path.endsWith("/scopes/apply")) return reply({ code: 0 });
		return reply({ code: 0, data: { scopes } });
	});
	const ctx = { capabilities, channelInstances: ["a"], signal: new AbortController().signal } as unknown as ToolContext;
	const tool = collector.registrations.tools.find((t) => t.name === "channel-feishu_scopes")!;
	const channel = (collector.registrations.channels[0]!.create as unknown) && undefined;
	void channel;
	return { calls, run: async (args: object, c = ctx) => JSON.parse((await tool.execute(args, c)).text) };
}

test("status splits granted, pending and not configured", async () => {
	const { run } = await setup([
		{ scope_name: "im:message", grant_status: 1 },
		{ scope_name: "im:resource", grant_status: 2 },
	]);
	const result = await run({ instance: "a", action: "status", scopes: ["im:message", "im:resource", "im:chat:read"] });
	expect(result).toMatchObject({
		granted: ["im:message"],
		pending: ["im:resource"],
		notConfigured: ["im:chat:read"],
		consoleUrl: "https://open.feishu.cn/app/cli_test/auth",
	});
});

test("apply posts once for pending scopes, then counts the attempt", async () => {
	const { run, calls } = await setup([{ scope_name: "im:resource", grant_status: 2 }]);
	const result = await run({ instance: "a", action: "apply", scopes: ["im:resource"] });
	expect(result).toMatchObject({ applied: true, applyAttempts: 1 });
	expect(calls.filter((c) => c.endsWith("/scopes/apply"))).toHaveLength(1);
});

test("apply skips when nothing is pending and points to the console", async () => {
	const { run, calls } = await setup([]);
	const result = await run({ instance: "a", action: "apply", scopes: ["im:message.history:readonly"] });
	expect(result.applied).toBe(false);
	expect(result.note).toContain("https://open.feishu.cn/app/cli_test/auth");
	expect(calls.some((c) => c.endsWith("/scopes/apply"))).toBe(false);
});

test("apply requires admin", async () => {
	const { run, calls } = await setup([{ scope_name: "im:resource", grant_status: 2 }], ["read", "network"]);
	const result = await run({ instance: "a", action: "apply" });
	expect(result.ok).toBe(false);
	expect(calls).toHaveLength(0);
});

test("99991672 error carries tool and console hint", async () => {
	const { run } = await setup([]);
	vi.stubGlobal("fetch", async (url: string) =>
		String(url).endsWith("tenant_access_token/internal")
			? reply({ code: 0, tenant_access_token: "tok", expire: 7200 })
			: reply(
					{
						code: 99991672,
						msg: "denied",
						error: { permission_violations: [{ subject: "im:message.history:readonly" }] },
					},
					400,
				),
	);
	const result = await run({ instance: "a", action: "status" });
	expect(result.error).toContain("required permissions=im:message.history:readonly");
	expect(result.error).toContain("channel-feishu_scopes");
	expect(result.error).toContain("https://open.feishu.cn/app/cli_test/auth");
});
