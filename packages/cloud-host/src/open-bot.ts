import { createBot } from "@yonder/bot-core";
import { createChannelLogin } from "@yonder/bot-core/kernel/channel-login";
import { configurationErrors } from "@yonder/bot-core/kernel/config-validation";
import { withoutRuntimeBindings } from "@yonder/bot-core/kernel/console";
import { kernelPromptOptions } from "@yonder/bot-core/kernel/conversation";
import { createNotificationPrefs } from "@yonder/bot-core/kernel/notifications";
import { sessionObserver, terminalUpdates } from "@yonder/bot-core/kernel/observation-events";
import { createPluginBindings } from "@yonder/bot-core/kernel/plugin-bindings";
import { resumeRecovered } from "@yonder/bot-core/kernel/recovery";
import { createKernelServices } from "@yonder/bot-core/kernel/services-wiring";
import { loadHomeSources, scaffoldAgentWorkspace, seedIdentities } from "@yonder/bot-core/kernel/source";
import { createPermissions } from "@yonder/bot-core/permissions";
import type { LoadedPlugins, PluginDescriptor } from "@yonder/bot-core/plugins/index";
import { createSkills } from "@yonder/bot-core/skills/index";
import { type AgentConfig, parseAgentConfig, resolveProfile } from "@yonder/bot-definition";
import { fsPluginSkillSources } from "@yonder/local-host/skills/source-fs";
import { Runtime } from "@yonder/runtime-adapter";
import type { RuntimeServices } from "@yonder/runtime-adapter/contracts";
import { PostgresStorage } from "@yonder/runtime-adapter/postgres";
import type { Channel, Credential, Preset } from "@yonder/sdk";
import type { Pool } from "pg";
import { type CloudBotIdentity, ensureCloudDefinition } from "./definitions.js";
import { createPostgresPluginStorage } from "./plugin-storage.js";
import type { createPostgresScheduler } from "./scheduler.js";
import { createPostgresBotSource } from "./source.js";
import { createPostgresStore } from "./store/postgres.js";

export interface CloudBotOptions {
	pool: Pool;
	identity: CloudBotIdentity;
	descriptors: PluginDescriptor[];
	channels: ReadonlyMap<string, Channel>;
	scheduler: ReturnType<ReturnType<typeof createPostgresScheduler>["scope"]>;
	runtimeServices: RuntimeServices;
	admitRun: NonNullable<Parameters<typeof Runtime.open>[0]["admitRun"]>;
	environment: string;
	version: string;
	report(error: unknown): void;
	onIdle?(): void;
}

/** The PG host assembles services; routing, sessions, tools, prompt and running are createBot's real mainline. */
export async function openCloudBot(options: CloudBotOptions) {
	const { pool, identity, scheduler, runtimeServices } = options;
	const config = await ensureCloudDefinition(pool, identity, options.environment);
	const installed = new Map(options.descriptors.map((entry) => [entry.use, entry]));
	const descriptors = (config.plugins ?? []).map((selected) => {
		const entry = installed.get(selected.use);
		if (!entry) throw new Error(`Cloud plugin is not installed: ${selected.use}`);
		return { ...entry, ...(selected.config === undefined ? {} : { config: selected.config }) };
	});
	const source = createPostgresBotSource(pool, identity.ownerId, identity.id);
	const home = source.home.root;
	const agents = new Map<string, AgentConfig>();
	let core: Awaited<ReturnType<typeof createBot>>;
	let loaded!: LoadedPlugins;
	let runtime!: Runtime;
	const realRuntime = () => runtime;
	const ends = new Map();
	const forward = terminalUpdates(ends, options.report);
	const store = createPostgresStore(
		pool,
		identity.ownerId,
		identity.id,
		(agent) => agents.get(agent)?.owner,
		(event) => {
			void loaded?.observe(event).catch(options.report);
		},
	);
	const resolve = async (owner: { session: string; agent: string | null; profile: string }) => {
		const row = await store.sessions.get(owner.session);
		if (!row || row.agent !== owner.agent || row.profile !== owner.profile)
			throw new Error("Execution owner does not match stored session");
		return core.sessions.resolveSession(owner.session);
	};
	const permissions = createPermissions(async (ctx) => {
		runtime.assertToolContext(ctx);
		return (await resolve(ctx)).resolved.plugins;
	});
	const log = (level: "info" | "warn" | "error", text: string, data?: object) => {
		const detail = data && "error" in data ? `: ${String(data.error)}` : "";
		if (level !== "info") options.report(new Error(`${text}${detail}`));
	};
	const unavailable = (): never => {
		throw new Error("This operation requires a connected execution host");
	};
	const storage = (id: string) => createPostgresPluginStorage(pool, identity.ownerId, identity.id, id);
	const pluginCredentials = storage("credentials").open();
	const credentials = {
		async get(name: string): Promise<Credential | undefined> {
			const text = await pluginCredentials.read(name);
			return text === undefined ? undefined : JSON.parse(text);
		},
	};
	let bindings: ReturnType<typeof createPluginBindings>;
	const services = createKernelServices({
		home,
		config,
		store,
		agents,
		log,
		credentials,
		models: runtimeServices.models,
		permissions,
		observeSession: sessionObserver(store, ends, realRuntime),
		resolveExecutionOwner: resolve,
		runtime: realRuntime,
		loaded: () => loaded,
		tools: () => core.tools,
		router: () => core.router,
		delivery: () => core.delivery,
		outbound: () => core.outbound,
		sessions: () => core.sessions,
		social: () => ({ inspect: unavailable, update: unavailable }),
		objectManagement: () => ({ bindings }),
		services: () => services,
		host: {
			async status(ctx) {
				runtime.assertToolContext(ctx);
				if (!ctx.capabilities.includes("admin")) throw new Error("Host status requires admin capability");
				const resolved = await runtime.sessionConfig(ctx.session);
				const slash = resolved.resolved.model.indexOf("/");
				const provider = resolved.resolved.model.slice(0, slash);
				const known = !!runtimeServices.models.getModel(provider, resolved.resolved.model.slice(slash + 1));
				const authConfigured = !!(await runtimeServices.credentials.read(provider));
				return {
					model: {
						...(config.defaultModel ? { default: config.defaultModel } : {}),
						session: resolved.resolved.model,
						known,
						authConfigured,
					},
					channels: [{ instance: "card", type: "card", login: false }],
					plugins: descriptors.map((entry) => ({ id: entry.manifest.id, use: entry.use })),
					shippedChannels: [],
					gateway: { enabled: false },
					credentials: [{ provider: "rightapi-glm", slot: "default", configured: true }],
				};
			},
			async modelReady(id) {
				const agent = agents.get(id);
				if (!agent) return false;
				const model = resolveProfile(
					agent.profiles[agent.defaultProfile]!,
					agent.defaults,
					undefined,
					config.defaultModel,
				).model;
				const slash = model.indexOf("/");
				return (
					!!runtimeServices.models.getModel(model.slice(0, slash), model.slice(slash + 1)) &&
					!!(await runtimeServices.credentials.read(model.slice(0, slash)))
				);
			},
		},
	});
	try {
		core = await createBot({
			home,
			version: options.version,
			config,
			agents,
			store,
			services,
			permissions,
			notifications: await createNotificationPrefs(store.notifications, config.notifications),
			forwardUpdate: forward,
			report: options.report,
			log,
			plugins: {
				descriptors,
				version: options.version,
				storage,
				dataPath: (id) => `/plugins/${id}`,
				scheduler,
				sharedChannels: options.channels,
			},
			async prepare(plugins, getRuntime) {
				loaded = plugins;
				const homePresets: Map<string, Preset> = await loadHomeSources(source, config, loaded, agents, new Map());
				const errors = configurationErrors(
					config,
					agents,
					loaded,
					services.models,
					new Map([...loaded.presets, ...homePresets]),
				);
				if (errors.length) throw new Error(errors.join("; "));
				for (const agent of agents.values()) await scaffoldAgentWorkspace(source, config, agent, loaded);
				await seedIdentities(config, store);
				const skills = createSkills({
					source,
					plugins: fsPluginSkillSources(loaded.skillDirs, loaded.skillSources),
					onIssue: (issue) => options.report(new Error(String(issue))),
				});
				return {
					homePresets,
					skills,
					loginChannel: createChannelLogin(loaded),
					promptOptions: kernelPromptOptions(
						home,
						config,
						loaded,
						store,
						agents,
						getRuntime,
						services,
						skills,
						options.version,
						source,
						{
							hostFacts: {
								nodePath: "unavailable",
								nodeVersion: "unavailable",
								platform: "cloud",
								cliPath: "unavailable",
								cliAvailable: false,
							},
						},
					),
				};
			},
			async openRuntime(runtimeOptions) {
				runtime = await Runtime.open({
					...runtimeOptions,
					services: runtimeServices,
					storage: await PostgresStorage.open(pool, identity.ownerId, identity.id),
					admitRun: options.admitRun,
					onIdle: async (id) => {
						await runtimeOptions.onIdle?.(id);
						options.onIdle?.();
					},
				});
				return runtime;
			},
		});
		bindings = createPluginBindings({
			config,
			agents,
			assert: (ctx) => runtime.assertToolContext(ctx),
			resolve,
			owner: async (agent, account) => (await store.identity().relation(agent, account)) === "owner",
			target: async (request, agent, current) => (await core.delivery.resolveTarget(request, agent, current)).target,
			hasSend: (current) =>
				runtime
					.describeTools(current)
					.some((tool) => tool.name === "message_send" && ["offer", "search"].includes(tool.exposure)),
			async update(id, binding) {
				const previous = agents.get(id)!;
				const updated = parseAgentConfig(
					JSON.stringify({
						...withoutRuntimeBindings(previous),
						bindings: [
							...previous.bindings.filter((item) => !item.id.startsWith("@") && item.id !== binding.id),
							binding,
						],
					}),
					"agent.yaml",
					id,
				);
				await source
					.workspace(config.agents!.find((entry) => entry.id === id)!)
					.writeFile("agent.yaml", JSON.stringify(updated));
				agents.set(id, updated);
			},
		});
		await resumeRecovered(core.delivery, core.router, core.sessions, runtime);
		await loaded!.start(core.router);
		core.delivery.start();
		await core.outbound.start(scheduler);
		return {
			...core,
			scheduler,
			store,
			source,
			identity,
			async busy() {
				for (const session of await store.sessions.list({ open: true }))
					if (await runtime.hasPendingWork(session.id)) return true;
				return scheduler.busy();
			},
			async close() {
				await scheduler.stop(); // detach before contribution.stop(), preserving persisted deadlines
				await core.outbound.stop();
				await core.delivery.close();
				await loaded!.stop();
				await runtime.close();
			},
		};
	} catch (error) {
		await scheduler.stop();
		if (loaded) await loaded.stop();
		if (runtime) await runtime.close();
		throw error;
	}
}
