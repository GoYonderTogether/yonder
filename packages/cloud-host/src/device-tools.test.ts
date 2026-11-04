import type { Store } from "@yonder/bot-core/store/contracts";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { Tool } from "@yonder/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { createDeviceTools } from "./device-tools.js";

/**
 * `/api/worker/bots/:id/devices` lists every work peer in the allow table, including harness
 * devices. A harness connector answers `tools.catalog` with `unsupported` (23 §1: it provides
 * sessions, not device execution), and that answer must drop only that device's tools.
 */

const source = {
	id: "source-message",
	conv: "conv:card:dm",
	type: "message.in",
	ts: new Date(0).toISOString(),
	from: "acct:card:owner",
	routes: [{ agent: "local-agent", session: "program-session" }],
	data: { msgId: "message-1", kind: "dm" },
};

function fixture(handler: (url: string, body: Record<string, unknown>) => unknown) {
	const tools = new Map<string, Tool>();
	const runtime = {
		setHostTools: (next: Tool[]) => {
			tools.clear();
			for (const tool of next) tools.set(tool.name, tool);
		},
		invocationContext: async () => ({ session: "program-session" }),
		invocationConfig: async () => config,
		invocationId: () => "run-1",
	};
	const store = {
		events: { get: async (id: string) => (id === source.id ? source : undefined) },
		sessions: { get: async () => ({ id: "program-session", agent: "local-agent", profile: "default" }) },
		identity: () => ({ relation: async () => "owner" }),
	} as unknown as Store;
	const config = {
		agent: "local-agent",
		profile: "default",
		sessionId: "program-session",
		cwd: "/device/home/agents/a",
		resolved: { capabilities: ["read", "write"], tools: { offer: [], search: [] } },
	} as unknown as RuntimeSessionConfig;
	const calls: string[] = [];
	vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
		const body = JSON.parse(init.body) as Record<string, unknown>;
		calls.push(String(url));
		try {
			return { ok: true, status: 200, json: async () => ({ ok: true, result: handler(String(url), body) }) };
		} catch (error) {
			return { ok: false, status: 400, json: async () => ({ ok: false, error }) };
		}
	});
	return {
		calls,
		tools,
		deviceTools: createDeviceTools({
			endpoint: "https://cloud.example",
			token: "worker-token",
			botId: "bot-1",
			store,
			agents: new Map([["local-agent", { id: "local-agent", owner: "person:owner" } as never]]),
			runtime: () => runtime as never,
		}),
		config,
	};
}

const harnessDevice = {
	deviceId: "harness-device",
	name: "Harness",
	agents: [{ platformAgentId: "harness-bot", name: "Harness Bot" }],
};
const executorDevice = {
	deviceId: "executor-device",
	name: "Executor",
	agents: [{ platformAgentId: "executor-bot", name: "Executor Bot" }],
};

afterEach(() => vi.unstubAllGlobals());

test("an unsupported device keeps the other devices' tools in the run", async () => {
	const { deviceTools, config, tools } = fixture((url) => {
		if (url.endsWith("/devices")) return { devices: [harnessDevice, executorDevice] };
		if (url.includes("harness-device")) throw { code: "unsupported", message: "设备请求失败" };
		if (url.endsWith("tools.catalog"))
			return {
				tools: [
					{
						name: "devices_list",
						description: "List devices",
						parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
						capabilities: ["read"],
						exposure: "offer",
					},
				],
			};
		throw new Error(`unexpected ${url}`);
	});
	const resolved = await deviceTools.resolve(config, [source]);
	expect(tools.size).toBe(1);
	expect([...tools.keys()][0]).toMatch(/devices_list$/);
	expect(resolved.hostTools).toHaveLength(1);
});

test("a device call that fails for another reason still surfaces", async () => {
	const { deviceTools, config } = fixture((url) => {
		if (url.endsWith("/devices")) return { devices: [executorDevice] };
		throw { code: "device_offline", message: "设备请求失败" };
	});
	await expect(deviceTools.resolve(config, [source])).rejects.toThrow("设备请求失败");
});
