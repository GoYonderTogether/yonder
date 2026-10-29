import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { astGrepReplace } from "../src/ast-grep-replace.js";
import plugin from "../src/index.js";
import { MAX_RESULT_BYTES } from "../src/result-contract.js";
import { executable } from "./cli.js";

const source = [
	"var a = 1;",
	"function f() {",
	"\tvar b = 2;",
	"\treturn [b];",
	"}",
	"function g() {",
	"\treturn 3;",
	"}",
	"init();",
	"foo(1);",
	"foo(2);",
	"done();",
	"",
].join("\n");

const cases: [string, Record<string, string>, string[]][] = [
	[
		"insideKind",
		{ pattern: "var $A = $B", rewrite: "let $A = $B", insideKind: "function_declaration" },
		["var b = 2;"],
	],
	["hasKind", { pattern: "return $X", rewrite: "return null", hasKind: "array" }, ["return [b];"]],
	[
		"hasDescendantKind",
		{ pattern: "function $F() { $$$ }", rewrite: "function $F() {}", hasDescendantKind: "array" },
		["function f() {\n\tvar b = 2;\n\treturn [b];\n}"],
	],
	["follows", { pattern: "foo($X);", rewrite: "bar($X);", follows: "init();" }, ["foo(1);"]],
	["precedes", { pattern: "foo($X);", rewrite: "bar($X);", precedes: "done();" }, ["foo(2);"]],
];

// Real ast-grep CLI: skips where it is missing or not executable (install @ast-grep/cli 0.51.0).
test.skipIf(!executable("ast-grep"))("structural filters narrow preview and apply the latest preview", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ast-replace-filter-"));
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
	try {
		await writeFile(path, source);
		for (const [name, filter, expected] of cases) {
			const result = await astGrepReplace.execute({ ...filter, lang: "typescript", paths: [path] }, ctx);
			const { matches } = JSON.parse(result.text) as { matches: { text: string }[] };
			expect(
				matches.map((m) => m.text),
				name,
			).toEqual(expected);
		}
		const args = { pattern: "foo($X);", rewrite: "bar($X);", follows: "init();", lang: "typescript", paths: [path] };
		await expect(astGrepReplace.execute({ ...args, follows: "foo(1);", apply: true }, ctx)).rejects.toThrow(
			"No matching preview",
		);
		await astGrepReplace.execute(args, ctx);
		await astGrepReplace.execute({ ...args, apply: true }, ctx);
		expect(await readFile(path, "utf8")).toBe(source.replace("foo(1)", "bar(1)"));
		await expect(
			astGrepReplace.execute({ ...args, hasKind: "array", hasDescendantKind: "array" }, ctx),
		).rejects.toThrow("mutually exclusive");
		await expect(astGrepReplace.execute({ ...args, insideKind: "a b" }, ctx)).rejects.toThrow("single AST node kind");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test.skipIf(!executable("ast-grep"))("registered results are capped at 40 KiB with a usage footer", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_ast_grep_replace");
	if (!tool) throw new Error("missing tool");
	const dir = await mkdtemp(join(tmpdir(), "ast-replace-cap-"));
	const ctx: ToolContext = {
		agent: null,
		profile: "test",
		session: "1",
		capabilities: ["read", "write", "exec"],
		env: new NodeExecutionEnv({ cwd: dir }),
		signal: new AbortController().signal,
		authorizeFileWrite: async () => {},
	};
	try {
		await writeFile(join(dir, "a.ts"), "foo(1);\n".repeat(2000));
		const big = await tool.execute({ pattern: "foo($X)", rewrite: "bar($X)", lang: "typescript" }, ctx);
		expect(Buffer.byteLength(big.text)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
		expect(big.text).toMatch(/\nusage tokens=\d+ elapsed-ms=\d+ bytes=\d+ truncated=true$/);
		await writeFile(join(dir, "a.ts"), "foo(1);\n");
		const small = await tool.execute({ pattern: "foo($X)", rewrite: "bar($X)", lang: "typescript" }, ctx);
		const footer = small.text.match(/\nusage tokens=(\d+) elapsed-ms=\d+ bytes=(\d+) truncated=false$/);
		const body = small.text.slice(0, footer?.index);
		expect(Number(footer?.[2])).toBe(Buffer.byteLength(body));
		expect(Number(footer?.[1])).toBe(Math.ceil(Buffer.byteLength(body) / 4));
		expect(JSON.parse(body).matches).toHaveLength(1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
