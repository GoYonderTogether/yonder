import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("outline uses real ast-grep for TypeScript and Python", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((entry) => entry.name === "code-intel_ast_grep_outline");
	if (!tool) throw new Error("outline missing");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	const ctx = {
		agent: null,
		profile: "test",
		session: "1",
		capabilities: ["read", "exec"],
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		signal: new AbortController().signal,
	} as ToolContext;
	const result = await tool.execute(
		{
			paths: ["plugins/code-intel/src/index.ts", "skills/skill-creator/scripts/init_skill.py"],
			items: "all",
			view: "expanded",
		},
		ctx,
	);
	const files = JSON.parse(result.text).outline;
	expect(files).toHaveLength(2);
	expect(files.some((file: { language: string }) => file.language === "TypeScript")).toBe(true);
	expect(files.some((file: { language: string }) => file.language === "Python")).toBe(true);
	expect(result.text).toContain('"isImport":true');
	expect(result.text).toContain('"read":');
	const dir = await mkdtemp(join(tmpdir(), "outline-"));
	try {
		for (let i = 0; i < 51; i++) await cp("plugins/code-intel/src/index.ts", join(dir, `${i}.ts`));
		let raw = "";
		const truncated = await tool.execute(
			{ paths: [dir], items: "all" },
			{
				...ctx,
				cacheToolOutput: async (text) => {
					raw = text;
					return "cache.json";
				},
			},
		);
		const output = JSON.parse(truncated.text);
		expect(output.truncatedFiles).toBe(1);
		expect(output.fullOutput).toBe("cache.json");
		expect(JSON.parse(raw)).toHaveLength(51);
		expect(await readFile("plugins/code-intel/src/index.ts", "utf8")).toContain("definePlugin");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	const originalPath = process.env.PATH;
	try {
		process.env.PATH = "";
		await expect(tool.execute({ paths: ["plugins/code-intel/src/index.ts"] }, ctx)).rejects.toThrow(
			"ast-grep CLI not found",
		);
	} finally {
		process.env.PATH = originalPath;
	}
});
