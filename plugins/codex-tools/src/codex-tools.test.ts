import { resolve } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { toolResult } from "./computer-use.js";
import plugin from "./index.js";
import { searchConfig, searchResult } from "./search.js";

describe("codex-tools source contract", () => {
	it("matches the built manifest and setup only registers", async () => {
		expect(await checkPlugin(resolve("plugins/codex-tools"))).toEqual([]);
	});
	it("declares static capabilities and rejects invalid parameters", () => {
		const { api, registrations } = createRegistrationCollector();
		plugin.setup(api as PluginAPI);
		expect(registrations.tools).toHaveLength(4);
		for (const tool of registrations.tools) expect(tool.capabilities).toContain("exec");
		const js = registrations.tools.find((tool) => tool.name === "codex-tools_js");
		if (!js) throw new Error("JS tool missing");
		expect(Check(js.parameters, { code: "await cua.getState();" })).toBe(true);
		expect(Check(js.parameters, { code: "", timeout_ms: 0 })).toBe(false);
		expect(Check(js.parameters, { code: "", server: "other" })).toBe(false);
	});
	it("preserves actual-protocol empty/error blocks without fake success", () => {
		// Structural mapping only, not a model or desktop execution fixture.
		expect(toolResult({ content: [], isError: true }).isError).toBe(true);
		expect(() => toolResult({})).toThrow("content");
		expect(() => toolResult({ content: [{ type: "image" }] })).toThrow("mimeType/data");
	});
	it("maps MCP image fields to SDK images without embedding bytes in text", () => {
		// Pure field mapping, not a simulated screenshot/model execution.
		const result = toolResult({ content: [{ type: "image", mimeType: "image/png", data: "AA==" }] });
		expect(result.images).toEqual([{ mime: "image/png", data: "AA==" }]);
		expect(result.text).not.toContain("AA==");
	});
	it("uses native per-server overrides without replacing transports", () => {
		const config = searchConfig(["workbench"]);
		expect(() => searchConfig(["server.with.dots"])).toThrow("Cannot safely disable");
		expect(config["mcp_servers.workbench.enabled"]).toBe(false);
		expect(config.mcp_servers).toBeUndefined();
		expect(config.web_search).toBe("live");
		expect(config["features.shell_tool"]).toBe(false);
	});
	it("does not accept a normal answer as native hosted search", () => {
		expect(() => searchResult("gpt-6-luna", "", "", "completed", [])).toThrow("missing native");
		expect(() => searchResult("gpt-6-luna", "", "", "failed", [])).toThrow("status failed");
	});
});
