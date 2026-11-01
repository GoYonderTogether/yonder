import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector, tempHome } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { IlinkChannel } from "../src/channel.js";
import plugin from "../src/index.js";

afterEach(() => vi.restoreAllMocks());
test("iLink gates explicit and primary login and filters status before reading excluded instances", async () => {
	const home = await tempHome("ilink-scope-");
	try {
		const collector = createRegistrationCollector();
		await plugin.setup({ ...collector.api, paths: { data: home }, config: { owner: "person:owner" } } as PluginAPI);
		const provider = collector.registrations.channels[0];
		assert(provider);
		const channels = (await Promise.all(["b", "a"].map((id) => provider.create(id, {})))) as IlinkChannel[];
		const status = channels.map((c) =>
			vi.spyOn(c, "status").mockResolvedValue({ instance: c.id, paired: false } as never),
		);
		const login = channels.map((c) => vi.spyOn(c, "login").mockResolvedValue({ status: "wait" }));
		const ctx = {
			capabilities: ["admin", "network"],
			channelInstances: ["a"],
			signal: new AbortController().signal,
		} as ToolContext;
		const call = (name: string, args: object, scope = ctx) => {
			const tool = collector.registrations.tools.find((t) => t.name === `channel-wechat-ilink_${name}`);
			assert(tool);
			return tool.execute(args, scope);
		};
		for (const args of [{}, { instance: "b" }, { instance: "b", action: "poll" }]) {
			const result = await call("login", args);
			expect(result.isError).toBe(true);
			expect(result.text).toContain("Channel instance not authorized: b");
		}
		expect((await call("status", { instance: "b" })).isError).toBe(true);
		expect(JSON.parse((await call("status", {})).text)).toEqual([{ instance: "a", paired: false }]);
		expect(JSON.parse((await call("status", {}, { ...ctx, channelInstances: [] })).text)).toEqual([]);
		expect(status[0]).not.toHaveBeenCalled();
		for (const spy of login) expect(spy).not.toHaveBeenCalled();
		for (const channelInstances of [["b"], ["a", "b"], undefined])
			expect((await call("login", {}, { ...ctx, channelInstances })).isError).not.toBe(true);
		expect((await call("login", { instance: "a" })).isError).not.toBe(true);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
