import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("review selects real git state and isolates Codex login", async () => {
	const dir = await mkdtemp(join(tmpdir(), "codex-review-"));
	try {
		const repo = join(dir, "repo");
		const home = join(dir, "login");
		await mkdir(repo);
		await mkdir(home);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
		git("init", "-b", "main");
		git("config", "user.name", "Review Test");
		git("config", "user.email", "review@example.invalid");
		await writeFile(join(repo, "file"), "original\n");
		git("add", "file");
		git("commit", "-m", "initial");
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools[0];
		if (!tool) throw new Error("review tool missing");
		const ctx = {
			agent: null,
			profile: "test",
			session: "test",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: repo }),
			signal: new AbortController().signal,
		} as ToolContext;
		expect((await tool.execute({ codexHome: home, scope: "working-tree" }, ctx)).text).toContain("clean");
		expect((await tool.execute({ codexHome: home, base: "main" }, ctx)).text).toContain("empty");
		await expect(tool.execute({ codexHome: join(process.env.HOME ?? "/nonexistent", ".codex") }, ctx)).rejects.toThrow(
			"default personal",
		);
		await writeFile(join(repo, "untracked"), "review me\n");
		await expect(tool.execute({ codexHome: home }, { ...ctx, signal: AbortSignal.timeout(4000) })).rejects.toThrow();
		const signal = AbortSignal.abort();
		await expect(tool.execute({ codexHome: home }, { ...ctx, signal })).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 120_000);
