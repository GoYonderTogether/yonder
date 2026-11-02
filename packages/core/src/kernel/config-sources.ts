import { basename } from "node:path";
import type { BotSource } from "@yonder/bot-definition/source";
import type { AgentConfig, YonderConfig } from "../config/index.js";
import { loadPresetsFrom, loadYonderConfigFrom } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import { scaffoldWorkspace } from "../prompt/index.js";
import type { Store } from "../store/index.js";
import { sourceRevision } from "./config-facts.js";
import { profileContexts } from "./home.js";
import { createFsBotSource } from "./source-fs.js";

export async function loadHomeConfig(home: string, source: BotSource = createFsBotSource(home)) {
	const revisions = new Map<string, string>();
	const config = await loadYonderConfigFrom(source.home, (_file, text) => revisions.set("home", sourceRevision(text)));
	return { config, revisions };
}

import { loadAgents } from "./workspace.js";

export async function loadHomeSources(
	home: string,
	config: YonderConfig,
	loaded: LoadedPlugins,
	agents: Map<string, AgentConfig>,
	revisions: Map<string, string>,
	source: BotSource = createFsBotSource(home, { envs: () => loaded.envs }),
) {
	for (const entry of await loadAgents(
		home,
		config,
		loaded,
		(id, text) => revisions.set(`agent:${id}`, sourceRevision(text)),
		undefined,
		source,
	))
		agents.set(...entry);
	return loadPresetsFrom(source.home, (file, text) => revisions.set(`preset:${basename(file)}`, sourceRevision(text)));
}

export function scaffoldAgentWorkspace(
	source: BotSource,
	config: YonderConfig,
	agent: AgentConfig,
	loaded: LoadedPlugins,
) {
	const entry = config.agents?.find((entry) => entry.id === agent.id);
	if (!entry) throw new Error(`Unknown agent: ${agent.id}`);
	return scaffoldWorkspace(source.workspace(entry), profileContexts(agent, config.defaultModel), loaded.contexts);
}

export async function seedIdentities(config: YonderConfig, store: Store) {
	for (const person of config.identity?.persons ?? []) {
		if (await store.identity().person(`person:${person.id}`)) continue;
		await store.identity().createPerson(person);
		for (const account of person.accounts ?? [])
			if (!(await store.identity().account(account))) await store.identity().link(account, `person:${person.id}`);
	}
}
