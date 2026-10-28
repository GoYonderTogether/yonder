import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import plugin from "../src/index.js";

async function registered() {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	return registrations.tools;
}

test("effective config is an optional registered tool", async () => {
	const tools = await registered();
	const tool = tools.find((item) => item.name === "code-intel_effective_config");
	if (!tool) throw new Error("missing tool");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	expect(tool.parameters.required ?? []).toEqual([]);
	console.log(
		"EFFECTIVE_CONFIG_DESCRIPTOR_BYTES",
		Buffer.byteLength(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })),
	);
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
		new Map([["code-intel", tools as never]]),
	);
	expect(catalog.find((item) => item.name === tool.name)?.exposure).toBe("plugin-not-selected");
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"actual backend explains configuration without exposing secrets or escaping workspace",
	async () => {
		const tool = (await registered()).find((item) => item.name === "code-intel_effective_config");
		if (!tool) throw new Error("missing tool");
		const dir = await mkdtemp(join(process.env.HOME as string, "effective-config-"));
		try {
			const workspace = join(dir, "project");
			await mkdir(workspace);
			await writeFile(join(workspace, "source.ts"), "export const answer = 42;\n");
			await symlink(dir, join(workspace, "outside"));
			const ctx = {
				agent: null,
				profile: "test",
				session: "1",
				capabilities: ["read", "exec"],
				env: new NodeExecutionEnv({ cwd: workspace }),
				signal: new AbortController().signal,
			} as ToolContext;
			const empty = await tool.execute({}, ctx);
			expect(empty.text).toContain("Config: 0 file(s) contributing");
			await mkdir(join(process.env.HOME as string, ".pi-lens"), { recursive: true });
			await writeFile(
				join(process.env.HOME as string, ".pi-lens/config.json"),
				JSON.stringify({ reviewGraph: { maxFiles: 123 } }),
			);
			await writeFile(
				join(workspace, ".pi-lens.json"),
				JSON.stringify({
					reviewGraph: { maxFiles: 321 },
					lsp: {
						servers: {
							custom: {
								command: "secret-command",
								args: ["secret-argument"],
								env: { TOKEN: "secret-value" },
								extensions: [".ts"],
							},
						},
					},
				}),
			);
			const result = await tool.execute({ file: "source.ts" }, ctx);
			expect(result.text).toContain("typescript");
			expect(result.text).toContain(".pi-lens.json");
			expect(result.text).toContain("project");
			const view = JSON.parse(result.text.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "{}");
			expect(view.provenance.find((entry: { key: string }) => entry.key === "/reviewGraph/maxFiles")?.tier).toBe(
				"project",
			);
			expect(result.text).not.toContain("secret-argument");
			expect(result.text).not.toContain("secret-value");
			expect(result.text).not.toContain(process.env.HOME as string);
			await expect(tool.execute({ file: "../outside.ts" }, ctx)).rejects.toThrow("outside cwd");
			await expect(tool.execute({ file: "outside/file.ts" }, ctx)).rejects.toThrow("outside cwd");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
