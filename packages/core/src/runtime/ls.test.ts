import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { localEnvironment } from "./env.js";
import { createLsTool } from "./ls.js";
import { cacheToolOutput } from "./tool-output-cache.js";

test("ls uses the execution environment, includes hidden entries, sorts and caches truncated output", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-ls-"));
	try {
		await mkdir(join(root, "Empty"));
		await writeFile(join(root, ".hidden"), "");
		await writeFile(join(root, "z-file"), "");
		await symlink("Empty", join(root, "link"));
		let cached = "";
		const ctx: ToolContext = {
			agent: "main",
			profile: "main",
			session: "1",
			capabilities: ["read"],
			env: localEnvironment(root),
			signal: new AbortController().signal,
			cacheToolOutput: async (text) => {
				cached = await cacheToolOutput(root, "1", "ls", {}, text);
				return cached;
			},
		};
		const ls = createLsTool();
		expect((await ls.execute({}, ctx)).text).toBe(".hidden\nEmpty/\nlink/\nz-file");
		expect((await ls.execute({ path: "Empty" }, ctx)).text).toBe("(empty directory)");
		expect((await ls.execute({ limit: 2 }, ctx)).text).toContain("2 entries limit reached");
		expect(await readFile(cached, "utf8")).toBe(".hidden\nEmpty/\nlink/\nz-file");
		expect(await readFile(join(root, "cache/tool-output/1/index.jsonl"), "utf8")).toContain(`"tool":"ls"`);
		await mkdir(join(root, "large"));
		for (let i = 0; i < 230; i++)
			await writeFile(join(root, "large", `${String(i).padStart(3, "0")}${"x".repeat(230)}`), "");
		expect((await ls.execute({ path: "large" }, ctx)).text).toContain("50KB limit reached");
		expect((await readFile(cached, "utf8")).split("\n")).toHaveLength(230);
		await expect(ls.execute({ path: "z-file" }, ctx)).rejects.toThrow("Not a directory:");
		await expect(ls.execute({ path: "absent" }, ctx)).rejects.toThrow("Path not found:");
		const controller = new AbortController();
		controller.abort();
		await expect(ls.execute({}, { ...ctx, signal: controller.signal })).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("ls catalog respects selection and read capability", async () => {
	const { resolveProfile } = await import("../config/test-support.js");
	const { inspectToolCatalog } = await import("./catalog.js");
	const config = {
		agent: "main",
		profile: "main",
		cwd: process.cwd(),
		resolved: resolveProfile({ capabilities: ["read"], tools: { offer: [], search: [] } }),
	};
	const ls = (resolved: typeof config.resolved) =>
		inspectToolCatalog({ ...config, resolved }, new Map()).find((tool) => tool.name === "ls");
	expect(ls(config.resolved)?.exposure).toBe("not-selected");
	expect(ls(resolveProfile({ capabilities: ["read"], tools: { offer: ["ls"], search: [] } }))?.exposure).toBe("offer");
	expect(ls(resolveProfile({ capabilities: [], tools: { offer: ["ls"], search: [] } }))?.exposure).toBe(
		"capability-denied",
	);
});
