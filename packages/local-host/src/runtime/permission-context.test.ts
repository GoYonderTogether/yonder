import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveProfile } from "@yonder/local-host/config/test-support";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db";
import { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import type { ToolContext } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("a real stored session is not enough to forge an active permission ToolContext", async () => {
	const home = await tempHome("ya-");
	let runtime: Runtime | undefined;
	try {
		runtime = await Runtime.open({
			home,
			storage: await openRuntimeStorage(await openDatabase(`${home}/state.db`)),
			config: { schema: 1 },
			resolveSession: async () => ({ agent: null, profile: "test", cwd: home, resolved: resolveProfile({}) }),
		});
		const session = await runtime.create({ agent: null, profile: "test", cwd: home });
		const ctx: ToolContext = {
			agent: null,
			profile: "test",
			session,
			capabilities: [],
			env: { id: "node:local" } as ToolContext["env"],
			signal: new AbortController().signal,
		};
		expect(() => runtime?.assertToolContext(ctx)).toThrow("真实运行中的工具调用上下文");
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
