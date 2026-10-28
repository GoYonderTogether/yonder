import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import plugin from "../src/index.js";

test("AST search registration and selection", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((entry) => entry.name === "code-intel_ast_grep_search");
	if (!tool) throw new Error("tool missing");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	expect(tool.parameters.required).toEqual(["lang"]);
	expect(Object.keys(tool.parameters.properties)).toEqual([
		"lang",
		"pattern",
		"rule",
		"nodeKind",
		"paths",
		"selector",
		"context",
		"insideKind",
		"hasKind",
		"hasDescendantKind",
		"follows",
		"precedes",
		"skip",
		"maxMatches",
		"groupByFile",
		"strictness",
		"validateOnly",
		"dump",
	]);
	const descriptor = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
	console.log("AST_SEARCH_DESCRIPTOR_BYTES", Buffer.byteLength(descriptor));
	const catalog = inspectToolCatalog(
		{
			agent: null,
			profile: "test",
			cwd: process.cwd(),
			resolved: resolveProfile({
				plugins: [],
				capabilities: ["read", "exec"],
				tools: { offer: [tool.name], search: [] },
			}),
		},
		new Map([["code-intel", registrations.tools as never]]),
	);
	expect(catalog.find((entry) => entry.name === tool.name)?.exposure).toBe("plugin-not-selected");
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"AST search calls the real pi-lens backend",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((entry) => entry.name === "code-intel_ast_grep_search");
		if (!tool) throw new Error("tool missing");
		expect(tool.capabilities).toEqual(["read", "exec"]);
		const ctx = {
			agent: null,
			profile: "test",
			session: "test",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			signal: new AbortController().signal,
		} as ToolContext;
		const scope = { lang: "typescript", paths: ["packages/core/src/runtime/grep.ts"] };
		const first = await tool.execute({ ...scope, pattern: "const $NAME = $VALUE", maxMatches: 1 }, ctx);
		expect(first.isError).not.toBe(true);
		expect(first.text).toContain("grep.ts:");
		expect(first.text).toContain("skip=1");
		const grouped = await tool.execute(
			{ ...scope, pattern: "const $NAME = $VALUE", skip: 1, maxMatches: 1, groupByFile: true },
			ctx,
		);
		expect(grouped.text).toMatch(/grep\.ts.*L\d+:\d+/);
		expect(grouped.text).toContain("skip=2");
		const empty = await tool.execute({ ...scope, pattern: "notARealFunctionForAstSearch($X)" }, ctx);
		expect(empty.text).toContain("No matches");
		expect(empty.text).toContain("dump=true");
		const dump = await tool.execute({ lang: "typescript", pattern: "console.log($MSG)", dump: true }, ctx);
		expect(dump.text).toContain("call_expression");
		const invalid = await tool.execute(
			{ lang: "typescript", rule: "kind: definitely_not_a_node_kind", validateOnly: true },
			ctx,
		);
		expect(invalid.isError).toBe(true);
		const conflict = await tool.execute({ lang: "typescript", rule: "kind: identifier", nodeKind: "identifier" }, ctx);
		expect(conflict.isError).toBe(true);
		expect(conflict.text).toContain("nodeKind cannot be combined with rule");
		const valid = await tool.execute(
			{ lang: "typescript", pattern: "console.log($MSG)", paths: ["does-not-exist"], validateOnly: true },
			ctx,
		);
		expect(valid.isError).not.toBe(true);
		expect(valid.text.toLowerCase()).toContain("valid");
	},
	120_000,
);
