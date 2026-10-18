import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EventQuery, Models, SessionInfo, SessionsAPI, YEvent } from "@yonder/sdk";
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
import { FileCredentials, localEnvironment, Runtime, workspaceFiles } from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";

export type KernelLog = (level: "info" | "warn" | "error", message: string, data?: object) => void;
export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const unavailable = (): never => {
	throw new Error("Harness service is unavailable before start");
};

function credentialsAndModels(home: string, config: YonderConfig) {
	const credentials = new FileCredentials(resolve(home, config.credentials ?? ".yonder/auth.json"));
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

function filesFor(home: string, config: YonderConfig, plugins: LoadedPlugins, agent: string): WorkspaceFiles {
	const entry = config.agents?.find((item) => item.id === agent);
	if (!entry) throw new Error(`Unknown agent: ${agent}`);
	const cwd = resolve(home, entry.workspace);
	if (!entry.env || entry.env === "local") return workspaceFiles(localEnvironment(cwd));
	const environment = plugins.envs.get(entry.env);
	if (!environment) throw new Error(`Unknown workspace environment: ${entry.env}`);
	const files = workspaceFiles(environment);
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

function configurationErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	plugins: LoadedPlugins,
	models: Models,
): string[] {
	const errors: string[] = [];
	for (const agent of agents.values()) {
		for (const [name, profile] of Object.entries(agent.profiles)) {
			const selected = resolveProfile(
				profile,
				agent.defaults,
				config.agents?.find((item) => item.id === agent.id)?.env,
			);
			const slash = selected.model.indexOf("/");
			if (!models.getModel(selected.model.slice(0, slash), selected.model.slice(slash + 1)))
				errors.push(`${agent.id}/${name}: unknown model ${selected.model}`);
			if (selected.env !== "local" && !plugins.envs.has(selected.env))
				errors.push(`${agent.id}/${name}: unknown environment ${selected.env}`);
			for (const id of selected.contexts)
				if (!plugins.contexts.has(id)) errors.push(`${agent.id}/${name}: unknown context ${id}`);
			for (const id of selected.plugins)
				if (!plugins.tools.has(id)) errors.push(`${agent.id}/${name}: unknown plugin ${id}`);
		}
		for (const binding of agent.bindings) {
			const ids =
				binding.match.channel === undefined ? [...plugins.channels.keys(), "agent"] : [binding.match.channel].flat();
			const kinds = binding.match.kind === undefined ? [] : [binding.match.kind].flat();
			for (const id of ids) {
				const supported = id === "agent" ? ["agent"] : plugins.channels.get(id)?.kinds;
				if (!supported) {
					errors.push(`${agent.id}/${binding.id}: unknown channel ${id}`);
					continue;
				}
				for (const kind of kinds)
					if (!supported.includes(kind))
						errors.push(`${agent.id}/${binding.id}: channel ${id} does not declare kind ${kind}`);
			}
		}
	}
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
		await loadPresets(home);
		const errors = configurationErrors(config, agents, plugins, services.models);
		return { ok: errors.length === 0, errors, warnings };
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
		onCompromised: report,
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
		const errors = configurationErrors(config, agents, loaded, services.models);
		if (errors.length) throw new Error(errors.join("; "));
		for (const agent of agents.values()) {
			const selected = [
				...new Set(
					Object.values(agent.profiles).flatMap((profile) => resolveProfile(profile, agent.defaults).contexts),
				),
			];
			await scaffoldWorkspace(filesFor(home, config, loaded, agent.id), selected, loaded.contexts);
		}
		for (const person of config.identity?.persons ?? []) {
			await store.identity().createPerson(person);
			for (const account of person.accounts ?? [])
				if ((await store.identity().account(account))?.person !== `person:${person.id}`)
					await store.identity().link(account, `person:${person.id}`);
		}
		const homePresets = await loadPresets(home);
		const promptOptions: PromptOptions = {
			home,
			version: packageVersion,
			contexts: loaded.contexts,
			workspace: (session) => filesFor(home, config, loaded, session.agent ?? ""),
			identity: store.identity(),
			models: services.models,
			setVersion: store.sessions.setVersion,
		};
		const input = async (row: SessionInfo, event: YEvent, wake: "run" | "write" = "run") =>
			prepareInput(row, await sessions.resolveSession(row.id), event, wake, promptOptions);
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
			onRun: (...args) => delivery.onRun(...args),
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
			onRun: delivery.onRun,
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
		runtime = await Runtime.open({
			db,
			home,
			config,
			plugins: [...loaded.tools].map(([id, tools]) => ({ id, tools, hooks: loaded.hooks.get(id) ?? [] })),
			tools,
			envs: loaded.envs,
			resolveSession: async (id) => {
				const session = await sessions.resolveSession(id);
				const protectedFiles = session.resolved.contexts
					.flatMap((id) => loaded.contexts.get(id)?.files ?? [])
					.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : []));
				return { ...session, protectedFiles };
			},
			sections: (session) => systemSections(session, promptOptions),
			onReport: report,
		});
		watcher = await watchConfig({
			home,
			agents,
			presets: homePresets,
			workspaceFiles: (id) => filesFor(home, config, loaded, id),
			onReload: async (event) => {
				await store.events.record(event);
			},
		});
		await loaded.start(router);
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
