import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { diagnosticMark, diagnostics } from "../src/diagnostic-mark.js";
import { callLens } from "../src/lens-mcp.js";

test.skipIf(process.env.YONDER_LENS_REAL !== "1")(
	"real diagnostic dispositions and moved lines",
	async () => {
		const dir = await mkdtemp("/tmp/yonder-diagnostic-");
		const ctx = {
			session: "1",
			env: new NodeExecutionEnv({ cwd: dir }),
			signal: new AbortController().signal,
		} as ToolContext;
		const source = "int main() { return missing_name; }\n";
		const file = join(dir, "source.c");
		try {
			await writeFile(file, source);
			const report = await callLens(
				"pilens_analyze",
				{ file, flags: { "no-autoformat": true, "no-autofix": true, "no-tests": true } },
				ctx,
			);
			const json = /```json\n([\s\S]*?)\n```/.exec(report.text)?.[1];
			if (!json) throw new Error(`no real diagnostic: ${report.text}`);
			const found = (
				JSON.parse(json).diagnostics as Array<{
					line: number;
					tool: string;
					rule: string;
					message: string;
					semantic: string;
				}>
			).find((d) => d.tool === "cpp-check");
			if (!found) throw new Error(`cpp-check diagnostic missing: ${report.text}`);
			const args = {
				filePath: "source.c",
				line: found.line,
				tool: found.tool,
				rule: found.rule,
				message: found.message,
			};
			const marked = await diagnosticMark.execute({ ...args, disposition: "flagged" }, ctx);
			expect(JSON.parse(marked.text).scope).toBe("project");
			expect((await diagnostics.execute({ path: "source.c" }, { ...ctx, session: "2" })).text).toContain(
				'"flagged":true',
			);
			await diagnosticMark.execute({ ...args, disposition: "defer" }, ctx);
			if (found.semantic !== "blocking") {
				expect((await diagnostics.execute({ path: "source.c" }, ctx)).text).not.toContain(found.message);
				expect((await diagnostics.execute({ path: "source.c" }, { ...ctx, session: "2" })).text).toContain(
					found.message,
				);
			}
			await writeFile(file, `\n${source}`);
			const suppressed = await diagnosticMark.execute({ ...args, disposition: "suppress" }, ctx);
			expect(JSON.parse(suppressed.text).line).toBe(2);
			expect(await readFile(file, "utf8")).toBe(`\n// pi-lens-ignore: ${found.rule}\n${source}`);
			await writeFile(join(dir, "false.c"), source);
			await writeFile(join(dir, "other.c"), source);
			await Promise.all([
				diagnosticMark.execute({ ...args, filePath: "false.c", disposition: "false-positive" }, ctx),
				diagnosticMark.execute({ ...args, filePath: "other.c", disposition: "flagged" }, ctx),
			]);
			expect((await diagnostics.execute({ path: "false.c" }, { ...ctx, session: "2" })).text).not.toContain(
				found.message,
			);
			expect((await diagnostics.execute({ path: "other.c" }, { ...ctx, session: "2" })).text).toContain(
				'"flagged":true',
			);
			const log = await readFile(join(dir, ".pi-lens/dispositions.log"), "utf8");
			expect(log.trim().split("\n")).toHaveLength(5);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
