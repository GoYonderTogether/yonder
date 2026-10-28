import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("module report registration remains additive", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_module_report");
	expect(tool?.capabilities).toEqual(["read", "exec"]);
	expect(tool?.parameters.required).toEqual(["path"]);
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"reports real source through pi-lens MCP",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((item) => item.name === "code-intel_module_report");
		if (!tool) throw new Error("missing tool");
		const dir = await mkdtemp(join(tmpdir(), "yonder-lens-"));
		try {
			await copyFile(resolve("packages/core/src/runtime/grep.ts"), join(dir, "grep.ts"));
			const ctx = {
				agent: null,
				profile: "test",
				session: "1",
				capabilities: ["read", "exec"],
				env: new NodeExecutionEnv({ cwd: dir }),
				signal: new AbortController().signal,
			} as ToolContext;
			const result = await tool.execute({ path: "grep.ts", view: "default", focus: "grep" }, ctx);
			expect(result.text).toContain("createGrepTool");
			expect(result.text).toContain('"startLine":5');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
