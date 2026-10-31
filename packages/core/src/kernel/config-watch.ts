import type { Preset } from "@yonder/sdk";
import { type AgentConfig, loadYonderConfig, watchConfig, type YonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import type { Store } from "../store/index.js";
import { filesFor, type KernelLog, loadAgents } from "./workspace.js";

/** Hot reload of agent config: candidate loading, validation, scaffolding and publishing. */
export function watchAgents({
	home,
	config,
	agents,
	presets,
	loaded,
	store,
	log,
	validateCandidate,
	scaffoldAgent,
}: {
	home: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	presets: Map<string, Preset>;
	loaded: LoadedPlugins;
	store: Store;
	log: KernelLog;
	validateCandidate(
		candidateConfig: YonderConfig,
		candidateAgents: Map<string, AgentConfig>,
		candidatePresets: Map<string, Preset>,
	): Promise<void>;
	scaffoldAgent(agent: AgentConfig, candidate?: YonderConfig): Promise<void>;
}) {
	let pendingRestart = "";
	return watchConfig({
		home,
		agents,
		presets,
		workspaceFiles: (id) => filesFor(home, config, loaded, id),
		candidate: async () => {
			const disk = await loadYonderConfig(home);
			const { agents: _diskAgents, ...diskRest } = disk;
			const { agents: _runningAgents, ...activeRest } = config;
			const signature = JSON.stringify(diskRest);
			if (signature !== JSON.stringify(activeRest) && signature !== pendingRestart)
				log("warn", "Non-agent yonder.yaml changes require restart");
			pendingRestart = signature;
			const candidate = { ...config, agents: disk.agents ?? [] };
			return { config: candidate, agents: await loadAgents(home, candidate, loaded) };
		},
		validate: async (nextAgents, nextPresets, nextConfig) => {
			await validateCandidate(nextConfig ?? config, nextAgents, nextPresets);
			for (const agent of nextAgents.values()) if (!agent.archivedAt) await scaffoldAgent(agent, nextConfig ?? config);
		},
		publish: (candidate) => {
			config.agents = candidate.agents ?? [];
		},
		onReload: async (event) => {
			await store.events.record(event);
		},
	});
}
