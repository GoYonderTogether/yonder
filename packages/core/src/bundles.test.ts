import { expect, test } from "vitest";
import { bundles, shippedDisabledChannels } from "./bundles.js";

const status = "随包提供，未启用 · Shipped, not enabled";

test("shipped-but-disabled channels list only plugins resolvable in this install and skip enabled types", async () => {
	const missing = "@yonder/plugin-channel-qq";
	const entries = await shippedDisabledChannels(["feishu", undefined], async (plugin) => plugin !== missing);
	expect(entries).toEqual([
		{ type: "wechat-ilink", plugin: "@yonder/plugin-channel-wechat-ilink", status },
		{ type: "github", plugin: "@yonder/plugin-channel-github", status },
	]);
});

test("full contains every plugin of default, and core carries no channel plugin", () => {
	const used = (id: keyof typeof bundles) => bundles[id].plugins.map(({ use }) => use);
	for (const use of used("default")) expect(used("full")).toContain(use);
	expect(used("core").filter((use) => use.includes("channel"))).toEqual([]);
	expect(used("full")).not.toContain("@yonder/plugin-hermes-experience");
});
