import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector, tempHome } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import plugin from "../src/index.js";

test("review selects real git state and isolates Codex login", async () => {
	const dir = await tempHome("codex-review-");
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
		await plugin.setup({ ...api, paths: { data: dir } } as never);
		const tool = registrations.tools.find((item) => item.name === "codex-companion_review");
		if (!tool) throw new Error("review tool missing");
		const ctx = {
			agent: null,
			profile: "test",
			session: "test",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: repo }),
			signal: new AbortController().signal,
		} as ToolContext;
		const exec = ctx.env.exec.bind(ctx.env);
		vi.spyOn(ctx.env, "exec").mockImplementation((args, options, context) => {
			if (options?.inheritEnv === false && !(Array.isArray(args) && args[0] === "node" && args[1] === "-e")) {
				expect(options?.inheritEnv).toBe(false);
				expect(options?.env).toMatchObject({ CODEX_HOME: home, HOME: home, USERPROFILE: home });
				throw new Error("Codex invocation intentionally blocked in protocol test");
			}
			return exec(args, options, context);
		});
		expect((await tool.execute({ codexHome: home, scope: "working-tree" }, ctx)).text).toContain("clean");
		expect((await tool.execute({ codexHome: home, base: "main" }, ctx)).text).toContain("empty");
		await expect(tool.execute({ codexHome: join(dir, "missing") }, ctx)).rejects.toThrow("codexHome must exist");
		await expect(tool.execute({ codexHome: home, focus: "permissions" }, ctx)).rejects.toThrow("focus requires");
		await writeFile(join(repo, "untracked"), "review me\n");
		await expect(
			tool.execute(
				{ codexHome: home, adversarial: true, focus: "permissions" },
				{ ...ctx, signal: AbortSignal.timeout(4000) },
			),
		).rejects.toThrow();
		await expect(tool.execute({ codexHome: home }, { ...ctx, signal: AbortSignal.timeout(4000) })).rejects.toThrow();
		const signal = AbortSignal.abort();
		await expect(tool.execute({ codexHome: home }, { ...ctx, signal })).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 120_000);
