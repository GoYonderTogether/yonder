import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
		await plugin.setup({ ...api, paths: { data: dir } } as never);
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
		const candidates = registrations.tools.find((entry) => entry.name === "codex-companion_candidates");
		if (!candidates) throw new Error("candidates tool missing");
		const candidatePath = join(dir, `${createHash("sha256").update(ctx.session).digest("hex")}.json`);
		await writeFile(candidatePath, JSON.stringify([{ id: "first" }, { id: "second" }]));
		expect(JSON.parse((await candidates.execute({}, ctx)).text)).toHaveLength(2);
		expect((await candidates.execute({}, { ...ctx, session: "other" })).text).toBe("[]");
		await expect(tool.execute({ codexHome: home, task: "fix", write: true }, ctx)).rejects.toThrow("writeEnabled");
		await expect(
			tool.execute({ codexHome: home, task: "fix", write: true }, { ...ctx, capabilities: ["read", "exec", "write"] }),
		).rejects.toThrow("writeEnabled");
		await expect(tool.execute({ codexHome: join(dir, "missing"), task: "diagnose" }, ctx)).rejects.toThrow(
			"codexHome must exist",
		);
		await expect(
			tool.execute({ codexHome: home, task: "diagnose" }, { ...ctx, signal: AbortSignal.timeout(4000) }),
		).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 15_000);
