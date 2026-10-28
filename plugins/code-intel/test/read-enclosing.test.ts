import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("read enclosing calls the real pi-lens backend", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_read_enclosing");
	if (!tool) throw new Error("tool missing");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	const ctx = {
		agent: null,
		profile: "test",
		session: "test",
		capabilities: ["read", "exec"],
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		signal: new AbortController().signal,
	} as ToolContext;
	const args = { path: "packages/core/src/runtime/grep.ts", line: 5 };
	const full = await tool.execute(args, ctx);
	expect(full.isError).not.toBe(true);
	expect(full.text).toContain("createGrepTool");
	const oversized = await tool.execute({ ...args, maxLines: 1 }, ctx);
	expect(oversized.isError).toBe(true);
	expect(oversized.text).not.toContain("export function createGrepTool");
	const slice = await tool.execute({ ...args, maxLines: 1, onOversize: "slice" }, ctx);
	expect(slice.text.toLowerCase()).toContain("partial");
	const outline = await tool.execute({ ...args, maxLines: 1, onOversize: "outline" }, ctx);
	expect(outline.text).toContain("execute");
	const nested = await tool.execute({ ...args, line: 54 }, ctx);
	expect(nested.text).toContain("onOutput");
	expect((await tool.execute({ ...args, line: 99999 }, ctx)).isError).toBe(true);
	expect((await tool.execute({ path: "README.md", line: 1 }, ctx)).isError).toBe(true);
}, 120_000);
