import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it } from "vitest";

it("satisfies the plugin contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});

it("offers URLs without a pattern that constrains provider generation to one character", async () => {
	const { default: plugin } = await import("../src/index.ts");
	const tools: Array<{ name: string; parameters: { properties: Record<string, { items?: object }> } }> = [];
	await plugin.setup({ id: "web-tools", tools: { register: (tool: never) => tools.push(tool) } } as never);
	const fetch = tools.find((tool) => tool.name === "web-tools_fetch");
	const extract = tools.find((tool) => tool.name === "web-tools_extract");
	expect(fetch?.parameters).toMatchObject({ properties: { url: { type: "string", minLength: 1 } } });
	expect(fetch?.parameters.properties.url).not.toHaveProperty("pattern");
	expect(extract?.parameters.properties.urls?.items).not.toHaveProperty("pattern");
});
