import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import plugin from "../src/index.js";

async function tools() {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	return registrations.tools;
}

test("read symbol registration remains additive", async () => {
	const tool = (await tools()).find((item) => item.name === "code-intel_read_symbol");
	expect(tool?.capabilities).toEqual(["read", "exec"]);
	expect(tool?.parameters.required).toEqual(["file", "symbol"]);
	if (!tool) throw new Error("missing tool");
	const descriptor = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
	console.log("READ_SYMBOL_DESCRIPTOR_BYTES", Buffer.byteLength(descriptor));
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
		new Map([["code-intel", (await tools()) as never]]),
	);
	expect(catalog.find((item) => item.name === tool.name)?.exposure).toBe("plugin-not-selected");
});

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"reads actual source through pi-lens MCP",
	async () => {
		const registered = await tools();
		const tool = registered.find((item) => item.name === "code-intel_read_symbol");
		const report = registered.find((item) => item.name === "code-intel_module_report");
		if (!tool || !report) throw new Error("missing tools");
		const dir = await mkdtemp(join(tmpdir(), "yonder-read-symbol-"));
		try {
			const source =
				'export function hello() {\n  return "hello";\n}\n\nexport class Greeter {\n  greet() { return "hi"; }\n}\n\nsetTimeout(() => { console.log("later"); }, 10);\n\nclass Other { greet() { return "other"; } }\n';
			await writeFile(join(dir, "source.ts"), source);
			const ctx = {
				agent: null,
				profile: "test",
				session: "1",
				capabilities: ["read", "exec"],
				env: new NodeExecutionEnv({ cwd: dir }),
				signal: new AbortController().signal,
			} as ToolContext;
			const hello = await tool.execute({ file: "source.ts", symbol: "hello" }, ctx);
			expect(hello.text).toContain('export function hello() {\n  return "hello";\n}');
			expect(hello.text).toContain("source.ts:1-3");
			const member = await tool.execute({ file: "source.ts", symbol: "Greeter.greet" }, ctx);
			expect(member.text).toContain('  greet() { return "hi"; }');
			const result = await report.execute({ path: "source.ts", view: "default" }, ctx);
			const handle = JSON.parse(result.text.match(/```json\n(.*?)\n```/s)?.[1] ?? "{}").callbacks[0].name;
			const callback = await tool.execute({ file: "source.ts", symbol: handle }, ctx);
			expect(callback.text).toContain('setTimeout(() => { console.log("later"); }, 10);');
			const ambiguous = await tool.execute({ file: "source.ts", symbol: "greet" }, ctx);
			expect(ambiguous.isError).toBe(true);
			expect(ambiguous.text).toContain("Multiple definitions");
			await writeFile(join(dir, "source.ts"), source.replace("hello", "renamed"));
			const missing = await tool.execute({ file: "source.ts", symbol: "hello" }, ctx);
			expect(missing.text).toMatch(/not found/i);
			await writeFile(
				join(dir, "long.ts"),
				`export function longSymbol() {\n${"  console.log(123456789);\n".repeat(2500)} }\n`,
			);
			const long = await tool.execute({ file: "long.ts", symbol: "longSymbol" }, ctx);
			expect(long.text).toContain("truncated=true");
			await rm(join(dir, "source.ts"));
			expect((await tool.execute({ file: "source.ts", symbol: "hello" }, ctx)).text).toMatch(/not found/i);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
