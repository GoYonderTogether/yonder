import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { presetSession } from "../config/index.js";
import { presetProfile, resolveProfile } from "../config/test-support.js";
import { inspectToolCatalog } from "./catalog.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

test("child scope survives runtime restart and a broader preset", async () => {
	const home = await mkdtemp("/tmp/yonder-scope-restart-");
	const parent = resolveProfile({
		plugins: ["web-tools"],
		tools: { offer: ["read"], search: [] },
		skills: ["notes-*"],
	});
	const saved = presetSession({}, "local", parent);
	const open = async () =>
		Runtime.open({
			home,
			db: await openDatabase(join(home, "state.db")),
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
