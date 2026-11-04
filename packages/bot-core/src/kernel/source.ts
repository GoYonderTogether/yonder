import { basename } from "node:path";
import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import { loadAgentConfig, loadPresetsFrom } from "@yonder/bot-definition/load";
import type { BotSource } from "@yonder/bot-definition/source";
import type { Preset } from "@yonder/sdk";
import type { LoadedPlugins } from "../plugins/index.js";
import { scaffoldWorkspace } from "../prompt/index.js";
import { platformGroupBinding } from "../routing/platform-group.js";
import type { Store } from "../store/contracts.js";
import { sourceRevision } from "./config-facts.js";
import { profileContexts } from "./config-validation.js";
import { withConsoleBinding } from "./console.js";

export async function loadAgents(
	source: BotSource,
	config: YonderConfig,
	plugins: LoadedPlugins,
	onRead?: (id: string, text: string) => void,
	onFailure?: (id: string) => void,
): Promise<Map<string, AgentConfig>> {
	const agents = new Map<string, AgentConfig>();
	for (const entry of config.agents ?? []) {
		if (agents.has(entry.id)) throw new Error(`Duplicate agent: ${entry.id}`);
		agents.set(entry.id, {
			...withConsoleBinding(
				{
					...(await loadAgentConfig(
						source.workspace(entry),
						entry.id,
						(text) => onRead?.(entry.id, text),
						() => onFailure?.(entry.id),
					)),
					...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
				},
				config,
			),
		});
	}
	// Install effective platform profiles before session recovery, also on config reload.
	if (plugins.tools.has("social"))
		for (const agent of agents.values())
			for (const channel of plugins.channels.values())
				if (channel.multiAgent && channel.features?.groupParticipation === "membership")
					platformGroupBinding(agent, channel);
	return agents;
}

export async function loadHomeSources(
	source: BotSource,
	config: YonderConfig,
	plugins: LoadedPlugins,
	agents: Map<string, AgentConfig>,
	revisions: Map<string, string>,
): Promise<Map<string, Preset>> {
	for (const [id, agent] of await loadAgents(source, config, plugins, (agentId, text) =>
		revisions.set(`agent:${agentId}`, sourceRevision(text)),
	))
		agents.set(id, agent);
	return loadPresetsFrom(source.home, (file, text) => revisions.set(`preset:${basename(file)}`, sourceRevision(text)));
}

export function scaffoldAgentWorkspace(
	source: BotSource,
	config: YonderConfig,
	agent: AgentConfig,
	plugins: LoadedPlugins,
): Promise<void> {
	const entry = config.agents?.find((entry) => entry.id === agent.id);
	if (!entry) throw new Error(`Unknown agent: ${agent.id}`);
	return scaffoldWorkspace(source.workspace(entry), profileContexts(agent, config.defaultModel), plugins.contexts);
}

export async function seedIdentities(config: YonderConfig, store: Store): Promise<void> {
	for (const person of config.identity?.persons ?? []) {
		if (await store.identity().person(`person:${person.id}`)) continue;
		await store.identity().createPerson(person);
		for (const account of person.accounts ?? [])
			if (!(await store.identity().account(account))) await store.identity().link(account, `person:${person.id}`);
	}
}
