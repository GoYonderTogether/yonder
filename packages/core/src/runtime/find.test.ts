import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { localEnvironment } from "./env.js";
import { createFindTool } from "./find.js";

test.skipIf(spawnSync("fd", ["--version"]).error && spawnSync("fdfind", ["--version"]).error)(
	"find searches real environment, honors ignore and hidden paths, caches truncated output, and cancels",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "yonder-find-"));
		try {
			await mkdir(join(root, "src/nested"), { recursive: true });
			await mkdir(join(root, ".hidden"));
			await mkdir(join(root, "empty-dir"));
			await writeFile(join(root, "src/a.ts"), "a");
			await writeFile(join(root, "src/nested/b.ts"), "b");
			await writeFile(join(root, "src/nested/ignored.ts"), "ignored");
			await writeFile(join(root, "src/nested/.gitignore"), "ignored.ts\n");
			await writeFile(join(root, ".hidden/c.ts"), "c");
			let cache = "";
			const ctx: ToolContext = {
				agent: "main",
				profile: "main",
				session: "1",
				capabilities: ["read"],
				env: localEnvironment(root),
				signal: new AbortController().signal,
				cacheToolOutput: async (text) => {
					cache = text;
					return "cache.txt";
				},
			};
			const tool = createFindTool();
			const found = await tool.execute({ pattern: "*.ts" }, ctx);
			expect(found.text.split("\n").sort()).toEqual([".hidden/c.ts", "src/a.ts", "src/nested/b.ts"]);
			expect((await tool.execute({ pattern: "empty-dir" }, ctx)).text).toBe("empty-dir/");
			const nested = await tool.execute({ pattern: "src/**/*.ts" }, ctx);
			expect(nested.text.split("\n").sort()).toEqual(["src/a.ts", "src/nested/b.ts"]);
			expect((await tool.execute({ pattern: "*.nope" }, ctx)).text).toBe("No files found matching pattern");
			await expect(tool.execute({ pattern: "*", path: "missing" }, ctx)).rejects.toThrow("Path not found");
			expect((await tool.execute({ pattern: "*.ts", limit: 1 }, ctx)).text).toContain("1 results limit reached");
			expect(cache.split("\n")).toHaveLength(1);
			const abort = new AbortController();
			abort.abort();
			await expect(tool.execute({ pattern: "*" }, { ...ctx, signal: abort.signal })).rejects.toBeDefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

test.skipIf(spawnSync("fd", ["--version"]).error)(
	"find matches fd on the real repository and its acquired cache is readable and searchable",
	async () => {
		const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
		const { createGrepTool } = await import("./grep.js");
		const { createReadTool } = await import("@earendil-works/pi-durable/tools");
		const { cacheToolOutput } = await import("./tool-output-cache.js");
		const home = await mkdtemp(join(tmpdir(), "yonder-find-cache-"));
		try {
			const cwd = process.cwd();
			const env = localEnvironment(cwd);
			const ctx: ToolContext = {
				agent: "main",
				profile: "main",
				session: "1",
				capabilities: ["read"],
				env,
				signal: new AbortController().signal,
				cacheToolOutput: (text) => cacheToolOutput(home, "1", "find", { pattern: "*.ts" }, text),
			};
			for (const pattern of ["*.ts", "src/**/*.ts"]) {
				const args = [
					"--glob",
					"--color=never",
					"--hidden",
					"--max-results",
					"100000",
					...(pattern.includes("/") ? ["--full-path"] : []),
					"--",
					pattern.includes("/") ? `**/${pattern}` : pattern,
					cwd,
				];
				const expected = spawnSync("fd", args, { encoding: "utf8" });
				expect(expected.status).toBe(0);
				const lines = expected.stdout
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => line.slice(cwd.length + 1))
					.sort();
				const result = await createFindTool().execute({ pattern, limit: 100000 }, ctx);
				expect(result.text.split("\n").sort()).toEqual(lines);
			}
			const limited = await createFindTool().execute({ pattern: "*.ts", limit: 3 }, ctx);
			const cachePath = limited.text.match(/Acquired output: (.+?)\. Use read/)?.[1];
			expect(cachePath).toBeTruthy();
			if (!cachePath) throw new Error("cache path missing");
			const read = await createReadTool().execute(
				{ path: cachePath },
				{ env } as import("@earendil-works/pi-durable").ToolExecutionApi,
				BACKGROUND_CONTEXT,
			);
			const cached = await env.readTextFile(cachePath, BACKGROUND_CONTEXT);
			expect(cached.ok).toBe(true);
			if (!cached.ok) throw cached.error;
			expect(read.output?.find((part) => part.type === "text")?.text).toBe(cached.value);
			const first = cached.value.split("\n")[0] ?? "";
			const grep = await createGrepTool().execute({ pattern: first, path: cachePath, literal: true }, ctx);
			expect(JSON.parse(grep.text).matches[0].text).toBe(first);
			const index = await env.readTextFile(join(home, "cache/tool-output/1/index.jsonl"), BACKGROUND_CONTEXT);
			expect(index.ok && JSON.parse(index.value).tool).toBe("find");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
);
