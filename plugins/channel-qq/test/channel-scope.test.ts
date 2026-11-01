import assert from "node:assert/strict";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import type { QQChannel } from "../src/channel.js";
import plugin from "../src/index.js";

test("QQ status only reads authorized instances, with unrestricted compatibility", async () => {
	const collector = createRegistrationCollector();
	await plugin.setup({ ...collector.api, paths: { data: "/tmp" } } as PluginAPI);
	const provider = collector.registrations.channels[0];
	assert(provider);
	const channels = (await Promise.all(
		["a", "b"].map((id) => provider.create(id, { appId: "1", credential: "unused" })),
	)) as QQChannel[];
	assert(channels[1]);
	const excluded = vi.spyOn(channels[1], "status");
	const tool = collector.registrations.tools[0];
	assert(tool);
	for (const [channelInstances, expected] of [
		[["a"], ["a"]],
		[[], []],
		[undefined, ["a", "b"]],
	] as const) {
		const result = await tool.execute({}, { channelInstances, capabilities: ["admin"] } as unknown as ToolContext);
		expect(JSON.parse(result.text).instances.map((c: { instance: string }) => c.instance)).toEqual(expected);
		if (channelInstances) expect(excluded).not.toHaveBeenCalled();
	}
});
