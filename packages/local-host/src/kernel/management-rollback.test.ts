import { createHash } from "node:crypto";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspaceFiles } from "@yonder/local-host/config/index";
import { parseAgentConfig, parseYonderConfig } from "@yonder/local-host/config/index";
import { initHome } from "@yonder/local-host/kernel/index";
import { type ManagementState, manageObjects } from "@yonder/local-host/kernel/management";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("management checks the locked agent revision and restores saved files when reload rejects", async () => {
	const home = await tempHome("yonder-management-rollback-");
	try {
		await initHome(home, "owner", { model: "openai/gpt-6-luna" });
		const configFile = resolve(home, "yonder.yaml");
		const agentFile = resolve(home, "agents/main/agent.yaml");
		const configText = await readFile(configFile, "utf8");
		const agentText = await readFile(agentFile, "utf8");
		const config = parseYonderConfig(configText, configFile);
		const agent = parseAgentConfig(agentText, agentFile, "main");
		let reloadCalls = 0;
		let activeName = agent.name;
		let failRestoreReload = false;
		const workspace: WorkspaceFiles = {
			readFile: (path) => readFile(resolve(home, "agents/main", path), "utf8"),
			writeFile: (path, text) => writeFile(resolve(home, "agents/main", path), text),
			exists: async (path) =>
				access(resolve(home, "agents/main", path)).then(
					() => true,
					() => false,
				),
			list: async (path) =>
				(await readdir(resolve(home, "agents/main", path), { withFileTypes: true })).map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
				})),
		};
		const state: ManagementState = {
			config,
			agents: new Map([["main", agent]]),
			presets: new Map(),
			files: () => workspace,
			validate: async () => {},
			scaffold: async () => {},
			reload: async () => {
				reloadCalls++;
				activeName = parseAgentConfig(await workspace.readFile("agent.yaml"), agentFile, "main").name;
				if (reloadCalls === 1 || reloadCalls === 3) throw new Error("reload receipt failed");
				if (reloadCalls === 4 && failRestoreReload) throw new Error("second reload failed");
			},
		};
		await expect(
			manageObjects(
				home,
				{ action: "agents.update", id: "main", expectedFileRevision: "stale", value: { name: "Changed" } },
				state,
			),
		).rejects.toThrow("Config changed while updating");
		expect(await readFile(agentFile, "utf8")).toBe(agentText);
		const expectedFileRevision = createHash("sha256").update(agentText).digest("hex");
		await expect(
			manageObjects(
				home,
				{ action: "agents.update", id: "main", expectedFileRevision, value: { name: "Changed" } },
				state,
			),
		).rejects.toThrow("reload receipt failed");
		expect(reloadCalls).toBe(2);
		expect(activeName).toBe(agent.name);
		expect(await readFile(agentFile, "utf8")).toBe(agentText);
		expect(await readFile(configFile, "utf8")).toBe(configText);
		failRestoreReload = true;
		await expect(
			manageObjects(
				home,
				{ action: "agents.update", id: "main", expectedFileRevision, value: { name: "Changed again" } },
				state,
			),
		).rejects.toThrow("rollback failed: restore reload failed: second reload failed");
		expect(reloadCalls).toBe(4);
		expect(activeName).toBe(agent.name);
		expect(await readFile(agentFile, "utf8")).toBe(agentText);
		expect(await readFile(configFile, "utf8")).toBe(configText);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
