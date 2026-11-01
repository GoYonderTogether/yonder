import assert from "node:assert/strict";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { GithubChannel } from "../src/channel.js";
import plugin from "../src/index.js";

afterEach(() => vi.restoreAllMocks());
test("every GitHub tool rejects excluded instances before platform access, even with admin", async () => {
	const collector = createRegistrationCollector();
	await plugin.setup({ ...collector.api, paths: { data: "/tmp" } } as PluginAPI);
	const provider = collector.registrations.channels[0];
	assert(provider);
	const channel = (await provider.create("b", {
		repository: "owner/repository",
		accounts: ["owner"],
		labels: ["task"],
	})) as GithubChannel;
	const get = vi.spyOn(channel.client, "get").mockRejectedValue(new Error("unexpected platform access"));
	const list = vi.spyOn(channel.client, "list").mockRejectedValue(new Error("unexpected platform access"));
	const write = vi.spyOn(channel.client, "write").mockRejectedValue(new Error("unexpected platform access"));
	const ctx = {
		capabilities: ["admin", "network", "exec"],
		channelInstances: ["a"],
		signal: new AbortController().signal,
	} as ToolContext;
	for (const tool of collector.registrations.tools) {
		for (const channelInstances of [["a"], []]) {
			const result = await tool.execute(
				{ instance: "b", issue: 1, pr: 1, releaseId: "1" },
				{ ...ctx, channelInstances },
			);
			expect(result.isError, tool.name).toBe(true);
			expect(result.text).toContain("Channel instance not authorized: b");
		}
	}
	for (const spy of [get, list, write]) expect(spy).not.toHaveBeenCalled();
	const status = collector.registrations.tools.find((t) => t.name === "channel-github_status");
	assert(status);
	for (const channelInstances of [["b"], ["a", "b"], undefined])
		expect((await status.execute({ instance: "b" }, { ...ctx, channelInstances })).isError).not.toBe(true);
});
