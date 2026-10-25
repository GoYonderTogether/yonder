import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { FeishuChannel } from "../src/channel.js";
import plugin from "../src/index.js";

afterEach(() => vi.restoreAllMocks());
async function setup() {
	const collector = createRegistrationCollector();
	const send = vi.fn(async () => ({ ok: true }));
	const api = {
		...collector.api,
		messages: { send },
		paths: { data: ".yonder/scope-feishu" },
		events: { ...collector.api.events, emit: vi.fn() },
	} as unknown as PluginAPI;
	await plugin.setup(api);
	const provider = collector.registrations.channels[0]!;
	const a = (await provider.create("a", { appId: "protocol-a", secret: "unused" })) as FeishuChannel;
	const b = (await provider.create("b", { appId: "protocol-b", secret: "unused" })) as FeishuChannel;
	// No channel is started. Every platform boundary is counted, no real network or model.
	const counts = [a, b].map((channel) => ({
		status: vi.spyOn(channel, "status"),
		history: vi.spyOn(channel, "history").mockResolvedValue({ items: [] }),
		card: vi.spyOn(channel, "rawSend").mockResolvedValue("protocol-receipt"),
		task: vi.spyOn(channel.taskCards, "execute").mockResolvedValue({ ok: true }),
		request: vi.spyOn(channel.client, "request").mockRejectedValue(new Error("unexpected platform request")),
	}));
	const ctx = {
		agent: "scope-a",
		profile: "owner",
		session: "1",
		capabilities: ["read", "network", "message", "admin"],
		channelInstances: ["a"],
		signal: new AbortController().signal,
	} as ToolContext;
	const call = (name: string, args: object, context = ctx) =>
		collector.registrations.tools.find((tool) => tool.name === `channel-feishu_${name}`)!.execute(args, context);
	return { counts, ctx, call, send };
}

test("A cannot access B status/history/message/card/task-card, including admin: zero platform reads/requests", async () => {
	const x = await setup();
	for (const [name, args] of [
		["status", { instance: "b" }],
		["history", { instance: "b", chat: "chat" }],
		["message", { instance: "b", to: "conv:b:chat", text: "scope test" }],
		["card", { instance: "b", to: "conv:b:chat", card: {} }],
		["task_card", { instance: "b", action: "get", id: "receipt" }],
	] as const)
		expect((await x.call(name, args)).isError, name).toBe(true);
	for (const counts of x.counts) for (const counter of Object.values(counts)) expect(counter).not.toHaveBeenCalled();
	expect(x.send).not.toHaveBeenCalled();
	expect(JSON.parse((await x.call("status", {})).text)).toEqual([expect.objectContaining({ instance: "a" })]);
	expect(x.counts[1]!.status).not.toHaveBeenCalled();
	expect(JSON.parse((await x.call("status", {}, { ...x.ctx, channelInstances: [] })).text)).toEqual([]);
});

test("A normal, explicit A+B, legacy unrestricted and no-event proactive send remain valid", async () => {
	const x = await setup();
	const { channelInstances: _scope, ...legacy } = x.ctx;
	for (const [instance, ctx] of [
		["a", x.ctx],
		["b", { ...x.ctx, channelInstances: ["a", "b"] }],
		["b", legacy],
	] as const) {
		for (const [name, args] of [
			["status", { instance }],
			["history", { instance, chat: "chat" }],
			["message", { instance, to: `conv:${instance}:chat`, text: "scope test" }],
			["card", { instance, to: `conv:${instance}:chat`, card: {} }],
			["task_card", { instance, action: "get", id: "receipt" }],
		] as const)
			expect((await x.call(name, args, ctx)).isError, name).not.toBe(true);
	}
	expect(x.send).toHaveBeenCalledTimes(3);
	expect(x.send.mock.calls[0]).toEqual([expect.objectContaining({ via: "a" }), x.ctx]);
	// Still requires admin for history outside the real sources; scope is not a replacement.
	expect(
		(await x.call("history", { instance: "a", chat: "chat" }, { ...x.ctx, capabilities: ["read", "network"] })).isError,
	).toBe(true);
	for (const counts of x.counts) expect(counts.request).not.toHaveBeenCalled();
});
