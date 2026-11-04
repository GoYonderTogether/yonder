import { sourceRevision } from "@yonder/bot-core/kernel/config-facts";
import {
	loadHomeSources as loadHomeSourcesFromSource,
	scaffoldAgentWorkspace as scaffoldAgentWorkspaceFromSource,
	seedIdentities as seedIdentitiesFromSource,
} from "@yonder/bot-core/kernel/source";
import type { BotSource } from "@yonder/bot-definition/source";
import type { AgentConfig, YonderConfig } from "@yonder/local-host/config/index";
import { loadYonderConfigFrom } from "@yonder/local-host/config/index";
import { createFsBotSource } from "@yonder/local-host/kernel/source-fs";
import type { LoadedPlugins } from "@yonder/local-host/plugins/index";
import type { Store } from "@yonder/local-host/store/index";

export async function loadHomeConfig(home: string, source: BotSource = createFsBotSource(home)) {
	const revisions = new Map<string, string>();
	const config = await loadYonderConfigFrom(source.home, (_file, text) => revisions.set("home", sourceRevision(text)));
	return { config, revisions };
}

export async function loadHomeSources(
	home: string,
	config: YonderConfig,
	loaded: LoadedPlugins,
	agents: Map<string, AgentConfig>,
	revisions: Map<string, string>,
	source: BotSource = createFsBotSource(home, { envs: () => loaded.envs }),
) {
	return loadHomeSourcesFromSource(source, config, loaded, agents, revisions);
}

export function scaffoldAgentWorkspace(
	source: BotSource,
	config: YonderConfig,
	agent: AgentConfig,
	loaded: LoadedPlugins,
) {
	return scaffoldAgentWorkspaceFromSource(source, config, agent, loaded);
}

export async function seedIdentities(config: YonderConfig, store: Store) {
	return seedIdentitiesFromSource(config, store);
}
