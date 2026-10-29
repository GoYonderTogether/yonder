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
			const baseline = await tool.execute({ path: "grep.ts", view: "default" }, ctx);
			const report = (text: string) => {
				const match = text.match(/```json\n(.*?)\n```/s);
				if (!match?.[1]) throw new Error("report JSON missing");
				return JSON.parse(match[1]);
			};
			const focused = report(result.text);
			const normal = report(baseline.text);
			expect(focused.api).toEqual(normal.api);
			expect(focused.internal).toEqual(normal.internal);
			expect(focused.callbacks).toEqual(normal.callbacks);
			expect(focused.recommendedReads[0].reason).toContain("matches focus");
			const extended = await tool.execute(
				{
					path: "grep.ts",
					maxRefsPerSymbol: 1,
					blastRadius: true,
					blastRadiusDepth: 1,
					callGraph: true,
					maxCallGraphEntries: 1,
				},
				ctx,
			);
			expect(extended.isError).not.toBe(true);
			expect(report(extended.text).api).toEqual(normal.api);
			console.log("MODULE_REPORT_EXTENDED", extended.text.slice(0, 400), extended.text.slice(-200));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
