import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("CodeGraph tool uses the selected execution environment and an actual index", async () => {
	const dir = await mkdtemp(join(tmpdir(), "yonder-codegraph-"));
	try {
		await cp(resolve("packages/core/src/runtime/grep.ts"), join(dir, "grep.ts"));
		await cp(resolve("packages/core/src/runtime/index.ts"), join(dir, "index.ts"));
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((item) => item.name === "code-intel_codegraph_explore");
		if (!tool) throw new Error("tool missing");
		expect(tool.name).toBe("code-intel_codegraph_explore");
		expect(tool.capabilities).toEqual(["read", "exec"]);
		const originalPath = process.env.PATH;
		process.env.PATH = "";
		const missingContext = {
			agent: null,
			profile: "test",
			session: "1",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: dir }),
			signal: new AbortController().signal,
		} as ToolContext;
		try {
			await expect(tool.execute({ query: "createGrepTool" }, missingContext)).rejects.toThrow("CodeGraph unavailable");
		} finally {
			process.env.PATH = originalPath;
		}
		const ctx = {
			agent: null,
			profile: "test",
			session: "1",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: dir }),
			signal: new AbortController().signal,
		} as ToolContext;
		await expect(tool.execute({ query: "createGrepTool" }, ctx)).rejects.toThrow("codegraph init");
		execFileSync("codegraph", ["init", "--yes", dir], { timeout: 120_000, stdio: "pipe" });
		const result = await tool.execute({ query: "createGrepTool", maxFiles: 2 }, ctx);
		expect(result.text).toContain("createGrepTool");
		expect(result.text).toContain("grep.ts");
		expect(result.text).toContain("2 callers in `index.ts`");
		const callers = execFileSync("codegraph", ["callers", "--path", dir, "createGrepTool"], { encoding: "utf8" });
		expect(callers).toContain("method      install");
		expect(callers).toContain("index.ts:486");
		expect(callers).toContain("grep.ts:5");
		const source = await readFile(join(dir, "index.ts"), "utf8");
		expect(source).toContain("private install()");
		expect(source).toContain("[createGrepTool(),");
		await appendFile(join(dir, "grep.ts"), "\n// changed\n");
		await expect(tool.execute({ query: "createGrepTool" }, ctx)).rejects.toThrow("codegraph sync");
		const controller = new AbortController();
		controller.abort();
		await expect(tool.execute({ query: "createGrepTool" }, { ...ctx, signal: controller.signal })).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 180_000);
