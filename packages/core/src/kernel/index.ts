import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EventQuery, Models, Preset, SessionInfo, SessionsAPI, YEvent } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { parseDocument, stringify } from "yaml";
import {
	type AgentConfig,
	loadAgentConfig,
	loadPresets,
	loadYonderConfig,
	parseYonderConfig,
	resolveProfile,
	type WorkspaceFiles,
	watchConfig,
	type YonderConfig,
} from "../config/index.js";
import { createDelivery, sourceMessage } from "../delivery/index.js";
import { type KernelServices, type LoadedPlugins, loadPlugins, pluginDirectory } from "../plugins/index.js";
import { type PromptOptions, prepareInput, scaffoldWorkspace, systemSections } from "../prompt/index.js";
import { type UpdateResult, updateResultEvent } from "../release/result.js";
import { runChannelCommand } from "../routing/commands.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import {
	credentialPath,
	FileCredentials,
	inspectToolCatalog,
	localEnvironment,
	Runtime,
	type RuntimeSessionConfig,
	workspaceFiles,
} from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { createSessions } from "../sessions/index.js";
import { addLocalSkill, createSkills, removeLocalSkill } from "../skills/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";
import { createSkillTool } from "../tools/skill-view.js";
import { manageObjects } from "./management.js";

export type KernelLog = (level: "info" | "warn" | "error", message: string, data?: object) => void;
export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const unavailable = (): never => {
	throw new Error("Harness service is unavailable before start");
};

function credentialsAndModels(home: string, config: YonderConfig) {
	const credentials = new FileCredentials(credentialPath(home, config.credentials));
	return { credentials, models: buildModels(credentials, config.models?.providers) };
}

function inspectionServices(home: string, config: YonderConfig, log: KernelLog): KernelServices {
	return {
		...credentialsAndModels(home, config),
		log: { info: (m, d) => log("info", m, d), warn: (m, d) => log("warn", m, d), error: (m, d) => log("error", m, d) },
		events: { emit: unavailable, ask: unavailable, query: unavailable, on: unavailable },
		messages: { send: unavailable },
		execution: { run: unavailable, resolve: unavailable },
		services: { resolve: unavailable },
		sessions: {
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

function filesFor(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	agent: string,
	signal?: AbortSignal,
): WorkspaceFiles {
	const entry = config.agents?.find((item) => item.id === agent);
	if (!entry) throw new Error(`Unknown agent: ${agent}`);
	const cwd = resolve(home, entry.workspace);
	if (!entry.env || entry.env === "local") return workspaceFiles(localEnvironment(cwd), signal);
	const environment = plugins.envs.get(entry.env);
	if (!environment) throw new Error(`Unknown workspace environment: ${entry.env}`);
	const files = workspaceFiles(environment, signal);
	return {
		readFile: (path) => files.readFile(resolve(cwd, path)),
		writeFile: (path, text) => files.writeFile(resolve(cwd, path), text),
		exists: (path) => files.exists(resolve(cwd, path)),
		list: (path) => files.list(resolve(cwd, path)),
	};
}

async function loadAgents(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
): Promise<Map<string, AgentConfig>> {
	const agents = new Map<string, AgentConfig>();
	for (const entry of config.agents ?? []) {
		if (agents.has(entry.id)) throw new Error(`Duplicate agent: ${entry.id}`);
		agents.set(entry.id, {
			...(await loadAgentConfig(filesFor(home, config, plugins, entry.id), entry.id)),
			...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
		});
	}
	return agents;
}

function skillsFor(home: string, config: YonderConfig, plugins: LoadedPlugins, log: KernelLog) {
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

function profileFor(
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

export interface ManagementRequest {
	action: string;
	id?: string;
	source?: string;
	agent?: string;
	profile?: string;
	preset?: string;
	value?: unknown;
}
export async function manageHome(home: string, request: ManagementRequest, running?: LoadedPlugins): Promise<unknown> {
	const config = await loadYonderConfig(home);
	if (request.action === "skills.add" || request.action === "skills.remove") {
		const entry = request.agent ? config.agents?.find((item) => item.id === request.agent) : undefined;
		if (request.agent && !entry) throw new Error(`Unknown agent: ${request.agent}`);
		if (entry?.env && entry.env !== "local") throw new Error("Local skill management requires a local workspace");
		const target = { home, ...(entry ? { workspace: resolve(home, entry.workspace) } : {}) };
		return request.action === "skills.add"
			? addLocalSkill(request.source ?? "", target)
			: removeLocalSkill(request.id ?? "", target);
	}
	const services = inspectionServices(home, config, () => {});
	if (request.action === "models.list")
		return {
			source: "configured/native catalog; access not verified",
			models: services.models.getModels().map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				input: model.input,
			})),
		};
	const loaded = await loadPlugins(home, config, services);
	const agents = await loadAgents(home, config, loaded);
	if (request.action.startsWith("agents.") || request.action.startsWith("presets.")) {
		const presets = new Map([...loaded.presets, ...(await loadPresets(home))]);
		return manageObjects(home, request, {
			config,
			agents,
			presets,
			files: (candidate, id) => filesFor(home, candidate, loaded, id),
			validate: async (candidate, nextAgents, nextPresets) => {
				const errors = configurationErrors(candidate, nextAgents, loaded, services.models, nextPresets);
				let identityDb: Awaited<ReturnType<typeof openDatabase>> | undefined;
				try {
					await stat(join(home, ".yonder/state.db"));
					identityDb = await openDatabase(join(home, ".yonder/state.db"), true);
					const identityStore = await createStore(identityDb, undefined, true);
					for (const agent of nextAgents.values())
						if (!agent.archivedAt && !(await identityStore.identity().person(agent.owner)))
							errors.push(`${agent.id}/owner: unknown person ${agent.owner}`);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					for (const agent of nextAgents.values())
						if (!agent.archivedAt && !candidate.identity?.persons.some((p) => `person:${p.id}` === agent.owner))
							errors.push(`${agent.id}/owner: unknown person ${agent.owner}`);
				} finally {
					await identityDb?.close();
				}
				let sessions: SessionInfo[] = [];
				try {
					await stat(join(home, ".yonder/state.db"));
					sessions = (await offlineQuery(home, {
						method: "sessions.list",
						params: { filter: { open: true } },
					})) as SessionInfo[];
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				protectSessions(config, candidate, agents, nextAgents, presets, nextPresets, sessions, errors);
				if (errors.length) throw new Error(errors.join("; "));
			},
			scaffold: async (candidate, agent) => {
				await scaffoldWorkspace(
					filesFor(home, candidate, loaded, agent.id),
					[...new Set(Object.values(agent.profiles).flatMap((p) => resolveProfile(p, agent.defaults).contexts))],
					loaded.contexts,
				);
			},
		});
	}
	const selectedAgent = () => {
		const value = agents.get(request.agent ?? "main");
		if (!value) throw new Error(`Unknown agent: ${request.agent}`);
		return value;
	};
	if (request.action === "inspect") {
		const session = profileFor(home, config, selectedAgent(), request.profile);
		const { instructions: _instructions, ...profile } = session.resolved;
		return {
			source: "disk configuration; runtime acceptance not implied",
			agent: session.agent,
			profile: session.profile,
			configurationFile: join(session.cwd, "agent.yaml"),
			cwd: session.cwd,
			...profile,
			plugins: profile.plugins,
			tools: inspectToolCatalog(session, loaded.tools),
			registeredPluginTools: [...loaded.tools].flatMap(([plugin, tools]) =>
				tools.map((tool) => ({ plugin, name: tool.name, capabilities: tool.capabilities })),
			),
			...(running ? { runtimeLoaded: (running.info ?? []).map((item) => item.id) } : { runtimeLoaded: null }),
		};
	}
	if (request.action === "skills.show")
		return skillsFor(home, config, loaded, () => {}).show(
			profileFor(home, config, selectedAgent(), request.profile),
			request.id ?? "",
		);
	if (request.action === "plugins.list" || request.action === "plugins.show") {
		const presets = new Map([...loaded.presets, ...(await loadPresets(home))]);
		const result = (loaded.info ?? []).map((info) => ({
			...info,
			source: "configured; setup validated",
			runtimeLoaded: running ? (running.info ?? []).some((item) => item.id === info.id) : null,
			selectedBy: [
				...[...presets]
					.filter(
						([, preset]) =>
							resolveProfile(preset).plugins.includes(info.id) ||
							resolveProfile(preset).contexts.some((id) =>
								((info.contributes as { contexts?: string[] }).contexts ?? []).includes(id),
							),
					)
					.map(([id]) => `preset:${id}`),
				...[...agents.values()].flatMap((agent) =>
					Object.keys(agent.profiles)
						.filter((profile) => {
							const selected = resolveProfile(agent.profiles[profile]!, agent.defaults);
							return (
								selected.plugins.includes(info.id) ||
								selected.contexts.some((id) =>
									((info.contributes as { contexts?: string[] }).contexts ?? []).includes(id),
								)
							);
						})
						.map((profile) => `${agent.id}/${profile}`),
				),
			],
			instances: [
				...[...loaded.channels.keys()]
					.filter((id) =>
						((info.contributes as { channels?: string[] }).channels ?? []).includes(config.channels![id]!.type),
					)
					.map((id) => `channel:${id}`),
				...[...loaded.envs.keys()]
					.filter((id) => ((info.contributes as { envs?: string[] }).envs ?? []).includes(config.envs![id]!.type))
					.map((id) => `env:${id}`),
			],
		}));
		if (request.action === "plugins.list") return result;
		const found = result.find((item) => item.id === request.id);
		if (!found) throw new Error(`Plugin not configured: ${request.id}`);
		return found;
	}
	if (request.action !== "plugins.add" && request.action !== "plugins.remove")
		throw new Error(`Unknown management action: ${request.action}`);
	const file = join(home, "yonder.yaml"),
		unlock = await lockfile.lock(file);
	try {
		const original = await readFile(file, "utf8"),
			document = parseDocument(original),
			candidate = parseYonderConfig(original, file);
		if (request.action === "plugins.add") {
			if (!request.source) throw new Error("Plugin source required");
			await pluginDirectory(home, request.source);
			candidate.plugins = [...(candidate.plugins ?? []), { use: request.source }];
		} else {
			const found = loaded.info?.find((item) => item.id === request.id);
			if (!found) throw new Error(`Plugin not configured: ${request.id}`);
			candidate.plugins = (candidate.plugins ?? []).filter((item) => item.use !== found.use);
		}
		const next = await loadPlugins(
			home,
			candidate,
			inspectionServices(home, candidate, () => {}),
		);
		const nextAgents = await loadAgents(home, candidate, next),
			presets = await loadPresets(home);
		const errors = configurationErrors(
			candidate,
			nextAgents,
			next,
			services.models,
			new Map([...next.presets, ...presets]),
		);
		if (request.action === "plugins.remove") {
			let hasDatabase = false;
			try {
				hasDatabase = (await stat(join(home, ".yonder/state.db"))).isFile();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (hasDatabase)
				for (const session of (await offlineQuery(home, {
					method: "sessions.list",
					params: { filter: { open: true } },
				})) as SessionInfo[]) {
					const exists = session.agent
						? nextAgents.get(session.agent)?.profiles[session.profile]
						: presets.has(session.profile) || next.presets.has(session.profile);
					if (!exists) errors.push(`session ${session.id}: close before removing profile/preset ${session.profile}`);
				}
		}
		if (errors.length) throw new Error(errors.join("; "));
		document.set("plugins", candidate.plugins);
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, document.toString(), { flag: "wx", mode: 0o600 });
			await rename(temporary, file);
		} finally {
			await rm(temporary, { force: true });
		}
		return { configured: true, restartRequired: true, action: request.action, source: request.source ?? request.id };
	} finally {
		await unlock();
	}
}

function protectSessions(
	config: YonderConfig,
	candidate: YonderConfig,
	agents: Map<string, AgentConfig>,
	nextAgents: Map<string, AgentConfig>,
	presets: Map<string, Preset>,
	nextPresets: Map<string, Preset>,
	sessions: SessionInfo[],
	errors: string[],
) {
	for (const session of sessions) {
		if (session.agent) {
			const before = config.agents?.find((a) => a.id === session.agent),
				after = candidate.agents?.find((a) => a.id === session.agent);
			if (!nextAgents.get(session.agent)?.profiles[session.profile])
				errors.push(`session ${session.id}: close session before removing agent/profile ${session.profile}`);
			const previous = agents.get(session.agent),
				next = nextAgents.get(session.agent);
			const oldProfile = previous?.profiles[session.profile],
				newProfile = next?.profiles[session.profile];
			const envChanged =
				oldProfile &&
				newProfile &&
				resolveProfile(oldProfile, previous?.defaults, before?.env).env !==
					resolveProfile(newProfile, next?.defaults, after?.env).env;
			if (before?.workspace !== after?.workspace || before?.env !== after?.env || envChanged)
				errors.push(`session ${session.id}: close before changing workspace/env`);
		} else if (presets.has(session.profile) && !nextPresets.has(session.profile))
			errors.push(`session ${session.id}: close session before removing preset ${session.profile}`);
	}
	for (const id of agents.keys()) if (!nextAgents.has(id)) errors.push(`agent ${id}: archive instead of unregistering`);
}

function configurationErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	plugins: LoadedPlugins,
	models: Models,
	presets: Map<string, Preset>,
): string[] {
	const errors: string[] = [];
	const validateProfile = (name: string, selected: ReturnType<typeof resolveProfile>) => {
		const slash = selected.model.indexOf("/");
		if (!models.getModel(selected.model.slice(0, slash), selected.model.slice(slash + 1)))
			errors.push(`${name}: unknown model ${selected.model}`);
		if (selected.env !== "local" && !plugins.envs.has(selected.env))
			errors.push(`${name}: unknown environment ${selected.env}`);
		for (const id of selected.contexts) if (!plugins.contexts.has(id)) errors.push(`${name}: unknown context ${id}`);
		for (const id of selected.plugins) if (!plugins.tools.has(id)) errors.push(`${name}: unknown plugin ${id}`);
	};
	for (const agent of agents.values()) {
		if (agent.archivedAt) continue;

		for (const [name, profile] of Object.entries(agent.profiles)) {
			const selected = resolveProfile(
				profile,
				agent.defaults,
				config.agents?.find((item) => item.id === agent.id)?.env,
			);
			validateProfile(`${agent.id}/${name}`, selected);
		}
		for (const binding of agent.bindings) {
			const ids =
				binding.match.channel === undefined ? [...plugins.channels.keys(), "agent"] : [binding.match.channel].flat();
			const kinds = binding.match.kind === undefined ? [] : [binding.match.kind].flat();
			for (const id of ids) {
				const supported = id === "agent" ? ["agent"] : plugins.channels.get(id)?.kinds;
				if (!supported) {
					errors.push(`${agent.id}/${binding.id}: unknown channel ${id}`);
				}
			}
			for (const kind of kinds)
				if (!ids.some((id) => (id === "agent" ? ["agent"] : plugins.channels.get(id)?.kinds)?.includes(kind)))
					errors.push(`${agent.id}/${binding.id}: no selected channel declares kind ${kind}`);
		}
	}
	for (const [id, preset] of presets) validateProfile(`preset:${id}`, resolveProfile(preset));
	return errors;
}

export async function initHome(home: string, owner = "owner") {
	home = resolve(home);
	const directory = join(home, "agents/main");
	await mkdir(directory, { recursive: true });
	const config: YonderConfig = {
		schema: 1,
		plugins: [{ use: "@yonder/plugin-channel-cli" }, { use: "@yonder/plugin-context-files" }],
		channels: { cli: { type: "cli" } },
		envs: { local: { type: "local" } },
		agents: [{ id: "main", workspace: "./agents/main" }],
		identity: { persons: [{ id: owner, name: owner, accounts: ["acct:cli:local"] }] },
	};
	await writeFile(join(home, "yonder.yaml"), stringify(config), { flag: "wx" });
	await mkdir(join(home, "presets"), { recursive: true });
	await writeFile(
		join(home, "presets/default.yaml"),
		stringify({
			schema: 1,
			description: "独立任务 · Standalone task",
			model: "openai/gpt-6-luna",
			level: "standard",
			tools: { offer: ["*"] },
			plugins: [],
			contexts: [],
		}),
		{ flag: "wx" },
	);
	const agent: AgentConfig = {
		schema: 1,
		id: "main",
		name: "main",
		owner: `person:${owner}`,
		defaultProfile: "owner",
		defaults: { model: "openai/gpt-6-luna", contexts: ["agents-md", "user-md"], plugins: ["context-files"] },
		profiles: { owner: { level: "bypass", tools: { offer: ["*"] } } },
		bindings: [
			{
				id: "owner",
				match: { channel: "cli", kind: "dm", from: "owner" },
				session: "main",
				profile: "owner",
				stream: true,
			},
		],
	};
	await writeFile(join(directory, "agent.yaml"), stringify(agent), { flag: "wx" });
	const plugins = await loadPlugins(
		home,
		config,
		inspectionServices(home, config, () => {}),
	);
	await scaffoldWorkspace(filesFor(home, config, plugins, "main"), ["agents-md", "user-md"], plugins.contexts);
	return { home, agent: "main", model: "openai/gpt-6-luna" };
}

export async function inspectHome(home: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
	const warnings = ["exec 可运行任意程序；主机中的 yonder CLI 等同于管理权限。文件能力规则不构成沙箱。"];
	try {
		const config = await loadYonderConfig(home);
		const services = inspectionServices(home, config, (level, text) => {
			if (level !== "info") warnings.push(text);
		});
		const plugins = await loadPlugins(home, config, services);
		const agents = await loadAgents(home, config, plugins);
		const presets = await loadPresets(home);
		const errors = configurationErrors(
			config,
			agents,
			plugins,
			services.models,
			new Map([...plugins.presets, ...presets]),
		);
		const skills = skillsFor(home, config, plugins, () => {});
		for (const agent of agents.values())
			for (const profile of Object.keys(agent.profiles)) {
				const report = await skills.inspect(profileFor(home, config, agent, profile));
				warnings.push(...report.issues.map((issue) => `${issue.path}: ${issue.message}`));
				warnings.push(
					...report.skills
						.filter((skill) => skill.shadowed)
						.map((skill) => `${skill.name}: ${skill.source} shadowed by ${skill.shadowedBy}`),
				);
				if (report.estimatedTokens > 4000)
					warnings.push(
						`${agent.id}/${profile}: skill index exceeds 4000 estimated tokens (${report.estimatedTokens})`,
					);
			}
		return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)] };
	} catch (error) {
		return { ok: false, errors: [message(error)], warnings };
	}
}

export async function openKernel(home: string, options: { log?: KernelLog } = {}) {
	home = resolve(home);
	process.env.YONDER_HOME = home;
	const log = options.log ?? (() => {});
	const report = (error: unknown) => log("error", message(error));
	await mkdir(join(home, ".yonder"), { recursive: true });
	const unlock = await lockfile.lock(home, {
		realpath: false,
		lockfilePath: join(home, ".yonder/lock"),
	});
	let runtime: Runtime | undefined;
	let plugins: LoadedPlugins | undefined;
	let watcher: Awaited<ReturnType<typeof watchConfig>> | undefined;
	let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		watcher?.close();
		try {
			await plugins?.stop();
		} finally {
			try {
				if (runtime) await runtime.close();
				else await db?.close();
			} finally {
				await unlock();
			}
		}
	};
	try {
		const config = await loadYonderConfig(home);
		db = await openDatabase(join(home, ".yonder/state.db"));
		const terminalEnds = new Map<
			string,
			Set<(update: import("../runtime/index.js").TerminalUpdate) => Promise<void>>
		>();
		const agents = new Map<string, AgentConfig>();
		const store = await createStore(
			db,
			(id) => agents.get(id)?.owner,
			false,
			(event) => {
				void plugins?.observe(event).catch(report);
				if (event.type === "run.end") {
					const id = String((event.data as { session?: string }).session ?? "");
					for (const send of terminalEnds.get(id) ?? [])
						void send({
							type: "end",
							session: id,
							...((event.data as { runId?: string }).runId ? { runId: (event.data as { runId: string }).runId } : {}),
							eventIds: (event.data as { inputs?: string[] }).inputs ?? [],
							event,
						}).catch(report);
				}
			},
		);
		const realRuntime = () => {
			if (!runtime) throw new Error("Runtime is not ready");
			return runtime;
		};
		const observeSession = async (id: string, send: (update: import("@yonder/sdk").SessionUpdate) => Promise<void>) => {
			if (!(await store.sessions.get(id))) throw new Error(`Unknown session: ${id}`);
			const listeners = terminalEnds.get(id) ?? new Set();
			listeners.add(send);
			terminalEnds.set(id, listeners);
			try {
				const dispose = await realRuntime().observe(id, send);
				return async () => {
					listeners.delete(send);
					if (!listeners.size) terminalEnds.delete(id);
					await dispose();
				};
			} catch (error) {
				listeners.delete(send);
				if (!listeners.size) terminalEnds.delete(id);
				throw error;
			}
		};
		let sessions: ReturnType<typeof createSessions>;
		let router: ReturnType<typeof createRouter>;
		let delivery: ReturnType<typeof createDelivery>;
		const resolveExecutionOwner = async (owner: { session: string; agent: string | null; profile: string }) => {
			const session = await store.sessions.get(owner.session);
			if (!session || session.agent !== owner.agent || session.profile !== owner.profile)
				throw new Error("Execution owner does not match the stored session");
			if (owner.agent && agents.get(owner.agent)?.archivedAt) throw new Error(`Agent archived: ${owner.agent}`);
			return sessions.resolveSession(owner.session);
		};
		const services: KernelServices = {
			...credentialsAndModels(home, config),
			log: {
				info: (m, d) => log("info", m, d),
				warn: (m, d) => log("warn", m, d),
				error: (m, d) => log("error", m, d),
			},
			events: {
				emit: (event) => router.emit(event),
				ask: (event) => router.ask(event),
				query: (query) => store.events.query(query),
				on: unavailable,
			},
			messages: {
				send: (request, pluginId, ctx) =>
					ctx ? delivery.sendTool(ctx, request) : delivery.sendPlugin(pluginId, request),
			},
			sessions: {
				notify: (id: string, input: { event: string; text: string }, pluginId?: string) =>
					sessions.notifyFrom(id, input, pluginId ? `plugin:${pluginId}` : "system:yonder"),
				list: (filter) => sessions.api.list(filter),
				get: (id) => sessions.api.get(id),
				open: (req) => sessions.api.open(req),
				submit: (id, input, opts, pluginId) =>
					pluginId ? sessions.submitFrom(id, input, opts, `plugin:${pluginId}`) : sessions.api.submit(id, input, opts),
				abort: (id) => sessions.api.abort(id),
				close: (id) => sessions.api.close(id),
				transcript: (id, range) => sessions.api.transcript(id, range),
				observe: observeSession,
			},
			execution: {
				resolve: async (owner) => ({ capabilities: [...(await resolveExecutionOwner(owner)).resolved.capabilities] }),
				run: async (request) => {
					const active = await resolveExecutionOwner(request.owner);
					if (!active.resolved.capabilities.includes("exec") || !request.capabilities.includes("exec"))
						throw new Error("Command execution requires current and creator exec capability");
					return realRuntime().executeCommand(active, {
						command: request.command,
						...(request.cwd ? { cwd: request.cwd } : {}),
						...(request.signal ? { signal: request.signal } : {}),
					});
				},
			},
			identity: store.identity(),
			services: { resolve: (capability) => realRuntime().resolveService(capability) },
		};
		plugins = await loadPlugins(home, config, services);
		const loaded = plugins;
		for (const [id, agent] of await loadAgents(home, config, loaded)) agents.set(id, agent);
		const homePresets = await loadPresets(home);
		const errors = configurationErrors(
			config,
			agents,
			loaded,
			services.models,
			new Map([...loaded.presets, ...homePresets]),
		);
		if (errors.length) throw new Error(errors.join("; "));
		const scaffoldAgent = (agent: AgentConfig, candidate = config) =>
			scaffoldWorkspace(
				filesFor(home, candidate, loaded, agent.id),
				[
					...new Set(
						Object.values(agent.profiles).flatMap((profile) => resolveProfile(profile, agent.defaults).contexts),
					),
				],
				loaded.contexts,
			);
		for (const agent of agents.values()) await scaffoldAgent(agent);
		for (const person of config.identity?.persons ?? []) {
			if (await store.identity().person(`person:${person.id}`)) continue;
			await store.identity().createPerson(person);
			for (const account of person.accounts ?? [])
				if (!(await store.identity().account(account))) await store.identity().link(account, `person:${person.id}`);
		}
		const skills = skillsFor(home, config, loaded, log);
		const promptOptions: PromptOptions = {
			home,
			version: packageVersion,
			contexts: loaded.contexts,
			workspace: (session, signal) => filesFor(home, config, loaded, session.agent ?? "", signal),
			identity: store.identity(),
			models: services.models,
			setVersion: store.sessions.setVersion,
			skillIndex: skills.index,
		};
		const completeRun = async (id: string, run: import("../runtime/index.js").RuntimeRun) => {
			const session = await store.sessions.get(id);
			if (!session) throw new Error(`Missing runtime session: ${id}`);
			const completion = await delivery.onRun(session, run, []);
			await store.events.recordRun(completion.ending);
			completion.deliver();
			await router.finishRun(session, run);
			if (
				!(await realRuntime().hasBackgroundWork(id)) &&
				(session.mode === "ephemeral" ||
					(session.mode === "task" && (await realRuntime().sessionState(id))?.close !== "manual"))
			)
				await sessions.closeSession(id, run.status === "done" ? "completed" : run.status);
		};
		sessions = createSessions({
			store,
			agents,
			homePresets,
			pluginPresets: loaded.presets,
			home,
			config,
			version: packageVersion,
			runtime: realRuntime,
			onRun: (session, run) => completeRun(session.id, run),
			onReport: report,
		});
		delivery = createDelivery({
			store,
			agents,
			channels: loaded.channels,
			runtime: realRuntime,
			sessions,
			onReport: report,
		});
		router = createRouter({
			store,
			sessions,
			runtime: realRuntime,
			agents,
			onCommand: (session, event) => {
				const channel = event.conv?.split(":")[1];
				if (!channel || config.channels?.[channel]?.type !== "feishu") return Promise.resolve(undefined);
				return runChannelCommand(session, event, { store, sessions, delivery, skills: skills.inspect });
			},
			onStart: delivery.onStart,
			onRun: (session, run) => completeRun(session.id, run),
			onReport: report,
		});
		const tools = createCoreTools({
			store,
			agents,
			sessions,
			runtime: realRuntime,
			delivery,
			ask: router.ask,
			getPreset: sessions.getPreset,
			presets: () => [...new Map([...loaded.presets, ...homePresets]).values()],
		});
		tools.push(createSkillTool(skills, (id) => realRuntime().sessionConfig(id)));
		runtime = await Runtime.open({
			db,
			home,
			config,
			plugins: [...loaded.tools].map(([id, tools]) => ({ id, tools, hooks: loaded.hooks.get(id) ?? [] })),
			tools,
			envs: loaded.envs,
			readEvent: store.events.get,
			prepareInput: async (id, event, config, wake, signal) => {
				const row = await store.sessions.get(id);
				if (!row) throw new Error(`Unknown session: ${id}`);
				return prepareInput(row, config, event, wake, { ...promptOptions, ...(signal ? { signal } : {}) });
			},
			onAdmitted: async (id, input) => {
				if (input.version) await store.sessions.setVersion(id, input.version);
			},
			onRun: completeRun,
			onBackground: async (id, input) => {
				const row = await store.sessions.get(id);
				const origin = input.origin;
				const msgId = origin ? sourceMessage(origin) : undefined;
				const text = `[Background ${input.id} ${input.name} ${input.result.isError ? "failed" : "completed"}]\n${input.result.text.slice(-12000)}\nFull result: process status ${input.id}. Continue the original task if needed; do not repeat already completed work.`;
				const event = await store.events.record(
					{
						type: "runtime.tool-result",
						...(origin ? { parent: origin.id } : {}),
						...(origin?.conv ? { conv: origin.conv } : {}),
						data: {
							session: id,
							job: input.id,
							...(msgId ? { msgId } : {}),
							tool: input.name,
							text,
							waiting: false,
							status: input.result.isError ? "error" : "done",
						},
					},
					origin?.routes?.filter((route) => route.session === id) ?? [],
				);
				if (!row || row.closed) return;
				const onOutput = delivery.onStart(row, event, false);
				void realRuntime()
					.submit(id, {
						text,
						event,
						wake: "run",
						busy: "steer",
						requestId: `background:${input.id}`,
						...(onOutput ? { onOutput } : {}),
						attachments: input.result.attachments ?? [],
					})
					.catch(report);
			},
			onWarning: async (id, input) => {
				const row = await store.sessions.get(id);
				const event = await store.events.record({
					type: "runtime.warning",
					data: { session: id, kind: input.kind, text: input.text },
				});
				for (const target of [id, ...(row?.parent ? [row.parent] : [])]) {
					const parent = await store.sessions.get(target);
					if (!parent || parent.closed) continue;
					const text = target === id ? input.text : `Subtask session ${id}: ${input.text}`;
					await realRuntime().notify(target, { event: event.id, from: "system:yonder", text });
					await realRuntime().writeNote(target, `warning:${event.id}:${target}`, text);
				}
			},
			resolveSession: async (id) => {
				const session = await sessions.resolveSession(id);
				const protectedFiles = session.resolved.contexts
					.flatMap((id) => loaded.contexts.get(id)?.files ?? [])
					.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : []));
				return { ...session, protectedFiles };
			},
			sections: (session, signal) => systemSections(session, { ...promptOptions, ...(signal ? { signal } : {}) }),
			onReport: report,
		});
		const validateCandidate = async (
			candidateConfig: YonderConfig,
			candidateAgents: Map<string, AgentConfig>,
			candidatePresets: Map<string, Preset>,
		) => {
			const errors = configurationErrors(
				candidateConfig,
				candidateAgents,
				loaded,
				services.models,
				new Map([...loaded.presets, ...candidatePresets]),
			);
			for (const agent of candidateAgents.values())
				if (!agent.archivedAt && !(await store.identity().person(agent.owner)))
					errors.push(`${agent.id}/owner: unknown person ${agent.owner}`);
			const open = await store.sessions.list({ open: true });
			protectSessions(config, candidateConfig, agents, candidateAgents, homePresets, candidatePresets, open, errors);
			for (const [id, next] of candidateAgents)
				if (next.archivedAt && !agents.get(id)?.archivedAt) {
					if (id === "main") errors.push("main: default daily entry cannot be archived");
				}
			if (errors.length) throw new Error(errors.join("; "));
		};
		let pendingRestart = "";
		watcher = await watchConfig({
			home,
			agents,
			presets: homePresets,
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
				for (const agent of nextAgents.values())
					if (!agent.archivedAt) await scaffoldAgent(agent, nextConfig ?? config);
			},
			publish: (candidate) => {
				config.agents = candidate.agents ?? [];
			},
			onReload: async (event) => {
				await store.events.record(event);
			},
		});
		await delivery.recover();
		await runtime.recover();
		const pendingInputs = [...(await router.recover()), ...(await sessions.recover())];
		runtime.resume();
		for (const submit of pendingInputs) submit();
		await loaded.start(router);
		delivery.start();
		log("info", "Yonder Harness started", { home, version: packageVersion });
		let managementQueue: Promise<unknown> = Promise.resolve();
		return {
			sessions: { ...sessions.api, observe: observeSession },
			releaseResult: (data: UpdateResult) => {
				if (resolve(data.home) !== home) throw new Error("Update result belongs to another home");
				return router.emit(updateResultEvent(data));
			},
			notify: (id: string, input: { event: string; text: string }) => sessions.notifyFrom(id, input, "system:cli"),
			events: { query: store.events.query },
			identity: store.identity(),
			management: async (request: ManagementRequest) => {
				if (request.action.startsWith("agents.") || request.action.startsWith("presets.")) {
					const result = managementQueue.then(() =>
						manageObjects(home, request, {
							config,
							agents,
							presets: new Map([...loaded.presets, ...homePresets]),
							files: (candidate, id) => filesFor(home, candidate, loaded, id),
							validate: validateCandidate,
							scaffold: async (candidate, agent) => {
								await scaffoldAgent(agent, candidate);
							},
							reload: () => watcher!.reload(),
						}),
					);
					managementQueue = result.catch(() => {});
					return result;
				}
				const result = await manageHome(home, request, loaded);
				if (request.action !== "inspect") return result;
				const agent = agents.get(request.agent ?? "main");
				if (!agent) throw new Error("Unknown agent");
				return {
					...(result as object),
					tools: (result as { tools: unknown }).tools,
					runningSnapshots: (await store.sessions.list({ agent: agent.id, open: true })).flatMap((session) => {
						const snapshot = realRuntime().currentConfig(session.id);
						return snapshot
							? [
									{
										session: session.id,
										profile: snapshot.profile,
										model: snapshot.resolved.model,
										capabilities: snapshot.resolved.capabilities,
									},
								]
							: [];
					}),
				};
			},
			close,
			terminal: {
				presets: () =>
					[...new Map([...loaded.presets, ...homePresets]).values()].map((preset) => {
						const profile = resolveProfile(preset),
							slash = profile.model.indexOf("/");
						const model = services.models.getModel(profile.model.slice(0, slash), profile.model.slice(slash + 1));
						return {
							id: preset.id,
							description: preset.description,
							...profile,
							...(model
								? {
										modelInfo: {
											id: model.id,
											provider: model.provider,
											contextWindow: model.contextWindow,
											reasoning: model.reasoning,
										},
									}
								: {}),
						};
					}),
				channels: () =>
					Object.entries(config.channels ?? {})
						.filter(([, channel]) => channel.type === "cli")
						.map(([id]) => ({
							id,
							agents: [...agents.values()].flatMap((agent) => {
								const bindings = agent.archivedAt
									? []
									: agent.bindings.filter(
											(binding) => !binding.match.channel || [binding.match.channel].flat().includes(id),
										);
								return bindings.length
									? [
											{
												id: agent.id,
												name: agent.name,
												work: agent.work,
												main: bindings.some((binding) => binding.session === "main"),
											},
										]
									: [];
							}),
						})),
				async list() {
					return Promise.all(
						(await sessions.api.list({})).map(async (session) => {
							const messages = await realRuntime().terminalHistory(session.id);
							const texts = messages.map((message) =>
								typeof message.content === "string"
									? message.content
									: message.content
											.filter((block) => block.type === "text")
											.map((block) => block.text)
											.join("\n"),
							);
							const state = await realRuntime().sessionState(session.id);
							return {
								...session,
								agentName: session.agent ? agents.get(session.agent)?.name : undefined,
								agentWork: session.agent ? agents.get(session.agent)?.work : undefined,
								cwd: state?.cwd ?? home,
								messageCount: messages.length,
								firstMessage: texts[0]?.replace(/^<turn\b[\s\S]*?<\/turn>\s*/, "") ?? "",
								allMessagesText: texts.join("\n"),
								modified: messages.at(-1)?.timestamp
									? new Date(messages.at(-1)?.timestamp ?? 0).toISOString()
									: session.opened,
							};
						}),
					);
				},
				submit: sessions.submitAccepted,
				async queued(id: string, withdraw = false) {
					return Promise.all(
						(await realRuntime().queued(id, withdraw)).map(async (item) => {
							const event = item.event ? await store.events.get(item.event) : undefined;
							const text = (event?.data as { text?: string } | undefined)?.text;
							return { ...item, text: text ?? item.text };
						}),
					);
				},
				async info(id: string) {
					const session = await sessions.api.get(id);
					if (!session) throw new Error(`Unknown session: ${id}`);
					const active = await realRuntime().sessionConfig(id),
						ref = active.resolved.model,
						slash = ref.indexOf("/");
					const model = services.models.getModel(ref.slice(0, slash), ref.slice(slash + 1));
					return {
						session,
						agentName: session.agent ? agents.get(session.agent)?.name : undefined,
						agentWork: session.agent ? agents.get(session.agent)?.work : undefined,
						config: active,
						model: model
							? {
									id: model.id,
									provider: model.provider,
									contextWindow: model.contextWindow,
									reasoning: model.reasoning,
								}
							: undefined,
						state: await realRuntime().sessionState(id),
						usage: await realRuntime().usage(id),
						skills: await skills.inspect(active),
					};
				},
				observe: observeSession,
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}

export async function offlineQuery(home: string, request: { method: string; params?: unknown }): Promise<unknown> {
	if (request.method === "management") return manageHome(home, request.params as ManagementRequest);
	const db = await openDatabase(join(home, ".yonder/state.db"), true);
	try {
		const store = await createStore(db, undefined, true);
		const params = (request.params ?? {}) as {
			filter?: Parameters<SessionsAPI["list"]>[0];
			query?: EventQuery;
			id?: string;
			ref?: string;
		};
		if (request.method === "sessions.list") return store.sessions.list(params.filter ?? {});
		if (request.method === "sessions.show") {
			const session = await store.sessions.get(params.id ?? "");
			if (!session) throw new Error(`Unknown session: ${params.id}`);
			const { readTranscript } = await import("../runtime/index.js");
			return { session, transcript: await readTranscript(db, session.id) };
		}
		if (request.method === "events.query") return store.events.query(params.query ?? {});
		if (request.method === "identity.lookup") return store.identity().lookup(params.ref ?? "");
		throw new Error("该操作需要先运行 yonder start");
	} finally {
		await db.close();
	}
}

export async function loginProvider(home: string, provider: string, interaction: Parameters<Models["login"]>[2]) {
	const { loginProvider: login } = await import("../runtime/index.js");
	await login(home, await loadYonderConfig(home), provider, interaction);
}
export type LoginInteraction = Parameters<Models["login"]>[2];
export type Kernel = Awaited<ReturnType<typeof openKernel>>;
