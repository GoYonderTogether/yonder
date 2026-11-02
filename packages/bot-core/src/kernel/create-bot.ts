import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import type { Runtime, RuntimeOptions } from "@yonder/runtime-adapter";
import type { Preset } from "@yonder/sdk";
import { createDelivery } from "../delivery/index.js";
import { outboundQueue } from "../delivery/outbound.js";
import type { createPermissions } from "../permissions.js";
import { type KernelServices, type LoadedPlugins, type PluginBindings, registerPlugins } from "../plugins/index.js";
import { type PromptOptions, prepareInput } from "../prompt/index.js";
import { createRouter } from "../routing/index.js";
import { checkBudget } from "../sessions/budget.js";
import { createSessions } from "../sessions/index.js";
import type { createSkills } from "../skills/index.js";
import type { Store } from "../store/contracts.js";
import { builtinViews } from "../views/builtin.js";
import { backgroundHandlers } from "./background.js";
import type { createChannelLogin } from "./channel-login.js";
import { kernelTools } from "./conversation.js";
import type { createNotificationPrefs } from "./notifications.js";
import { observedRuntimeEvents, type terminalUpdates } from "./observation-events.js";
import { quotaWire } from "./quota-wire.js";
import { createRunCompletion } from "./run-completion.js";
import { type KernelOptions, ticks } from "./tick.js";
import type { KernelLog } from "./types.js";
export interface PreparedBot {
	homePresets: Map<string, Preset>;
	skills: ReturnType<typeof createSkills>;
	promptOptions: PromptOptions;
	loginChannel: ReturnType<typeof createChannelLogin>;
	runtimeOptions?: Partial<Pick<RuntimeOptions, "sections" | "sectionKeys" | "deviceOperation">>;
}
export interface CreateBotOptions {
	home: string;
	version: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	store: Store;
	plugins: PluginBindings;
	services: KernelServices;
	permissions: ReturnType<typeof createPermissions>;
	notifications: Awaited<ReturnType<typeof createNotificationPrefs>>;
	forwardUpdate: ReturnType<typeof terminalUpdates>;
	prepare(loaded: LoadedPlugins, runtime: () => Runtime): Promise<PreparedBot>;
	openRuntime(options: Omit<RuntimeOptions, "storage" | "services">): Promise<Runtime>;
	reload?(): Promise<unknown>;
	report(error: unknown): void;
	log: KernelLog;
	test?: KernelOptions["test"];
}
/** The single local/cloud route, session, runtime and delivery composition. */
export async function createBot(options: CreateBotOptions) {
	const {
		home,
		version: packageVersion,
		config,
		agents,
		store,
		services,
		permissions,
		notifications,
		forwardUpdate,
		log,
	} = options;
	let runtime: Runtime | undefined;
	const realRuntime = () => {
		if (!runtime) throw new Error("Runtime is not ready");
		return runtime;
	};
	const loaded = await registerPlugins(options.plugins, config, services);
	const prepared = await options.prepare(loaded, realRuntime);
	const { homePresets, skills, promptOptions, loginChannel } = prepared;
	const presets = () => [...new Map([...loaded.presets, ...homePresets]).values()];
	let sessions: ReturnType<typeof createSessions>;
	let router: ReturnType<typeof createRouter>;
	let delivery: ReturnType<typeof createDelivery>;
	let outbound: ReturnType<typeof outboundQueue>;
	const resolveExecutionOwner = async (owner: { session: string; agent: string | null; profile: string }) => {
		const session = await store.sessions.get(owner.session);
		if (!session || session.agent !== owner.agent || session.profile !== owner.profile)
			throw new Error("Execution owner does not match the stored session");
		if (owner.agent && agents.get(owner.agent)?.archivedAt) throw new Error(`Agent archived: ${owner.agent}`);
		return sessions.resolveSession(owner.session);
	};
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
		onReport: options.report,
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
		onReport: options.report,
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
		config,
		store,
		sessions,
		delivery,
		channels: loaded.channels,
		skills: skills.inspect,
		loginChannel,
		// 现有重载能力：watcher 在 watchConfig 之后赋值，调用时才解析。
		...(options.reload ? { reload: options.reload } : {}),
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
		onReport: options.report,
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
	runtime = await options.openRuntime({
		home,
		config,
		plugins: [...loaded.tools].map(([id, tools]) => ({ id, tools, hooks: loaded.hooks.get(id) ?? [] })),
		tools,

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
		onUsageSettled: (id, usage) => checkBudget({ store, config }, id, { input: usage.input, output: usage.output }),
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
			report: options.report,
			views: loaded.views,
		}),
		resolveSession: async (id) => {
			const session = await sessions.resolveSession(id);
			const protectedFiles = session.resolved.contexts
				.flatMap((id) => loaded.contexts.get(id)?.files ?? [])
				.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : []));
			return { ...session, protectedFiles };
		},
		...prepared.runtimeOptions,
		onModelHealth: (event) => log(event.state === "recovered" ? "info" : "warn", "Model health", event),
		...observedRuntimeEvents(store, forwardUpdate, delivery.modelNotice),
		onReport: options.report,
	});
	return {
		runtime,
		sessions,
		router,
		delivery,
		outbound,
		tools,
		loaded,
		homePresets,
		skills,
		promptOptions,
		loginChannel,
		presets,
	};
}
