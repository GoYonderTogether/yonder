import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { Runtime } from "../../../packages/core/src/runtime/index.js";
import plugin from "../src/index.js";

test.skipIf(process.env.YONDER_MODULE_REPORT_REAL !== "1")(
	"real model uses module report",
	async () => {
		const home = process.env.HOME as string;
		const source = "/Users/zoran/.local/share/yonder-harness/home";
		const config = parse(await readFile(join(source, "yonder.yaml"), "utf8"));
		const auth = JSON.parse(await readFile(join(source, ".yonder/auth.json"), "utf8"));
		await writeFile(join(home, "auth.json"), JSON.stringify({ siliconflow: auth.siliconflow }), { mode: 0o600 });
		const workspace = join(home, "workspace");
		await mkdir(workspace);
		await cp(resolve("packages/core/src/runtime/grep.ts"), join(workspace, "grep.ts"));
		await cp(resolve("packages/core/src/runtime/index.ts"), join(workspace, "index.ts"));
		const { api, registrations } = createRegistrationCollector();
		plugin.setup(api as never);
		const profile = resolveProfile({
			model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
			thinking: "off",
			capabilities: ["read", "exec"],
			plugins: ["code-intel"],
			tools: { offer: ["code-intel_module_report"] },
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
				text: "Use code-intel_module_report on grep.ts to find createGrepTool and report its starting line.",
				onOutput: (part) => events.push(part),
			});
			console.log(
				"REAL_MODULE_REPORT",
				JSON.stringify({
					status: result.status,
					calls: events.filter((e) => e.type === "tool").map(({ name, phase }) => ({ name, phase })),
				}),
			);
			expect(result.status).toBe("done");
			expect(events.some((e) => e.type === "tool" && e.name === "code-intel_module_report")).toBe(true);
			expect(result.text).toContain("createGrepTool");
		} finally {
			await runtime.close();
		}
	},
	180_000,
);
