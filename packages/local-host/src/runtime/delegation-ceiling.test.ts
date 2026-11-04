import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { presetSession } from "@yonder/local-host/config/index";
import { presetProfile, resolveProfile } from "@yonder/local-host/config/test-support";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db";
import { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import { inspectToolCatalog } from "@yonder/runtime-adapter/runtime/catalog";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("child scope survives runtime restart and a broader preset", async () => {
	const home = await tempHome("yonder-scope-restart-");
	const parent = resolveProfile({
		plugins: ["web-tools"],
		tools: { offer: ["read"], search: [] },
		skills: ["notes-*"],
	});
	const saved = presetSession({}, "local", parent);
	const open = async () =>
		Runtime.open({
			home,
			storage: await openRuntimeStorage(await openDatabase(join(home, "state.db"))),
			config: { schema: 1 },
			resolveSession: async () => ({ agent: null, profile: "child", cwd: home, resolved: parent }),
		});
	let runtime: Runtime | undefined;
	try {
		runtime = await open();
		const id = await runtime.create({
			agent: null,
			profile: "child",
			cwd: home,
			env: "local",
			capabilities: saved.capabilities,
			inherit: saved.inherit,
		});
		await runtime.close();
		runtime = await open();
		const state = await runtime.sessionState(id);
		expect(state?.inherit).toEqual(saved.inherit);
		const resolved = presetProfile(
			{ plugins: ["web-tools", "cron"], tools: { offer: ["*"], search: ["*"] }, skills: ["*"] },
			"local",
			state?.capabilities,
			state?.inherit,
		);
		expect(resolved.plugins).toEqual(["web-tools"]);
		expect(resolved.delegationCeilings?.[0]?.skills).toEqual(["notes-*"]);
		const tools = inspectToolCatalog({ agent: null, profile: "child", cwd: home, resolved }, new Map());
		expect(tools.find((tool) => tool.name === "read")?.exposure).toBe("offer");
		expect(tools.find((tool) => tool.name === "bash")?.exposure).not.toBe("offer");
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
