import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { SessionsAPI, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { sessionDiagnostics } from "../src/diagnostic-mark.js";
import { stopLens } from "../src/lens-mcp.js";

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"session diagnostics reaches clangd through a symlinked cwd",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "p153-real-"));
		const workspace = join(root, "workspace");
		const alias = join(root, "alias");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(workspace);
		await symlink(workspace, alias);
		await writeFile(join(workspace, "Makefile"), "");
		await writeFile(join(workspace, "probe.c"), "int main() { return missing_name; }\n");
		const sessions = {
			transcript: async () => [
				{ id: 1, kind: "pi.assistant", text: "", tools: [{ name: "write", args: { path: "probe.c" } }] },
			],
		} as unknown as SessionsAPI;
		const ctx = {
			session: "1",
			env: new NodeExecutionEnv({ cwd: alias }),
			signal: new AbortController().signal,
		} as ToolContext;
		try {
			const tool = sessionDiagnostics(sessions);
			const result = await tool.execute({ source: "session", waitMs: 10000 }, ctx);
			expect(result.text).toContain("missing_name");
			await writeFile(join(workspace, "probe.c"), "int main() { return 0; }\n");
			expect((await tool.execute({ source: "session", waitMs: 10000 }, ctx)).text).not.toContain("missing_name");
		} finally {
			stopLens();
			await rm(root, { recursive: true, force: true });
		}
	},
	30000,
);
