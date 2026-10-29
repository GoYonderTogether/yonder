import type { Capability, Tool } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { inspectToolCatalog } from "../runtime/catalog.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";
import { defaultLazyGroups, lazyGroupOf } from "./catalog.js";

const codeIntelNames = [
	"code-intel_read_symbol",
	"code-intel_module_report",
	"code-intel_ast_grep_outline",
	"code-intel_ast_grep_search",
	"code-intel_lsp_navigation",
	"code-intel_codegraph_explore",
];

const pluginTools = (): Map<string, Tool[]> =>
	new Map([
		[
			"code-intel",
			codeIntelNames.map((name) => ({
				name,
				description: name,
				parameters: { type: "object", properties: {} },
				capabilities: ["read"] as Capability[],
				execute: async () => ({ text: "" }),
			})),
		],
	]);

const config = (tools?: { offer?: string[]; search?: string[]; lazyGroups?: string[] }): RuntimeSessionConfig => ({
	agent: "main",
	profile: "owner",
	cwd: process.cwd(),
	resolved: resolveProfile({ level: "bypass", plugins: ["code-intel"], ...(tools ? { tools } : {}) }),
});

const exposureOf = (config: RuntimeSessionConfig, name: string, active?: Set<string>) =>
	inspectToolCatalog(config, pluginTools(), active).find((tool) => tool.name === name)?.exposure;

test("the code-intel group is the default lazy group and matches only its own tools", () => {
	expect(defaultLazyGroups).toContain("code-intel");
	expect(lazyGroupOf("code-intel_read_symbol")).toBe("code-intel");
	expect(lazyGroupOf("read")).toBeUndefined();
	expect(lazyGroupOf("code-intel_read_symbol", [])).toBeUndefined();
	expect(resolveProfile({ level: "bypass" }).tools.lazyGroups).toEqual(["code-intel"]);
});

test("lazy tools stay out of the initial tool list but remain searchable through tool_search", () => {
	const plain = config();
	for (const name of codeIntelNames) expect(exposureOf(plain, name)).toBe("search");
	expect(exposureOf(plain, "tool_search")).toBe("offer");
	// Activation is what tool_search does on a hit: the whole group becomes resident again.
	const active = new Set(["code-intel"]);
	for (const name of codeIntelNames) expect(exposureOf(plain, name, active)).toBe("offer");
});

test("lazyGroups: [] keeps the group resident, and explicit selection still works", () => {
	for (const name of codeIntelNames) expect(exposureOf(config({ lazyGroups: [] }), name)).toBe("offer");
	expect(
		exposureOf(config({ lazyGroups: [], offer: [], search: ["code-intel_read_symbol"] }), "code-intel_read_symbol"),
	).toBe("search");
	expect(exposureOf(config({ lazyGroups: ["code-intel"], offer: [], search: [] }), "code-intel_read_symbol")).toBe(
		"not-selected",
	);
});
