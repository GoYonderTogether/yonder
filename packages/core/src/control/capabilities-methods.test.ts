import { hostname } from "node:os";
import { NodeFactsSchema } from "@yonder/protocol/gateway";
import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { type HostCtx, registry } from "./methods.js";

/** capabilities.get 必须补齐 NodeFactsSchema 的 v1.1 字段（contracts §12），否则 apps/app 读不到 node.id。 */
function ctxOf(principal: HostCtx["principal"]): HostCtx {
	return {
		principal,
		home: "/tmp/home",
		releaseInfo: async () => ({ version: "0.3.0", origin: null }),
		awakeStatus: () => ({}),
		stop: () => {},
		kernel: {
			management: async () => [
				{ id: "tasks", version: "1.0.0", contributes: { views: ["tasks.board"] } },
				{ id: "channel-cli", version: "1.0.0", contributes: {} },
			],
			views: {
				list: () => [
					{ id: "core.background.rail", plugin: "core", title: "后台任务", placement: "rail", scope: "session" },
				],
			},
		},
	} as unknown as HostCtx;
}

const read = async (principal: HostCtx["principal"]) =>
	(await registry.call("capabilities.get", {}, ctxOf(principal), new AbortController().signal)) as Record<
		string,
		unknown
	>;

it("returns every v1.1 NodeFacts field and passes the protocol schema", async () => {
	const result = await read({
		id: "socket",
		transport: "socket",
		kind: "local",
		scopes: ["read", "write", "admin", "owner"],
	});

	expect(Check(NodeFactsSchema, result)).toBe(true);
	expect(result).toMatchObject({
		protocol: 1,
		minor: 1,
		kind: "local",
		version: { yonder: "0.3.0", commit: null },
		// 节点身份取真实 hostname，不生成随机值。
		node: { id: hostname(), name: hostname() },
		plugins: [
			{ id: "tasks", version: "1.0.0", views: ["tasks.board"] },
			{ id: "channel-cli", version: "1.0.0", views: [] },
		],
		views: [{ id: "core.background.rail" }],
		models: { select: false }, // models.list / sessions.model.set 尚未注册
		remoteSession: { create: true, modes: ["task"], agents: [], workspaces: false },
		auth: { kind: "local", owner: true },
	});
	// features 的六个开关按注册表事实判断，不是 UI 决定。
	expect(result.features).toEqual({
		requestIdDedupe: true,
		resumableWatch: true,
		attachments: false,
		notifications: true,
		approvals: false,
		suggestions: false,
	});
});

it("reports remote connections as task-only without owner scope", async () => {
	const result = await read({ id: "gateway:remote", transport: "gateway", kind: "remote", scopes: ["read", "write"] });

	expect(Check(NodeFactsSchema, result)).toBe(true);
	expect(result).toMatchObject({
		kind: "remote",
		// 远程连接看不到 local 方法，但 sessions.open 仍是 write。
		remoteSession: { create: true, modes: ["task"] },
		auth: { kind: "remote", owner: false },
	});
});

it("grants owner only when the principal actually holds the scope", async () => {
	const result = await read({ id: "gateway:local", transport: "gateway", kind: "local", scopes: ["read"] });

	expect(result).toMatchObject({ auth: { kind: "local", owner: false } });
	expect(Check(NodeFactsSchema, result)).toBe(true);
});
