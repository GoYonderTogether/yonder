import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

// analysisRoot must resolve strictly below the home directory, so the sample lives there.
test.skipIf(!process.env.YONDER_LENS_REAL)(
	"lens diagnostics passes scan limits through to pi-lens",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((item) => item.name === "code-intel_lens_diagnostics");
		if (!tool) throw new Error("missing tool");
		const dir = await mkdtemp(join(homedir(), ".yonder-lens-params-"));
		try {
			await writeFile(join(dir, "a.ts"), "export const value: number = missing_name;\n");
			const ctx = {
				agent: null,
				profile: "test",
				session: "1",
				capabilities: ["read", "exec"],
				env: new NodeExecutionEnv({ cwd: dir }),
				signal: new AbortController().signal,
			} as ToolContext;
			const result = await tool.execute(
				{
					source: "lsp",
					scope: "paths",
					paths: ["a.ts"],
					waitMs: 10000,
					concurrency: 1,
					refreshRunners: "cheap",
					maxProjectFiles: 5,
					maxLspFiles: 5,
					includeGenerated: false,
					analysisRoot: dir,
				},
				ctx,
			);
			console.log("LENS_DIAGNOSTICS_PARAMS", result.text.slice(0, 600));
			expect(result.isError).not.toBe(true);
			expect(result.text).toContain("missing_name");
			expect(result.text).toMatch(/\nusage tokens=\d+ elapsed-ms=\d+ bytes=\d+ truncated=false$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
