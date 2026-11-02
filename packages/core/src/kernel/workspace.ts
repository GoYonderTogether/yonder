import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BotSource } from "@yonder/bot-definition/source";
import type { ExecutionEnv } from "@yonder/sdk";
import {
	type AgentConfig,
	loadAgentConfig,
	loadYonderConfig,
	resolveProfile,
	type WorkspaceFiles,
	type YonderConfig,
} from "../config/index.js";
import { createPermissions } from "../permissions.js";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { platformGroupBinding } from "../routing/platform-group.js";
import { credentialPath, FileCredentials, localEnvironment, type RuntimeSessionConfig } from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { projectRules } from "../runtime/project-rules.js";
import { createSkills } from "../skills/index.js";
import { withConsoleBinding } from "./console.js";
import { createFsBotSource } from "./source-fs.js";

export type KernelLog = (level: "info" | "warn" | "error", message: string, data?: object) => void;
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const unavailable = (): never => {
	throw new Error("Harness service is unavailable before start");
};

export function credentialsAndModels(home: string, config: YonderConfig) {
	const credentials = new FileCredentials(credentialPath(home, config.credentials));
	return { credentials, models: buildModels(credentials, config.models?.providers) };
}

export function inspectionServices(home: string, config: YonderConfig, log: KernelLog): KernelServices {
	return {
		...credentialsAndModels(home, config),
		permissions: createPermissions(async () => unavailable()),
		agents: { list: unavailable, configureBinding: unavailable, inspectBinding: unavailable },
		log: { info: (m, d) => log("info", m, d), warn: (m, d) => log("warn", m, d), error: (m, d) => log("error", m, d) },
		events: { emit: unavailable, ask: unavailable, query: unavailable, on: unavailable },
		messages: { send: unavailable },
		execution: { run: unavailable, resolve: unavailable },
		subagents: { run: unavailable },
		services: { resolve: unavailable },
		host: { status: unavailable, modelReady: unavailable },
		sessions: {
			command: unavailable,
			notify: unavailable,
			list: unavailable,
			get: unavailable,
			open: unavailable,
			submit: unavailable,
			abort: unavailable,
			close: unavailable,
			transcript: unavailable,
		},
		identity: {
			account: unavailable,
			person: unavailable,
			createPerson: unavailable,
			link: unavailable,
			unlink: unavailable,
			relation: unavailable,
			lookup: unavailable,
		},
	};
}

export function sourceFor(home: string, config: YonderConfig, plugins: LoadedPlugins) {
	return createFsBotSource(home, { envs: () => plugins.envs, agents: () => config.agents ?? [] });
}

export function filesFor(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	agent: string,
	signal?: AbortSignal,
	source?: BotSource,
): WorkspaceFiles {
	const entry = config.agents?.find((item) => item.id === agent);
	if (!entry) throw new Error(`Unknown agent: ${agent}`);
	return (source ?? sourceFor(home, config, plugins)).workspace(entry, signal);
}

export function projectRulesFor(
	_home: string,
	_config: YonderConfig,
	plugins: LoadedPlugins,
	session: RuntimeSessionConfig,
	signal?: AbortSignal,
	execution?: ExecutionEnv,
) {
	const env =
		execution ??
		(session.resolved.env === "local" ? localEnvironment(session.cwd) : plugins.envs.get(session.resolved.env));
	if (!env) throw new Error(`Unknown execution environment: ${session.resolved.env}`);
	const globalDir = resolve(homedir(), ".pi/agent");
	return projectRules(env, session.cwd, localEnvironment(globalDir), globalDir, signal);
}

export async function loadAgents(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	onRead?: (id: string, text: string) => void,
	onFailure?: (id: string) => void,
	source?: BotSource,
): Promise<Map<string, AgentConfig>> {
	const agents = new Map<string, AgentConfig>();
	for (const entry of config.agents ?? []) {
		if (agents.has(entry.id)) throw new Error(`Duplicate agent: ${entry.id}`);
		agents.set(entry.id, {
			...withConsoleBinding(
				{
					...(await loadAgentConfig(
						filesFor(home, config, plugins, entry.id, undefined, source),
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

export function skillsFor(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	log: KernelLog,
	source?: BotSource,
) {
	return createSkills({
		source: source ?? sourceFor(home, config, plugins),
		home,
		userHome: homedir(),
		pluginDirs: plugins.skillDirs,
		...(plugins.skillSources ? { pluginSources: plugins.skillSources } : {}),
		onIssue: (issue) => log("warn", `${issue.path}: ${issue.message}`),
		workspace: (session) => {
			if (!session.agent) return;
			const entry = config.agents?.find((entry) => entry.id === session.agent);
			if (!entry) throw new Error(`Unknown agent: ${session.agent}`);
			const root = resolve(home, entry.workspace);
			const env = !entry.env || entry.env === "local" ? localEnvironment(root) : plugins.envs.get(entry.env);
			if (!env) throw new Error(`Unknown workspace environment: ${entry.env}`);
			return {
				files: filesFor(home, config, plugins, session.agent, undefined, source),
				root,
				location: `workspace:${entry.env ?? "local"}`,
				env,
			};
		},
	});
}

export function profileFor(
	home: string,
	config: YonderConfig,
	agent: AgentConfig,
	profile = agent.defaultProfile,
): RuntimeSessionConfig {
	const selected = agent.profiles[profile];
	if (!selected) throw new Error(`Unknown profile: ${agent.id}/${profile}`);
	const entry = config.agents?.find((entry) => entry.id === agent.id);
	if (!entry) throw new Error(`Unknown agent: ${agent.id}`);
	return {
		agent: agent.id,
		profile,
		cwd: resolve(home, entry.workspace),
		resolved: resolveProfile(selected, agent.defaults, entry.env, config.defaultModel),
	};
}

export async function inspectSkills(home: string, agent = "main", profile?: string) {
	const config = await loadYonderConfig(home);
	const plugins = await loadPlugins(
		home,
		config,
		inspectionServices(home, config, () => {}),
	);
	const agents = await loadAgents(home, config, plugins);
	const selected = agents.get(agent);
	if (!selected) throw new Error(`Unknown agent: ${agent}`);
	return skillsFor(home, config, plugins, () => {}).inspect(profileFor(home, config, selected, profile));
}
