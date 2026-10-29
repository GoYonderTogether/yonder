import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { astGrepReplace } from "../src/ast-grep-replace.js";
import { executable } from "./cli.js";

// Real ast-grep CLI: skips where it is missing or not executable (install @ast-grep/cli 0.51.0).
test.skipIf(!executable("ast-grep"))(
	"preview does not write, changed files are rejected, unchanged preview applies",
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "ast-replace-"));
		const path = join(dir, "a.ts");
		const ctx: ToolContext = {
			agent: null,
			profile: "test",
			session: "1",
			capabilities: ["read", "write", "exec"],
			env: new NodeExecutionEnv({ cwd: dir }),
			signal: new AbortController().signal,
			authorizeFileWrite: async () => {},
		};
		const args = { pattern: "foo($X)", rewrite: "bar($X)", lang: "typescript", paths: [path] };
		try {
			await writeFile(path, "foo(1);\n");
			await astGrepReplace.execute(args, ctx);
			expect(await readFile(path, "utf8")).toBe("foo(1);\n");
			await writeFile(path, "foo(2);\n");
			await expect(astGrepReplace.execute({ ...args, apply: true }, ctx)).rejects.toThrow("preview again");
			expect(await readFile(path, "utf8")).toBe("foo(2);\n");
			await astGrepReplace.execute(args, ctx);
			await expect(
				astGrepReplace.execute(
					{ ...args, apply: true },
					{
						...ctx,
						authorizeFileWrite: async () => {
							throw new Error("denied");
						},
					},
				),
			).rejects.toThrow("denied");
			await astGrepReplace.execute({ ...args, apply: true }, ctx);
			expect(await readFile(path, "utf8")).toBe("bar(2);\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);
