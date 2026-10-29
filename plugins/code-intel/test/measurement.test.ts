import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import { fromResult, toResult } from "../../../packages/core/src/runtime/results.js";
import { cacheSdkResult } from "../../../packages/core/src/runtime/tool-output-cache.js";
import plugin from "../src/index.js";

test("module report selection and descriptor size", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((x) => x.name === "code-intel_module_report");
	if (!tool) throw new Error("tool missing");
	const description = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
	expect(Buffer.byteLength(description)).toBe(964);
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
	expect(catalog.find((x) => x.name === tool.name)?.exposure).toBe("plugin-not-selected");
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"real report follows runtime cache boundary",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((x) => x.name === "code-intel_module_report");
		if (!tool) throw new Error("tool missing");
		const dir = await mkdtemp("/tmp/yonder-lens-cache-");
		try {
			await copyFile(resolve("packages/core/src/runtime/index.ts"), join(dir, "index.ts"));
			const ctx = {
				agent: null,
				profile: "test",
				session: "1",
				capabilities: ["read", "exec"],
				env: new NodeExecutionEnv({ cwd: dir }),
				signal: new AbortController().signal,
			} as ToolContext;
			const args = { path: "index.ts", view: "default" };
			const raw = await tool.execute(args, ctx);
			console.log("MODULE_REPORT_BYTES", Buffer.byteLength(raw.text));
			const bounded = fromResult(await cacheSdkResult(toResult(raw), ctx, { name: tool.name, args }, { home: dir }));
			expect(bounded.text).toBe(raw.text);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
