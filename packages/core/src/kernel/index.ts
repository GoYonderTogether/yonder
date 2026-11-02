import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Preset } from "@yonder/sdk";
import { shippedChannelsFor } from "../bundles.js";
import type { AgentConfig, YonderConfig } from "../config/index.js";
import { lockHome } from "../control/home-lock.js";
import { createKernelWorkHost } from "../control/work-stream.js";
import { createDelivery } from "../delivery/index.js";
import { outboundQueue } from "../delivery/outbound.js";
import { createPermissions } from "../permissions.js";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { prepareInput, scaffoldWorkspace } from "../prompt/index.js";
import { type UpdateResult, updateResultEvent } from "../release/result.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { checkBudget } from "../sessions/budget.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { builtinViews } from "../views/builtin.js";
import { backgroundHandlers } from "./background.js";
import { createBots } from "./bots.js";
import { migrateCardVisitor } from "./card-visitor.js";
import { createChannelLogin } from "./channel-login.js";
import { configRuntimeSections } from "./config-facts.js";
import { loadHomeConfig, loadHomeSources } from "./config-sources.js";
import { reloadWatcher, watchAgents } from "./config-watch.js";
import { kernelPromptOptions, kernelTools } from "./conversation.js";
import { deviceOperation } from "./device-operation.js";
import { configurationErrors, profileContexts, protectSessions } from "./home.js";
import { type ManagementRequest, manageHome } from "./home-management.js";
import { createNotificationPrefs } from "./notifications.js";
import { createObservability } from "./observability.js";
import { observedRuntimeEvents, sessionObserver, type TerminalSends, terminalUpdates } from "./observation-events.js";
import {
	agentOperabilityProjector,
	conversationOperabilityProjector,
	extendKernelInspection,
	managementOperabilityProjector,
} from "./operability-adapters.js";
import { pluginAgentManagement } from "./plugin-bindings.js";
import { quotaWire } from "./quota-wire.js";
import { resumeRecovered } from "./recovery.js";
import { createRunCompletion } from "./run-completion.js";
import { createKernelServices } from "./services-wiring.js";
import { createSocial, createSocialSupport, socialTarget } from "./social.js";
import { terminalApi } from "./terminal.js";
import { type KernelOptions, ticks } from "./tick.js";
import { createWorkbenchOptions } from "./workbench-options.js";
import { credentialsAndModels, filesFor, skillsFor } from "./workspace.js";
export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
export { migrateCardVisitor } from "./card-visitor.js";
export { initHome, inspectHome } from "./home.js";
export { type ManagementRequest, manageHome, offlineQuery } from "./home-management.js";
export { inspectSkills, type KernelLog } from "./workspace.js";
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
	const reloadConfig = () => reloadWatcher(watcher);
	const agentStatus = (id: string) => watcher?.status(id) ?? Promise.resolve(undefined);
	let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
	let stopDelivery: (() => Promise<void>) | undefined;
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		watcher?.close();
		await stopDelivery?.();
		try {
			await plugins?.stop();
		} finally {
			try {
				if (runtime) await runtime.close();
				else await db?.close();
			} finally {
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
		plugins = await loadPlugins(home, config, services);
		const loaded = plugins;
		// 升级迁移：老 home 补 card-visitor 绑定（幂等，先写 .bak）；失败只记警告，不挡启动。
		try {
			for (const item of await migrateCardVisitor(home, config))
				log("info", `已补 ${item.agent} 的 card-visitor 绑定，备份 ${item.backup}`);
		} catch (error) {
			log("warn", `card-visitor 迁移失败：${error instanceof Error ? error.message : String(error)}`);
		}
		const homePresets = await loadHomeSources(home, config, loaded, agents, initialRevisions);
		const presets = () => [...new Map([...loaded.presets, ...homePresets]).values()];
		const errors = configurationErrors(
			config,
			agents,
			loaded,
			services.models,
			new Map([...loaded.presets, ...homePresets]),
			{ strictBatchConsumers: false },
		);
		if (errors.length) throw new Error(errors.join("; "));
		const scaffoldAgent = (agent: AgentConfig, candidate = config) =>
			scaffoldWorkspace(
				filesFor(home, candidate, loaded, agent.id),
				profileContexts(agent, candidate.defaultModel),
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
			conversationOperabilityProjector({ agents, store, loaded, configStatus: agentStatus }),
			agentOperabilityProjector({ agents, store, loaded, configStatus: agentStatus }),
		);
		const { closeReason, completeRun } = createRunCompletion({
			store,
			runtime: realRuntime,
			delivery: () => delivery,
			gate: () => gate,
			router: () => router,
			sessions: () => sessions,
		});
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
			onReport: observability.report,
			forward: forwardUpdate,
		});
		delivery = createDelivery({
			hooks: loaded.hooks,
			participationHooks: loaded.hooks,
			store,
			agents,
			channels: loaded.channels,
			runtime: realRuntime,
			sessions,
			onReport: observability.report,
			log,
		});
		outbound = outboundQueue({
			store,
			sessions,
			agents,
			config,
			delivery: () => delivery,
			participationHooks: loaded.hooks,
		});
		const gate = quotaWire({
			db,
			config,
			store,
			sessions,
			delivery,
			channels: loaded.channels,
			skills: skills.inspect,
			loginChannel,
			// 现有重载能力：watcher 在 watchConfig 之后赋值，调用时才解析。
			reload: reloadConfig,
		});
		router = createRouter({
			channels: loaded.channels,
			socialBatchPlugin: new Set(loaded.info?.map((plugin) => plugin.id) ?? []),
			participationHooks: loaded.hooks,
			store,
			sessions,
			runtime: realRuntime,
			agents,
			notificationLevel: notifications.level,
			onOwnerMention: async (session, event) => {
				const owner = { session: session.id, agent: session.agent, profile: session.profile };
				const current = await resolveExecutionOwner(owner);
				if (!current.resolved.capabilities.includes("message"))
					throw new Error("Owner notification requires message capability");
				const result = await outbound.enqueue(owner, "yonder", `群消息提及了主人：${event.conv}`, {
					kind: "decision",
					key: `owner-mention:${event.id}`,
					sourceEvents: [event.id],
				});
				if (!result.ok) throw new Error(result.error ?? "Owner notification could not be queued");
			},
			onCommand: (session, event) => gate.command(session, event),
			onStart: delivery.onStart,
			onRun: (session, run) => completeRun(session.id, run),
			onReport: observability.report,
			onWarn: (message, data) => log("warn", message, data),
		});
		const tools = kernelTools(
			{
				store,
				agents,
				sessions,
				runtime: realRuntime,
				delivery,
				ask: router.ask,
				presets,
				...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
			},
			home,
			permissions,
			skills,
		);
		for (const { decl, provider } of builtinViews(realRuntime)) loaded.views.register("core", decl, provider);
		runtime = await Runtime.open({
			db,
			home,
			config,
			plugins: [...loaded.tools].map(([id, tools]) => ({ id, tools, hooks: loaded.hooks.get(id) ?? [] })),
			tools,
			envs: loaded.envs,
			deviceOperation: deviceOperation(home, loaded.tools),
			readEvent: store.events.get,
			settled: async (session, run) => Boolean(await store.events.runEnd(session, run)),
			prepareInput: async (id, event, config, wake, signal) => {
				const row = await store.sessions.get(id);
				if (!row) throw new Error(`Unknown session: ${id}`);
				return prepareInput(row, config, event, wake, { ...promptOptions, ...(signal ? { signal } : {}) });
			},
			onAdmitted: async (id, input) => {
				if (input.version) await store.sessions.setVersion(id, input.version);
			},
			...ticks(store, delivery, options.test),
			// Budgets are a session concern; the kernel injects them so the runtime stays below sessions.
			onUsageSettled: (id, usage) => checkBudget({ db: db!, config }, id, { input: usage.input, output: usage.output }),
			onRun: completeRun,
			onSessionSettled: async (data) => {
				await store.events.record({ type: "session.settled", data });
			},
			onIdle: async (id) => {
				const session = await store.sessions.get(id);
				if (!session) return;
				await router.finishIdle(session);
				if (!session.closed && !(await realRuntime().hasPendingWork(id))) {
					const end = await realRuntime().lastResult(id);
					const close = end ? await closeReason(id, session.mode, end.status) : undefined;
					if (close) await sessions.closeSession(id, close);
				}
			},
			...backgroundHandlers({
				store,
				runtime: realRuntime,
				delivery,
				report: observability.report,
				views: loaded.views,
			}),
			resolveSession: async (id) => {
				const session = await sessions.resolveSession(id);
				const protectedFiles = session.resolved.contexts
					.flatMap((id) => loaded.contexts.get(id)?.files ?? [])
					.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : []));
				return { ...session, protectedFiles };
			},
			...configRuntimeSections(() => watcher, promptOptions, loaded.contexts),
			onModelHealth: (event) => log(event.state === "recovered" ? "info" : "warn", "Model health", event),
			...observedRuntimeEvents(store, forwardUpdate, delivery.modelNotice),
			onReport: observability.report,
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
		const objectManagement = pluginAgentManagement({
			home,
			config,
			agents,
			plugins: loaded,
			presets: homePresets,
			validate: validateCandidate,
			scaffold: (candidate, agent) => scaffoldAgent(agent, candidate),
			reload: reloadConfig,
			runtime: realRuntime,
			resolve: resolveExecutionOwner,
			identity: store.identity(),
			delivery,
			projectOperability: managementOperabilityProjector({
				agents,
				store,
				loaded,
				configStatus: agentStatus,
			}),
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
			reload: reloadConfig,
			...createSocialSupport(store, agents, loaded.channels, loaded.hooks),
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
		});
		stopDelivery = async () => {
			await outbound.stop();
			await delivery.close();
		};
		await resumeRecovered(delivery, router, sessions, runtime);
		const work = createKernelWorkHost(agents, store.identity(), loaded.channels);
		await loaded.start(router, work.forInstance);
		delivery.start();
		outbound.start();
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
				return extendKernelInspection({
					result,
					request,
					agents,
					store,
					loaded,
					currentConfig: (session) => realRuntime().currentConfig(session),
					configStatus: (id) => watcher!.status(id),
				});
			},
			bots: await createBots(agents, store, (event) => router.emit(event as never), log),
			close,
			eventWatermark: () => store.events.watermark(),
			awakeActivity: workbench.awakeActivity,
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
export type { LoginInteraction } from "./credentials.js";
export { loginProvider, manageCredentialSlots, setNamedCredential } from "./credentials.js";
export type Kernel = Awaited<ReturnType<typeof openKernel>>;
