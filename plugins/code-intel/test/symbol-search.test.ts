import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import plugin from "../src/index.js";
import { callLens } from "../src/lens-mcp.js";

vi.mock("../src/lens-mcp.js", () => ({
	callLens: vi.fn(async () => ({ text: "result" })),
	startLens: vi.fn(),
	stopLens: vi.fn(),
}));

test("symbol search registers and forwards its parameters to the shared MCP connection", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_symbol_search");
	if (!tool) throw new Error("missing tool");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	expect(tool.parameters.required).toEqual(["query"]);
	const ctx = { signal: new AbortController().signal } as never;
	const args = { query: "parseRef", limit: 2, paths: ["src"], lang: "typescript" };
	await tool.execute(args, ctx);
	expect(callLens).toHaveBeenCalledWith("pilens_symbol_search", args, ctx);
});
