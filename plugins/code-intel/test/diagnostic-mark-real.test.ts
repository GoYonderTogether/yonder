import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { Runtime } from "../../../packages/core/src/runtime/index.js";
import plugin from "../src/index.js";
import { callLens } from "../src/lens-mcp.js";

test.skipIf(process.env.YONDER_DIAGNOSTIC_MARK_REAL !== "1")(
	"real model marks a real LSP diagnostic",
	async () => {
		const home = process.env.HOME as string;
		const source = "/Users/zoran/.local/share/yonder-harness/home";
		const config = parse(await readFile(join(source, "yonder.yaml"), "utf8"));
		const auth = JSON.parse(await readFile(join(source, ".yonder/auth.json"), "utf8"));
		await writeFile(join(home, "auth.json"), JSON.stringify({ siliconflow: auth.siliconflow }), { mode: 0o600 });
		const workspace = join(home, "workspace");
		await mkdir(workspace);
		await writeFile(join(workspace, "diagnostic.c"), "int main() { return missing_name; }\n");
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const ctx = {
			agent: null,
			profile: "test",
			session: "probe",
			capabilities: ["read", "write", "exec"],
			env: new NodeExecutionEnv({ cwd: workspace }),
			signal: new AbortController().signal,
		} as ToolContext;
		const found = await callLens(
			"pilens_analyze",
			{
				file: join(workspace, "diagnostic.c"),
				flags: { "no-autoformat": true, "no-autofix": true, "no-tests": true },
			},
			ctx,
		);
		if (found.isError) throw new Error(`diagnostics failed: ${found.text}`);
		const json = /```json\n([\s\S]*?)\n```/.exec(found.text);
		if (!json?.[1]) throw new Error(`No structured diagnostic: ${found.text}`);
		const diagnostic = JSON.parse(json[1]).diagnostics?.[0];
		if (!diagnostic) throw new Error(`No real diagnostic: ${found.text}`);
		const profile = resolveProfile({
			model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
			thinking: "off",
			capabilities: ["read", "write", "exec"],
			plugins: ["code-intel"],
			tools: { offer: ["code-intel_lens_diagnostic_mark"] },
		});
		const events: Array<{ type: string; name?: string; phase?: string }> = [];
		const runtime = await Runtime.open({
			home,
			db: await openDatabase(join(home, "state.db")),
			config: {
				schema: 1,
				credentials: join(home, "auth.json"),
				compaction: { enabled: false },
				models: { providers: { siliconflow: config.models.providers.siliconflow } },
			},
			plugins: [{ id: "code-intel", tools: registrations.tools, hooks: [] }],
			resolveSession: async () => ({ agent: null, profile: "test", cwd: workspace, resolved: profile }),
		});
		try {
			const session = await runtime.create({ agent: null, profile: "test", cwd: workspace });
			const result = await runtime.submit(session, {
				text: `Call code-intel_lens_diagnostic_mark once using filePath diagnostic.c, line ${diagnostic.line}, message ${JSON.stringify(diagnostic.message)}, disposition flagged. Report the result.`,
				onOutput: (part) => events.push(part),
			});
			console.log(
				"REAL_DIAGNOSTIC_MARK",
				JSON.stringify({
					status: result.status,
					calls: events.filter((e) => e.type === "tool").map(({ name, phase }) => ({ name, phase })),
				}),
			);
			expect(result.status).toBe("done");
			expect(events.some((e) => e.type === "tool" && e.name === "code-intel_lens_diagnostic_mark")).toBe(true);
			const state = JSON.parse(await readFile(join(workspace, ".pi-lens/cache/diagnostic-dispositions.json"), "utf8"));
			expect(Object.values(state.dispositions)).toEqual(
				expect.arrayContaining([expect.objectContaining({ disposition: "flagged" })]),
			);
		} finally {
			await runtime.close();
			await unlink(join(home, "auth.json"));
		}
	},
	180_000,
);
