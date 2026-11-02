import { basename } from "node:path";
import type { AgentConfig, YonderConfig } from "../config/index.js";
import { loadPresets, loadYonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import { sourceRevision } from "./config-facts.js";

export async function loadHomeConfig(home: string) {
	const revisions = new Map<string, string>();
	const config = await loadYonderConfig(home, (_file, text) => revisions.set("home", sourceRevision(text)));
	return { config, revisions };
}

import { loadAgents } from "./workspace.js";

export async function loadHomeSources(
	home: string,
	config: YonderConfig,
	loaded: LoadedPlugins,
	agents: Map<string, AgentConfig>,
	revisions: Map<string, string>,
) {
	for (const entry of await loadAgents(home, config, loaded, (id, text) =>
		revisions.set(`agent:${id}`, sourceRevision(text)),
	))
		agents.set(...entry);
	return loadPresets(home, (file, text) => revisions.set(`preset:${basename(file)}`, sourceRevision(text)));
}
