import { resolve } from "node:path";
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
import {
	credentialPath,
	FileCredentials,
	localEnvironment,
	type RuntimeSessionConfig,
	workspaceFiles,
} from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { createSkills } from "../skills/index.js";
import { withConsoleBinding } from "./console.js";

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
		agents: { list: unavailable },
		log: { info: (m, d) => log("info", m, d), warn: (m, d) => log("warn", m, d), error: (m, d) => log("error", m, d) },
		events: { emit: unavailable, ask: unavailable, query: unavailable, on: unavailable },
		messages: { send: unavailable },
		execution: { run: unavailable, resolve: unavailable },
		services: { resolve: unavailable },
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

export function filesFor(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	agent: string,
	signal?: AbortSignal,
): WorkspaceFiles {
	const entry = config.agents?.find((item) => item.id === agent);
	if (!entry) throw new Error(`Unknown agent: ${agent}`);
	const cwd = resolve(home, entry.workspace);
	if (!entry.env || entry.env === "local") return workspaceFiles(localEnvironment(cwd), signal, cwd);
	const environment = plugins.envs.get(entry.env);
	if (!environment) throw new Error(`Unknown workspace environment: ${entry.env}`);
	const files = workspaceFiles(environment, signal, cwd);
	return {
		readFile: (path) => files.readFile(resolve(cwd, path)),
		writeFile: (path, text) => files.writeFile(resolve(cwd, path), text),
		exists: (path) => files.exists(resolve(cwd, path)),
		list: (path) => files.list(resolve(cwd, path)),
	};
}

export async function loadAgents(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
): Promise<Map<string, AgentConfig>> {
	const agents = new Map<string, AgentConfig>();
	for (const entry of config.agents ?? []) {
		if (agents.has(entry.id)) throw new Error(`Duplicate agent: ${entry.id}`);
		agents.set(entry.id, {
			...withConsoleBinding(
				{
					...(await loadAgentConfig(filesFor(home, config, plugins, entry.id), entry.id)),
					...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
				},
				config,
			),
		});
	}
	return agents;
}

export function skillsFor(home: string, config: YonderConfig, plugins: LoadedPlugins, log: KernelLog) {
	return createSkills({
		home,
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
				files: filesFor(home, config, plugins, session.agent),
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
		resolved: resolveProfile(selected, agent.defaults, entry.env),
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
