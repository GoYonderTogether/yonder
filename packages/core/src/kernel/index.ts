import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Preset } from "@yonder/sdk";
import { shippedChannelsFor } from "../bundles.js";
import { type AgentConfig, loadPresets, loadYonderConfig, watchConfig, type YonderConfig } from "../config/index.js";
import { lockHome } from "../control/home-lock.js";
import { createKernelWorkHost } from "../control/work-stream.js";
import { createDelivery } from "../delivery/index.js";
import { outboundQueue } from "../delivery/outbound.js";
import { createPermissions } from "../permissions.js";
import { type KernelServices, type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { prepareInput, scaffoldWorkspace, systemPromptKeys, systemPromptParts } from "../prompt/index.js";
import { type UpdateResult, updateResultEvent } from "../release/result.js";
import { createRouter } from "../routing/index.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { closeOnRunEnd } from "../sessions/close-policy.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { builtinViews } from "../views/builtin.js";
import { backgroundHandlers } from "./background.js";
import { createBots } from "./bots.js";
import { migrateCardVisitor } from "./card-visitor.js";
import { kernelPromptOptions, kernelTools } from "./conversation.js";
import { configurationErrors, profileContexts, protectSessions } from "./home.js";
import { type ManagementRequest, manageHome } from "./home-management.js";
import { hostService } from "./host-status.js";
import { manageObjects } from "./management.js";
import { createNotificationPrefs } from "./notifications.js";
import { createObservability } from "./observability.js";
import { observedRuntimeEvents, sessionObserver, type TerminalSends, terminalUpdates } from "./observation-events.js";
import { quotaWire } from "./quota-wire.js";
import { resumeRecovered } from "./recovery.js";
import { createSocial } from "./social.js";
import { runSubagent } from "./subagents.js";
import { terminalApi } from "./terminal.js";
import { type KernelOptions, ticks } from "./tick.js";
import { credentialsAndModels, filesFor, loadAgents, skillsFor, unavailable } from "./workspace.js";
export const packageVersion = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
	.version as string;
export { migrateCardVisitor } from "./card-visitor.js";
export { initHome, inspectHome } from "./home.js";
export { type ManagementRequest, manageHome, offlineQuery } from "./home-management.js";
export type { KernelLog } from "./workspace.js";
export { inspectSkills } from "./workspace.js";
export async function openKernel(home: string, options: KernelOptions = {}) {
	home = resolve(home);
	process.env.YONDER_HOME = home;
	const log = options.log ?? (() => {});
	const observability = createObservability({ home, log, db: () => db });
	const report = observability.report;
	await mkdir(join(home, ".yonder"), { recursive: true });
	const unlock = await lockHome(home);
	let runtime: Runtime | undefined;
	let plugins: LoadedPlugins | undefined;
	let watcher: Awaited<ReturnType<typeof watchConfig>> | undefined;
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
		const config = await loadYonderConfig(home);
		db = await openDatabase(join(home, ".yonder/state.db"));
		observability.startRetention();
		const terminalEnds: TerminalSends = new Map();
		const forwardUpdate = terminalUpdates(terminalEnds, report);
		const agents = new Map<string, AgentConfig>();
		const store = await createStore(
			db,
			(id) => agents.get(id)?.owner,
			false,
			(event) => {
				void plugins?.observe(event).catch(report);
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
		const services: KernelServices = {
			social: {
				admitBatch: (request, pluginId) => router.admitBatch(request, pluginId),
				inspect: (request, ctx) => {
					if (!ctx) throw new Error("Tool context required");
					return social.inspect(request, ctx);
				},
				update: (request, ctx) => {
					if (!ctx) throw new Error("Tool context required");
					return social.update(request, ctx);
				},
				resume: async () => {
					throw new Error("Social resume unavailable");
				},
			},
			permissions,
			agents: {
				list: async () =>
					[...agents.values()]
						.filter((a) => !a.archivedAt)
						.map(({ id, name, owner, avatarUrl }) => ({ id, name, owner, ...(avatarUrl ? { avatarUrl } : {}) })),
			},
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
				send: async (request, pluginId, ctx) => {
					const { owner, ...message } = request;
					if (ctx) return delivery.sendTool(ctx, message);
					if (message.notification && owner && agents.get(owner.agent ?? "")?.social?.enabled) {
						try {
							const current = await resolveExecutionOwner(owner);
							if (!current.resolved.capabilities.includes("message"))
								return { ok: false, error: "Program delivery requires current message capability" };
							return outbound.enqueue(owner, pluginId, message.text, message.notification);
						} catch (error) {
							return { ok: false, error: error instanceof Error ? error.message : String(error) };
						}
					}
					if (!owner) return delivery.sendPlugin(pluginId, message);
					try {
						const config = await resolveExecutionOwner(owner);
						const session = await store.sessions.get(owner.session);
						return delivery.sendOwned(pluginId, message, config, session!);
					} catch (error) {
						return { ok: false, error: error instanceof Error ? error.message : String(error) };
					}
				},
			},
			sessions: {
				command: (id, command) => sessions.api.command(id, command),
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
			subagents: { run: (request, ctx) => runSubagent(realRuntime(), tools, request, ctx) },
			execution: {
				resolve: async (owner) => {
					const { resolved } = await resolveExecutionOwner(owner);
					return {
						capabilities: [...resolved.capabilities],
						...(resolved.channelInstances === undefined ? {} : { channelInstances: [...resolved.channelInstances] }),
					};
				},
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
			host: hostService(home, config, () => ({ runtime: realRuntime(), loaded, agents, services })),
		};
		plugins = await loadPlugins(home, config, services);
		const loaded = plugins;
		// 升级迁移：老 home 补 card-visitor 绑定（幂等，先写 .bak）；失败只记警告，不挡启动。
		try {
			for (const item of await migrateCardVisitor(home, config))
				log("info", `已补 ${item.agent} 的 card-visitor 绑定，备份 ${item.backup}`);
		} catch (error) {
			log("warn", `card-visitor 迁移失败：${error instanceof Error ? error.message : String(error)}`);
		}
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
		const loginChannel = async (
			request: { instance?: string; action?: "start" | "poll"; verifyCode?: string; replace?: boolean },
			signal: AbortSignal,
		) => {
			if (
				request.instance !== undefined &&
				(typeof request.instance !== "string" || !/^[a-z0-9-]+$/.test(request.instance))
			)
				throw new Error("Invalid channel instance");
			if (request.action !== undefined && !["start", "poll"].includes(request.action))
				throw new Error("Invalid channel login action");
			if (request.replace !== undefined && typeof request.replace !== "boolean")
				throw new Error("Invalid channel replacement option");
			if (
				request.verifyCode !== undefined &&
				(typeof request.verifyCode !== "string" || !/^\d{1,12}$/.test(request.verifyCode))
			)
				throw new Error("Invalid channel verification code");
			const channel = request.instance
				? loaded.channels.get(request.instance)
				: [...loaded.channels.values()].find((channel) => channel.login);
			if (!channel?.login) throw new Error("No configured login-capable channel; configure a channel instance first");
			return channel.login(
				request.action ?? (request.verifyCode ? "poll" : "start"),
				signal,
				request.verifyCode,
				request.replace,
			);
		};
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
		);
		/** 运行结束后的关闭原因：task 会话读一次运行期策略，失败的运行不关闭（见 sessions 的 closeOnRunEnd）。 */
		const closeReason = async (id: string, mode: import("@yonder/sdk").SessionInfo["mode"], status: string) => {
			const close = mode === "task" ? (await realRuntime().sessionState(id))?.close : undefined;
			return closeOnRunEnd(mode, status as import("@yonder/sdk").RunResult["status"], close);
		};
		const completeRun = async (id: string, run: import("../runtime/index.js").RuntimeRun) => {
			const session = await store.sessions.get(id);
			if (!session) throw new Error(`Missing runtime session: ${id}`);
			const completion = await delivery.onRun(session, run, []);
			await gate.settle(id, run);
			await store.events.recordRun(completion.ending);
			completion.deliver();
			await router.finishRun(session, run);
			if (!(await realRuntime().hasPendingWork(id))) {
				const close = await closeReason(id, session.mode, run.status);
				if (close) await sessions.closeSession(id, close);
			}
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
			forward: forwardUpdate,
		});
		delivery = createDelivery({
			hooks: loaded.hooks,
			store,
			agents,
			channels: loaded.channels,
			runtime: realRuntime,
			sessions,
			onReport: report,
			log,
		});
		outbound = outboundQueue({ store, sessions, agents, config, delivery: () => delivery });
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
			reload: async () => {
				if (!watcher) throw new Error("Config watcher unavailable");
				await watcher.reload();
			},
		});
		router = createRouter({
			channels: loaded.channels,
			socialBatchPlugin: new Set(loaded.info?.map((plugin) => plugin.id) ?? []),
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
			onReport: report,
		});
		const tools = kernelTools(
			{
				store,
				agents,
				sessions,
				runtime: realRuntime,
				delivery,
				ask: router.ask,
				presets: () => [...new Map([...loaded.presets, ...homePresets]).values()],
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
			...backgroundHandlers({ store, runtime: realRuntime, delivery, report, views: loaded.views }),
			resolveSession: async (id) => {
				const session = await sessions.resolveSession(id);
				const protectedFiles = session.resolved.contexts
					.flatMap((id) => loaded.contexts.get(id)?.files ?? [])
					.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : []));
				return { ...session, protectedFiles };
			},
			sections: (session, signal) => systemPromptParts(session, { ...promptOptions, ...(signal ? { signal } : {}) }),
			sectionKeys: systemPromptKeys(loaded.contexts),
			onModelHealth: (event) => log(event.state === "recovered" ? "info" : "warn", "Model health", event),
			...observedRuntimeEvents(store, forwardUpdate, delivery.modelNotice),
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
		social = createSocial({
			home,
			config,
			agents,
			assert: (ctx) => realRuntime().assertToolContext(ctx),
			owner: async (agent, account) => (await store.identity().relation(agent, account)) === "owner",
			target: async (conv) => {
				const events = (await store.events.query({ type: "message.in", conv, limit: 1000 })).events;
				const event = events.find((item) =>
					["dm", "group", "channel"].includes(String((item.data as { kind?: unknown }).kind)),
				);
				if (!event) return undefined;
				const kind = (event.data as { kind: "dm" | "group" | "channel" }).kind;
				const person = event.from ? (await store.identity().account(event.from))?.person : undefined;
				return { kind, ...(event.from ? { from: event.from } : {}), ...(person ? { person } : {}) };
			},
			record: (event) => store.events.record(event),
			validate: (next) => validateCandidate(config, next, homePresets),
			reload: async () => {
				if (!watcher) throw new Error("Config watcher unavailable");
				await watcher.reload();
			},
		});
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
		let managementQueue: Promise<unknown> = Promise.resolve();
		return {
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
			bots: await createBots(agents, store, (event) => router.emit(event as never), log),
			close,
			eventWatermark: () => store.events.watermark(),
			async awakeActivity() {
				const sessions = await store.sessions.list({ open: true });
				const active = await Promise.all(
					sessions.map(async (session) => ((await realRuntime().hasAwakeWork(session.id)) ? session.id : null)),
				);
				return { active: active.filter(Boolean).length };
			},
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
