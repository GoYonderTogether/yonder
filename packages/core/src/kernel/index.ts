import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Models, Preset } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import {
	type AgentConfig,
	loadPresets,
	loadYonderConfig,
	resolveProfile,
	watchConfig,
	type YonderConfig,
} from "../config/index.js";
import { createDelivery } from "../delivery/index.js";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { type PromptOptions, prepareInput, scaffoldWorkspace, systemSections } from "../prompt/index.js";
import { type UpdateResult, updateResultEvent } from "../release/result.js";
import { runChannelCommand } from "../routing/commands.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";
import { createSkillTool } from "../tools/skill-view.js";
import { backgroundHandlers } from "./background.js";
import { configurationErrors, protectSessions } from "./home.js";
import { type ManagementRequest, manageHome } from "./home-management.js";
import { manageObjects } from "./management.js";
import { terminalApi } from "./terminal.js";
import {
	credentialsAndModels,
	filesFor,
	type KernelLog,
	loadAgents,
	message,
	skillsFor,
	unavailable,
} from "./workspace.js";

export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
export { initHome, inspectHome } from "./home.js";
export { type ManagementRequest, manageHome, offlineQuery } from "./home-management.js";
export type { KernelLog } from "./workspace.js";
export { inspectSkills } from "./workspace.js";

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
			...backgroundHandlers({ store, runtime: realRuntime, delivery, report }),
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
			terminal: terminalApi({
				home,
				config,
				agents,
				loaded,
				homePresets,
				models: services.models,
				sessions,
				store,
				runtime: realRuntime,
				skills,
				observe: observeSession,
			}),
		};
	} catch (error) {
		await close();
		throw error;
	}
}

export async function loginProvider(home: string, provider: string, interaction: Parameters<Models["login"]>[2]) {
	const { loginProvider: login } = await import("../runtime/index.js");
	await login(home, await loadYonderConfig(home), provider, interaction);
}
export type LoginInteraction = Parameters<Models["login"]>[2];
export type Kernel = Awaited<ReturnType<typeof openKernel>>;
