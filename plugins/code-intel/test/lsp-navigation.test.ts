import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import plugin from "../src/index.js";

test("navigation is selected explicitly and requires write and exec", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_lsp_navigation");
	if (!tool) throw new Error("missing tool");
	expect(tool.capabilities).toEqual(["read", "write", "exec"]);
	expect(tool.parameters.required).toEqual(["operation"]);
	console.log(
		"LSP_DESCRIPTOR_BYTES",
		Buffer.byteLength(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })),
	);
	for (const [plugins, capabilities, exposure] of [
		[[], ["read", "write", "exec"], "plugin-not-selected"],
		[["code-intel"], ["read"], "capability-denied"],
	] as const) {
		const catalog = inspectToolCatalog(
			{
				agent: null,
				profile: "test",
				cwd: process.cwd(),
				resolved: resolveProfile({
					plugins: [...plugins],
					capabilities: [...capabilities],
					tools: { offer: [tool.name], search: [] },
				}),
			},
			new Map([["code-intel", registrations.tools as never]]),
		);
		expect(catalog.find((item) => item.name === tool.name)?.exposure).toBe(exposure);
	}
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"navigates and previews rename through real clangd",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((item) => item.name === "code-intel_lsp_navigation");
		if (!tool) throw new Error("missing tool");
		const dir = await mkdtemp(join(tmpdir(), "yonder-lsp-"));
		try {
			await writeFile(join(dir, "value.h"), "int calculate(int x);\n");
			await writeFile(
				join(dir, "value.c"),
				'#include "value.h"\nint calculate(int x) { return x + 1; }\nint main(void) { return calculate(2); }\n',
			);
			const ctx = {
				agent: null,
				profile: "test",
				session: "test",
				capabilities: ["read", "write", "exec"],
				env: new NodeExecutionEnv({ cwd: dir }),
				signal: new AbortController().signal,
			} as ToolContext;
			for (const operation of ["definition", "references", "hover"]) {
				const result = await tool.execute({ operation, path: "value.c", line: 3, character: 25 }, ctx);
				console.log(operation, result.text);
				expect(result.isError).not.toBe(true);
				expect(JSON.parse(result.text.split("\n")[0]).resultCount).toBeGreaterThan(0);
			}
			const unsupported = await tool.execute({ operation: "notAnOperation" }, ctx);
			expect(unsupported.isError).toBe(true);
			const controller = new AbortController();
			controller.abort();
			await expect(
				tool.execute(
					{ operation: "hover", path: "value.c", line: 3, character: 25 },
					{ ...ctx, signal: controller.signal },
				),
			).rejects.toThrow();
			const renamed = await tool.execute(
				{ operation: "rename", path: "value.c", line: 2, character: 6, newName: "compute", apply: false },
				ctx,
			);
			expect(renamed.isError).not.toBe(true);
			expect(renamed.text).toContain("compute");
			const blocked = await tool.execute(
				{ operation: "rename", path: "value.c", line: 2, character: 6, newName: "compute", apply: true },
				ctx,
			);
			expect(blocked.isError).toBe(true);
			expect(await readFile(join(dir, "value.c"), "utf8")).toContain("calculate");
			expect(await readFile(join(dir, "value.h"), "utf8")).toContain("calculate");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
