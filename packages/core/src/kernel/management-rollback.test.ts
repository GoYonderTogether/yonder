import { createHash } from "node:crypto";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import type { WorkspaceFiles } from "../config/index.js";
import { parseAgentConfig, parseYonderConfig } from "../config/index.js";
import { initHome } from "./index.js";
import { type ManagementState, manageObjects } from "./management.js";

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
				throw new Error("reload rejected");
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
		).rejects.toThrow("reload rejected");
		expect(await readFile(agentFile, "utf8")).toBe(agentText);
		expect(await readFile(configFile, "utf8")).toBe(configText);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
