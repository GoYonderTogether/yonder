import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("task registration enforces write authority and isolates login", async () => {
	const dir = await mkdtemp(join(tmpdir(), "codex-task-"));
	try {
		const home = join(dir, "login");
		await mkdir(home);
		const { api, registrations } = createRegistrationCollector();
		await plugin.setup(api as never);
		const tool = registrations.tools.find((entry) => entry.name === "codex-companion_task");
		if (!tool) throw new Error("task tool missing");
		const ctx = {
			agent: null,
			profile: "test",
			session: "test",
			capabilities: ["read", "exec"],
			env: new NodeExecutionEnv({ cwd: dir }),
			signal: new AbortController().signal,
		} as ToolContext;
		await expect(tool.execute({ codexHome: home, task: "fix", write: true }, ctx)).rejects.toThrow("path restrictions");
		await expect(
			tool.execute({ codexHome: home, task: "fix", write: true }, { ...ctx, capabilities: ["read", "exec", "write"] }),
		).rejects.toThrow("path restrictions");
		await expect(
			tool.execute({ codexHome: join(process.env.HOME ?? "/nonexistent", ".codex"), task: "diagnose" }, ctx),
		).rejects.toThrow("default personal");
		await expect(
			tool.execute({ codexHome: home, task: "diagnose" }, { ...ctx, signal: AbortSignal.timeout(4000) }),
		).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 15_000);
