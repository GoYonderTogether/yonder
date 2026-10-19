import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EventQuery, Models, Preset, SessionInfo, SessionsAPI, YEvent } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { stringify } from "yaml";
import {
	type AgentConfig,
	loadAgentConfig,
	loadPresets,
	loadYonderConfig,
	resolveProfile,
	type WorkspaceFiles,
	watchConfig,
	type YonderConfig,
} from "../config/index.js";
import { createDelivery } from "../delivery/index.js";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { type PromptOptions, prepareInput, scaffoldWorkspace, systemSections } from "../prompt/index.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import {
	credentialPath,
	FileCredentials,
	localEnvironment,
	Runtime,
	type RuntimeSessionConfig,
	workspaceFiles,
} from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { createSessions } from "../sessions/index.js";
import { createSkills } from "../skills/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";
import { createSkillTool } from "../tools/skill-view.js";

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
		services: { resolve: unavailable },
		sessions: {
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
		agents.set(entry.id, await loadAgentConfig(filesFor(home, config, plugins, entry.id), entry.id));
	}
	return agents;
}

function skillsFor(home: string, config: YonderConfig, plugins: LoadedPlugins, log: KernelLog) {
	return createSkills({
		home,
		pluginDirs: plugins.skillDirs,
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
		const agents = new Map<string, AgentConfig>();
		const store = await createStore(
			db,
			(id) => agents.get(id)?.owner,
			false,
			(event) => {
				void plugins?.observe(event).catch(report);
			},
		);
		const realRuntime = () => {
			if (!runtime) throw new Error("Runtime is not ready");
			return runtime;
		};
		let sessions: ReturnType<typeof createSessions>;
		let router: ReturnType<typeof createRouter>;
		let delivery: ReturnType<typeof createDelivery>;
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
			messages: { send: (request, pluginId) => delivery.sendPlugin(pluginId, request) },
			sessions: {
				list: (filter) => sessions.api.list(filter),
				get: (id) => sessions.api.get(id),
				open: (req) => sessions.api.open(req),
				submit: (id, input, opts) => sessions.api.submit(id, input, opts),
				abort: (id) => sessions.api.abort(id),
				close: (id) => sessions.api.close(id),
				transcript: (id, range) => sessions.api.transcript(id, range),
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
		const scaffoldAgent = (agent: AgentConfig) =>
			scaffoldWorkspace(
				filesFor(home, config, loaded, agent.id),
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
		const input = async (row: SessionInfo, event: YEvent, wake: "run" | "write" = "run") =>
			prepareInput(row, await sessions.resolveSession(row.id), event, wake, promptOptions);
		const completeRun = async (id: string, run: import("../runtime/index.js").RuntimeRun) => {
			const session = await store.sessions.get(id);
			if (!session) throw new Error(`Missing runtime session: ${id}`);
			await delivery.onRun(session, run, []);
			await router.finishRun(session, run);
			if (session.mode === "ephemeral" || session.mode === "task")
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
			prepareInput: input,
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
			prepareInput: input,
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
			prepareInput: input,
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
			onAdmitted: async (id, input) => {
				if (input.version) await store.sessions.setVersion(id, input.version);
			},
			onRun: completeRun,
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
		watcher = await watchConfig({
			home,
			agents,
			presets: homePresets,
			workspaceFiles: (id) => filesFor(home, config, loaded, id),
			validate: async (candidateAgents, candidatePresets) => {
				const errors = configurationErrors(
					config,
					candidateAgents,
					loaded,
					services.models,
					new Map([...loaded.presets, ...candidatePresets]),
				);
				for (const session of await store.sessions.list({ open: true })) {
					const exists = session.agent
						? candidateAgents.get(session.agent)?.profiles[session.profile]
						: homePresets.has(session.profile)
							? candidatePresets.has(session.profile)
							: loaded.presets.has(session.profile);
					if (!exists)
						errors.push(`session ${session.id}: close session before removing profile/preset ${session.profile}`);
				}
				if (errors.length) throw new Error(errors.join("; "));
				for (const agent of candidateAgents.values()) await scaffoldAgent(agent);
			},
			onReload: async (event) => {
				await store.events.record(event);
			},
		});
		await delivery.recover();
		await runtime.recover();
		await router.recover();
		await sessions.recover();
		runtime.resume();
		await loaded.start(router);
		delivery.start();
		log("info", "Yonder Harness started", { home, version: packageVersion });
		return { sessions: sessions.api, events: { query: store.events.query }, identity: store.identity(), close };
	} catch (error) {
		await close();
		throw error;
	}
}

export async function offlineQuery(home: string, request: { method: string; params?: unknown }): Promise<unknown> {
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
