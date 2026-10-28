import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";
import { stopLens } from "../src/lens-mcp.js";

test("registers project report with read and exec", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_project_report");
	expect(tool?.capabilities).toEqual(["read", "exec"]);
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"project report builds a cold graph and returns a warm report",
	async () => {
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((item) => item.name === "code-intel_project_report");
		if (!tool) throw new Error("missing tool");
		const dir = await mkdtemp(join(tmpdir(), "yonder-project-report-"));
		try {
			await copyFile(resolve("packages/sdk/src/index.ts"), join(dir, "index.ts"));
			const ctx = { env: new NodeExecutionEnv({ cwd: dir }), signal: new AbortController().signal } as ToolContext;
			const first = await tool.execute({ view: "default" }, ctx);
			expect(first.text).toContain('"available":false');
			let warm = first;
			for (let i = 0; i < 20 && warm.text.includes('"available":false'); i++) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				warm = await tool.execute({ view: "default" }, ctx);
			}
			expect(warm.text).toContain('"available":true');
		} finally {
			stopLens();
			await rm(dir, { recursive: true, force: true });
		}
	},
	30_000,
);
