import { expect, test } from "vitest";
import { bundles, shippedChannels, shippedDisabledChannels } from "./bundles.js";

const status = "随包提供，未启用 · Shipped, not enabled";

test("shipped-but-disabled channels list only plugins resolvable in this install and skip enabled types", async () => {
	const missing = "@yonder/plugin-channel-qq";
	const entries = await shippedDisabledChannels(["feishu", undefined], async (plugin) => plugin !== missing);
	expect(entries).toEqual([
		{ type: "wechat-ilink", plugin: "@yonder/plugin-channel-wechat-ilink", status },
		{ type: "github", plugin: "@yonder/plugin-channel-github", status },
	]);
});

test("default plugins, shipped disabled channels, and optional plugins stay separate", () => {
	for (const bundle of Object.values(bundles)) {
		expect(bundle.plugins.map(({ use }) => use)).toContain("@yonder/plugin-learning");
		expect(bundle.plugins.map(({ use }) => use)).not.toContain("@yonder/plugin-secrets");
		for (const channel of shippedChannels)
			expect(Object.values(bundle.channels)).not.toContainEqual({ type: channel.type });
	}
	for (const { plugin } of shippedChannels) expect(bundles.default.plugins.map(({ use }) => use)).not.toContain(plugin);
	expect(bundles.default.plugins.map(({ use }) => use)).not.toContain("@yonder/plugin-browser-skill");
	expect(bundles.full.plugins.map(({ use }) => use)).toContain("@yonder/plugin-browser-skill");
});

test("full contains every plugin of default, and core carries no channel plugin", () => {
	const used = (id: keyof typeof bundles) => bundles[id].plugins.map(({ use }) => use);
	for (const use of used("default")) expect(used("full")).toContain(use);
	expect(used("core").filter((use) => use.includes("channel"))).toEqual([]);
	expect(used("full")).not.toContain("@yonder/plugin-hermes-experience");
});
