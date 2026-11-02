import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createBot } from "@yonder/bot-core";
import type { createDelivery } from "@yonder/bot-core/delivery/index";
import type { outboundQueue } from "@yonder/bot-core/delivery/outbound";
import { createPermissions } from "@yonder/bot-core/permissions";
import { prepareInput } from "@yonder/bot-core/prompt/index";
import type { createRouter } from "@yonder/bot-core/routing/index";
import { checkBudget } from "@yonder/bot-core/sessions/budget";
import type { createSessions } from "@yonder/bot-core/sessions/index";
import { builtinViews } from "@yonder/bot-core/views/builtin";
import { shippedChannelsFor } from "@yonder/local-host/bundles";
import type { AgentConfig, YonderConfig } from "@yonder/local-host/config/index";
import { lockHome } from "@yonder/local-host/control/home-lock";
import { createKernelWorkHost } from "@yonder/local-host/control/work-stream";
import { backgroundHandlers } from "@yonder/local-host/kernel/background";
import { createBots } from "@yonder/local-host/kernel/bots";
import { migrateCardVisitor } from "@yonder/local-host/kernel/card-visitor";
import { createChannelLogin } from "@yonder/local-host/kernel/channel-login";
import { configRuntimeSections } from "@yonder/local-host/kernel/config-facts";
import {
	loadHomeConfig,
	loadHomeSources,
	scaffoldAgentWorkspace,
	seedIdentities,
} from "@yonder/local-host/kernel/config-sources";
import { watchAgents } from "@yonder/local-host/kernel/config-watch";
import { kernelPromptOptions, kernelTools } from "@yonder/local-host/kernel/conversation";
import { deviceOperation } from "@yonder/local-host/kernel/device-operation";
import { configurationErrors, protectSessions } from "@yonder/local-host/kernel/home";
import { type ManagementRequest, manageHome } from "@yonder/local-host/kernel/home-management";
import { createNotificationPrefs } from "@yonder/local-host/kernel/notifications";
import { createObservability } from "@yonder/local-host/kernel/observability";
import {
	observedRuntimeEvents,
	sessionObserver,
	type TerminalSends,
	terminalUpdates,
} from "@yonder/local-host/kernel/observation-events";
import { pluginAgentManagement } from "@yonder/local-host/kernel/plugin-bindings";
import { quotaWire } from "@yonder/local-host/kernel/quota-wire";
import { resumeRecovered } from "@yonder/local-host/kernel/recovery";
import { createRunCompletion } from "@yonder/local-host/kernel/run-completion";
import { createKernelServices } from "@yonder/local-host/kernel/services-wiring";
import { createSocial, createSocialSupport, socialTarget } from "@yonder/local-host/kernel/social";
import { terminalApi } from "@yonder/local-host/kernel/terminal";
import { type KernelOptions, ticks } from "@yonder/local-host/kernel/tick";
import { createWorkbenchOptions } from "@yonder/local-host/kernel/workbench-options";
import { credentialsAndModels, skillsFor, sourceFor } from "@yonder/local-host/kernel/workspace";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "@yonder/local-host/plugins/index";
import { type UpdateResult, updateResultEvent } from "@yonder/local-host/release/result";
import { createStore } from "@yonder/local-host/store/index";
import { noEnvironment } from "@yonder/runtime-adapter";
import type { Runtime } from "@yonder/runtime-adapter/node";
import { openNodeRuntime } from "@yonder/runtime-adapter/node";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db.js";
import type { Preset, TriggerIO } from "@yonder/sdk";
import { createFilePluginStorage } from "@yonder/sdk/node-storage";
import { createTriggerScheduler } from "@yonder/sdk/trigger-scheduler";
import { pluginDataPath, resolvePlugins } from "../plugins/index.js";
export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
export { migrateCardVisitor } from "@yonder/local-host/kernel/card-visitor";
export { initHome, inspectHome } from "@yonder/local-host/kernel/home";
export { type ManagementRequest, manageHome, offlineQuery } from "@yonder/local-host/kernel/home-management";
export { inspectSkills, type KernelLog } from "@yonder/local-host/kernel/workspace";
export async function openKernel(home: string, options: KernelOptions = {}) {
	home = resolve(home);
	process.env.YONDER_HOME = home;
	const log = options.log ?? (() => {});
	const observability = createObservability({ home, log, db: () => db });
	await mkdir(join(home, ".yonder"), { recursive: true });
	const unlock = await lockHome(home);
	let runtime: Runtime | undefined;
	let plugins: LoadedPlugins | undefined;
	let watcher: Awaited<ReturnType<typeof watchAgents>> | undefined;
	let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
	let stopDelivery: (() => Promise<void>) | undefined;
	let stopMaintenance: (() => Promise<void>) | undefined;
	let stopScheduling: (() => Promise<void>) | undefined;
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		watcher?.close();
		await stopMaintenance?.();
		await stopDelivery?.();
		try {
			await plugins?.stop();
		} finally {
			try {
				if (runtime) await runtime.close();
				else await db?.close();
			} finally {
				await stopScheduling?.();
				observability.stop();
				await unlock();
			}
		}
	};
	try {
		const { config, revisions: initialRevisions } = await loadHomeConfig(home);

		db = await openDatabase(join(home, ".yonder/state.db"));
		observability.startRetention();
		const terminalEnds: TerminalSends = new Map();
		const forwardUpdate = terminalUpdates(terminalEnds, observability.report);
		const agents = new Map<string, AgentConfig>();
		const store = await createStore(
			db,
			(id) => agents.get(id)?.owner,
			false,
			(event) => {
				void plugins?.observe(event).catch(observability.report);
				if (event.type === "run.end") {
					const id = String((event.data as { session?: string }).session ?? "");
					forwardUpdate(id, {
						type: "end",
						session: id,
						...((event.data as { runId?: string }).runId ? { runId: (event.data as { runId: string }).runId } : {}),
						eventIds: (event.data as { inputs?: string[] }).inputs ?? [],
						event,
					});
				}
			},
		);
		const notifications = await createNotificationPrefs(db, config.notifications);
		const realRuntime = () => {
			if (!runtime) throw new Error("Runtime is not ready");
			return runtime;
		};
		const observeSession = sessionObserver(store, terminalEnds, realRuntime);
		let sessions: ReturnType<typeof createSessions>;
		let router: ReturnType<typeof createRouter>;
		let delivery: ReturnType<typeof createDelivery>;
		let outbound: ReturnType<typeof outboundQueue>;
		let social: ReturnType<typeof createSocial>;
		const resolveExecutionOwner = async (owner: { session: string; agent: string | null; profile: string }) => {
			const session = await store.sessions.get(owner.session);
			if (!session || session.agent !== owner.agent || session.profile !== owner.profile)
				throw new Error("Execution owner does not match the stored session");
			if (owner.agent && agents.get(owner.agent)?.archivedAt) throw new Error(`Agent archived: ${owner.agent}`);
			return sessions.resolveSession(owner.session);
		};
		const permissions = createPermissions(async (ctx) => {
			realRuntime().assertToolContext(ctx);
			const row = await store.sessions.get(ctx.session);
			if (!row || row.agent !== ctx.agent || row.profile !== ctx.profile)
				throw new Error("Permission context does not match stored session");
			return (await realRuntime().sessionConfig(ctx.session)).resolved.plugins;
		});
		const services: KernelServices = createKernelServices({
			home,
			config,
			store,
			agents,
			log,
			...credentialsAndModels(home, config),
			permissions,
			observeSession,
			resolveExecutionOwner,
			runtime: realRuntime,
			loaded: () => loaded,
			tools: () => tools,
			router: () => router,
			social: () => social,
			delivery: () => delivery,
			outbound: () => outbound,
			sessions: () => sessions,
			objectManagement: () => objectManagement,
			services: () => services,
		});
		let source!: ReturnType<typeof sourceFor>;
		let homePresets!: Map<string, Preset>;
		let skills!: ReturnType<typeof skillsFor>;
		let scaffoldAgent!: (agent: AgentConfig, candidate?: YonderConfig) => Promise<void>;
		const scheduler = createTriggerScheduler((key, error) =>
			log("error", "Plugin scheduled tick failed", { trigger: key, error: String(error) }),
		);
		stopScheduling = () => scheduler.stop();
		const descriptors = await resolvePlugins(home, config, services.log);
		const core = await createBot({
			home,
			version: packageVersion,
			config,
			agents,
			store,
			services,
			permissions,
			notifications,
			forwardUpdate,
			plugins: {
				descriptors,
				version: packageVersion,
				dataPath: (id) => pluginDataPath(home, id),
				storage: (id) => createFilePluginStorage(pluginDataPath(home, id)),
				scheduler,
			},
			prepare: async (loaded) => {
				plugins = loaded;

				source = sourceFor(home, config, loaded);
				// 升级迁移：老 home 补 card-visitor 绑定（幂等，先写 .bak）；失败只记警告，不挡启动。
				try {
					for (const item of await migrateCardVisitor(home, config))
						log("info", `已补 ${item.agent} 的 card-visitor 绑定，备份 ${item.backup}`);
				} catch (error) {
					log("warn", `card-visitor 迁移失败：${error instanceof Error ? error.message : String(error)}`);
				}
				homePresets = await loadHomeSources(home, config, loaded, agents, initialRevisions, source);

				const errors = configurationErrors(
					config,
					agents,
					loaded,
					services.models,
					new Map([...loaded.presets, ...homePresets]),
					{ strictBatchConsumers: false },
				);
				if (errors.length) throw new Error(errors.join("; "));
				scaffoldAgent = (agent: AgentConfig, candidate = config) =>
					scaffoldAgentWorkspace(source, candidate, agent, loaded);
				for (const agent of agents.values()) await scaffoldAgent(agent);
				await seedIdentities(config, store);
				skills = skillsFor(home, config, loaded, log, source);
				const loginChannel = createChannelLogin(loaded);
				const promptOptions = kernelPromptOptions(
					home,
					config,
					loaded,
					store,
					agents,
					realRuntime,
					services,
					skills,
					packageVersion,
					source,
				);

				return {
					homePresets,
					skills,
					promptOptions,
					loginChannel,
					runtimeOptions: {
						deviceOperation: deviceOperation(home, loaded.tools),
						...configRuntimeSections(() => watcher, promptOptions, loaded.contexts),
					},
				};
			},
			openRuntime: async (runtimeOptions) =>
				openNodeRuntime({
					...runtimeOptions,
					localEnvironment: options.environment === "none" ? noEnvironment : true,
					envs: plugins!.envs,
					storage: await openRuntimeStorage(db!),
				}),
			reload: async () => {
				if (!watcher) throw new Error("Config watcher unavailable");
				await watcher.reload();
			},
			report: observability.report,
			log,
			...(options.test ? { test: options.test } : {}),
		});
		runtime = core.runtime;
		sessions = core.sessions;
		router = core.router;
		delivery = core.delivery;
		outbound = core.outbound;
		const { loaded, tools, presets, loginChannel } = core;
		let maintenanceIO!: TriggerIO;
		stopMaintenance = await scheduler.start(
			"runtime:model-maintenance",
			{
				id: "model-maintenance",
				async start(io) {
					maintenanceIO = io;
					await io.schedule(Date.now() + 15000);
				},
				async tick(now) {
					try {
						await runtime!.maintenance(now);
					} finally {
						await maintenanceIO.schedule(now + 15000);
					}
				},
				async stop() {
					await maintenanceIO.schedule(undefined);
				},
			},
			router.emit,
		);
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
		const objectManagement = pluginAgentManagement({
			home,
			config,
			agents,
			plugins: loaded,
			presets: homePresets,
			validate: validateCandidate,
			scaffold: (candidate, agent) => scaffoldAgent(agent, candidate),
			reload: () => watcher!.reload(),
			runtime: realRuntime,
			resolve: resolveExecutionOwner,
			identity: store.identity(),
			delivery,
		});
		social = createSocial({
			home,
			config,
			agents,
			assert: (ctx) => realRuntime().assertToolContext(ctx),
			owner: async (agent, account) => (await store.identity().relation(agent, account)) === "owner",
			target: (conv) => socialTarget(store, agents, loaded.channels, conv),
			record: (event) => store.events.record(event),
			validate: (next) => validateCandidate(config, next, homePresets),
			reload: async () => {
				if (!watcher) throw new Error("Config watcher unavailable");
				await watcher.reload();
			},
			...createSocialSupport(store, agents, loaded.channels),
		});
		watcher = await watchAgents({
			home,
			config,
			agents,
			presets: homePresets,
			loaded,
			store,
			log,
			validateCandidate,
			scaffoldAgent,
			initialRevisions,
			source,
		});
		stopDelivery = async () => {
			await outbound.stop();
			await delivery.close();
		};
		await resumeRecovered(delivery, router, sessions, runtime);
		const work = createKernelWorkHost(agents, store.identity(), loaded.channels);
		await loaded.start(router, work.forInstance);
		delivery.start();
		await outbound.start(scheduler);
		log("info", "Yonder Harness started", { home, version: packageVersion });
		const workbench = createWorkbenchOptions(home, config, realRuntime, sessions.api, presets, loaded.tools);
		return {
			workbench,
			setWorkHost: work.set,
			social,
			notifications,
			observeNotifications: router.observeNotifications,
			channels: {
				list: () =>
					[...loaded.channels].map(([id, channel]) => ({
						instance: id,
						type: config.channels?.[id]?.type,
						login: Boolean(channel.login),
					})),
				shipped: () => shippedChannelsFor(home, config),
				login: loginChannel,
			},
			views: loaded.views.api,
			sessions: { ...sessions.api, ...sessions.branches, ...sessions.workbench, observe: observeSession },
			releaseResult: (data: UpdateResult) => {
				if (resolve(data.home) !== home) throw new Error("Update result belongs to another home");
				return router.emit(updateResultEvent(data));
			},
			notify: (id: string, input: { event: string; text: string }) => sessions.notifyFrom(id, input, "system:cli"),
			events: { query: store.events.query },
			identity: store.identity(),
			management: async (request: ManagementRequest) => {
				if (request.action.startsWith("agents.") || request.action.startsWith("presets."))
					return objectManagement.manage(request);
				const result = await manageHome(home, request, loaded, { config, agents, presets: homePresets });
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
			bots: await createBots(agents, store, (event) => router.emit(event as never), log),
			close,
			eventWatermark: () => store.events.watermark(),
			awakeActivity: workbench.awakeActivity,
			terminal: terminalApi(
				{
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
				},
				source,
			),
		};
	} catch (error) {
		await close();
		throw error;
	}
}
export type { LoginInteraction } from "@yonder/local-host/kernel/credentials";
export { loginProvider, manageCredentialSlots, setNamedCredential } from "@yonder/local-host/kernel/credentials";
export type Kernel = Awaited<ReturnType<typeof openKernel>>;
