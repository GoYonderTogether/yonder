import type { HostCtx } from "@yonder/local-host/control/method-types";
import { registry } from "@yonder/local-host/control/methods";
import { expect, test } from "vitest";

const input = {
	agent: "mapped-agent",
	source: {
		instance: "card",
		cloudBotId: "00000000-0000-4000-8000-000000000001",
		ownerId: "00000000-0000-4000-8000-000000000002",
		deviceId: "00000000-0000-4000-8000-000000000003",
		platformAgentId: "00000000-0000-4000-8000-000000000004",
		callerSession: "cloud-session",
		invocationId: "tool-task-1",
		sourceMessageIds: ["00000000-0000-4000-8000-000000000005"],
	},
	ceiling: { capabilities: ["read"], channelInstances: ["card"] },
};

function host(scopes: string[], id: string, calls: unknown[]): HostCtx {
	return {
		principal: { id, scopes, kind: "remote", transport: "gateway" },
		kernel: {
			programTools: {
				catalog: async (...args: unknown[]) => {
					calls.push(["catalog", ...args]);
					return { tools: [] };
				},
				call: async (...args: unknown[]) => {
					calls.push(["call", ...args]);
					return { text: "result" };
				},
			},
		},
	} as unknown as HostCtx;
}

const invoke = (method: string, params: unknown, ctx: HostCtx) =>
	registry.call(method, params as never, ctx, new AbortController().signal);

test("program tool control methods require owner scope and trusted Card bridge", async () => {
	const calls: unknown[] = [];
	await expect(invoke("tools.catalog", input, host(["read"], "card:card", calls))).rejects.toMatchObject({
		code: "forbidden",
	});
	await expect(invoke("tools.catalog", input, host(["owner"], "gateway:remote", calls))).rejects.toMatchObject({
		code: "forbidden",
	});
	const socket = host(["owner"], "card:card", calls);
	socket.principal = { id: "card:card", scopes: ["owner"], kind: "local", transport: "socket" };
	await expect(invoke("tools.catalog", input, socket)).rejects.toMatchObject({ code: "forbidden" });
	expect(calls).toEqual([]);
	expect(await invoke("tools.catalog", input, host(["owner"], "card:card", calls))).toEqual({ tools: [] });
	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual(["catalog", input, "card", expect.any(AbortSignal)]);
});

test("tools.call forwards only a validated tool request and rejects caller-selected profile or principal", async () => {
	const calls: unknown[] = [];
	const params = { ...input, tool: "files_read", arguments: { path: "notes.txt" } };
	expect(await invoke("tools.call", params, host(["owner"], "card:card", calls))).toEqual({ text: "result" });
	expect(calls[0]).toEqual(["call", params, "card", expect.any(AbortSignal)]);
	await expect(
		invoke("tools.call", { ...params, profile: "admin" }, host(["owner"], "card:card", calls)),
	).rejects.toMatchObject({ code: "invalid_params" });
	await expect(
		invoke("tools.call", { ...params, principal: { scopes: ["owner"] } }, host(["owner"], "card:card", calls)),
	).rejects.toMatchObject({ code: "invalid_params" });
});
