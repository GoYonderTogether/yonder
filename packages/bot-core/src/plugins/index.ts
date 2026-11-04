import { resolve } from "node:path";
import { CONSOLE, consoleChannel } from "@yonder/bot-core/kernel/console";
import { type Lifecycle, stopContributions } from "@yonder/bot-core/plugins/lifecycle";
import type { KernelServices } from "@yonder/bot-core/plugins/services";
import { instanceConfig, pluginEvent, validateConfig } from "@yonder/bot-core/plugins/validation";
import { peerWorkspaceContext } from "@yonder/bot-core/prompt/index";
import { createViews } from "@yonder/bot-core/views/index";
import type { YonderConfig } from "@yonder/bot-definition";
import type {
	Channel,
	ChannelIO,
	ChannelProvider,
	ContextContribution,
	EnvProvider,
	ExecutionEnv,
	Hook,
	PluginAPI,
	PluginModule,
	Preset,
	SessionsAPI,
	Tool,
	Trigger,
	YEvent,
} from "@yonder/sdk";
import { API_VERSION, acct } from "@yonder/sdk";

export type { KernelServices } from "@yonder/bot-core/plugins/services";

import type { PluginStorage } from "@yonder/sdk";
import { createRegistrationCollector, type PluginManifest, type Registrations } from "@yonder/sdk/registrations";
import type { createTriggerScheduler } from "@yonder/sdk/trigger-scheduler";
import { guardStorage } from "./storage.js";
export interface LoadedPlugins {
	views: ReturnType<typeof createViews>;
	channels: Map<string, Channel>;
	/** 被跳过的渠道实例（id → 原因），doctor 报告。 */
	channelErrors: ReadonlyMap<string, string>;
	envs: Map<string, ExecutionEnv>;
	tools: Map<string, Tool[]>;
	hooks: Map<string, Hook[]>;
	contexts: Map<string, ContextContribution>;
	presets: Map<string, Preset>;
	skillDirs: string[];
	skillSources?: ReadonlyMap<string, string>;
	info?: Array<{
		id: string;
		version: string;
		use: string;
		directory: string;
		contributes: object;
		/** package.json 标了 `deprecated: true`；doctor 据此提示 `yonder migrate` 的迁移路径。 */
		deprecated?: boolean;
	}>;
	start(io: ChannelIO, workControl?: (id: string) => NonNullable<ChannelIO["control"]>): Promise<void>;
	stop(): Promise<void>;
	drain(): Promise<void>;
	observe(event: YEvent): Promise<void>;
}

type Listener = { pluginId: string; type: string; handler: (event: YEvent) => void | Promise<void> };

export interface PluginDescriptor {
	manifest: PluginManifest;
	module: PluginModule;
	directory: string;
	use: string;
	version: string;
	deprecated?: boolean;
	config?: unknown;
	check(registrations: Registrations): Promise<string[]>;
}
export interface PluginBindings {
	descriptors: PluginDescriptor[];
	version: string;
	storage(id: string): PluginStorage;
	dataPath(id: string): string;
	scheduler: ReturnType<typeof createTriggerScheduler>;
	/** Channels already started by a multi-Bot host; the host owns their lifecycle. */
	sharedChannels?: ReadonlyMap<string, Channel>;
}
export async function registerPlugins(
	bindings: PluginBindings,
	config: YonderConfig,
	services: KernelServices,
): Promise<LoadedPlugins> {
	const views = createViews();
	const [channels, channelErrors] = [new Map<string, Channel>(), new Map<string, string>()];
	const [envs, tools, hooks] = [new Map<string, ExecutionEnv>(), new Map<string, Tool[]>(), new Map<string, Hook[]>()];
	const contexts = new Map<string, ContextContribution>([[peerWorkspaceContext.id, peerWorkspaceContext]]);
	const presets = new Map<string, Preset>();
	const skillDirs: string[] = [];
	const skillSources = new Map<string, string>();
	const info: NonNullable<LoadedPlugins["info"]> = [];
	const channelProviders = new Map<string, { pluginId: string; provider: ChannelProvider }>();
	const envProviders = new Map<string, { pluginId: string; provider: EnvProvider }>();
	const triggers: Array<{ pluginId: string; trigger: Trigger }> = [];
	const listeners: Listener[] = [];
	const observations = new Map<string, Promise<void>>();
	let observing = true;
	const started: Lifecycle[] = [];
	const scheduler = bindings.scheduler;
	const pluginIds = new Set<string>();
	const contributionOwners = new Map<string, string>();

	const claim = (slot: string, name: string, pluginId: string) => {
		const key = `${slot}:${name}`;
		const owner = contributionOwners.get(key);
		if (owner) throw new Error(`${slot}.${name}: contribution conflict between ${owner} and ${pluginId}`);
		contributionOwners.set(key, pluginId);
	};

	claim("contexts", peerWorkspaceContext.id, "core");
	for (const entry of bindings.descriptors) {
		const { directory, manifest, module: plugin, version } = entry;
		info.push({
			id: manifest.id,
			version,
			use: entry.use,
			directory,
			contributes: manifest.contributes,
			...(entry.deprecated ? { deprecated: true } : {}),
		});
		if (pluginIds.has(manifest.id)) throw new Error(`${manifest.id}: plugin is listed more than once`);
		pluginIds.add(manifest.id);

		const pluginConfig =
			entry.config ?? ((plugin.configSchema as { type?: string } | undefined)?.type === "object" ? {} : undefined);
		if (plugin.configSchema) validateConfig(manifest.id, "plugin config", plugin.configSchema, pluginConfig);

		const { api: registrationsApi, registrations } = createRegistrationCollector();
		let settingUp = true;
		const register = <T>(slot: string, save: (item: T) => void) => ({
			register(item: T) {
				if (!settingUp) throw new Error(`${manifest.id}: ${slot}.register may only be called during setup`);
				save(item);
			},
		});
		const denySetupWrite = (operation: string) => {
			if (settingUp) throw new Error(`${manifest.id}: ${operation} is not allowed during setup`);
		};
		const events: PluginAPI["events"] = {
			emit: (event) => {
				denySetupWrite("events.emit");
				return services.events.emit(pluginEvent(manifest.id, event));
			},
			ask: (event) => {
				denySetupWrite("events.ask");
				return services.events.ask(pluginEvent(manifest.id, event));
			},
			query: (query) => services.events.query(query),
			on: (type, handler) => {
				if (!settingUp) throw new Error(`${manifest.id}: events.on may only be registered during setup`);
				registrationsApi.events.on(type, handler);
			},
		};
		const participation = services.social;
		const api: PluginAPI = {
			id: manifest.id,
			version: bindings.version,
			locale: config.locale ?? "zh-CN",
			timezone: config.timezone ?? "Asia/Shanghai",
			config: pluginConfig,
			log: {
				info: (message, data) => services.log.info(message, { ...data, plugin: manifest.id }),
				warn: (message, data) => services.log.warn(message, { ...data, plugin: manifest.id }),
				error: (message, data) => services.log.error(message, { ...data, plugin: manifest.id }),
			},
			...(participation
				? {
						social: {
							...participation,
							admitBatch: (request) => participation.admitBatch(request, manifest.id),
						},
					}
				: {}),
			permissions: {
				...register("permissions", registrationsApi.permissions.register),
				list: (ctx) => {
					denySetupWrite("permissions.list");
					return services.permissions.list(ctx);
				},
				invoke: (request, ctx) => {
					denySetupWrite("permissions.invoke");
					return services.permissions.invoke(request, ctx);
				},
			},
			channels: register("channels", registrationsApi.channels.register),
			tools: register("tools", registrationsApi.tools.register),
			contexts: register("contexts", registrationsApi.contexts.register),
			views: {
				register: (decl, provider) => {
					register("views", (value: typeof decl) => {
						claim("views", value.id, manifest.id);
						views.register(manifest.id, value, provider);
						registrationsApi.views.register(value, provider);
					}).register(decl);
				},
			},
			invalidate: (ids, badge) => views.invalidate(manifest.id, ids, badge),
			triggers: register("triggers", registrationsApi.triggers.register),
			envs: register("envs", registrationsApi.envs.register),
			hooks: register("hooks", registrationsApi.hooks.register),
			presets: register("presets", registrationsApi.presets.register),
			skills: register("skills", registrationsApi.skills.register),
			events,
			messages: {
				send: (message, ctx) => {
					denySetupWrite("messages.send");
					return services.messages.send(message, manifest.id, ctx);
				},
			},
			agents: {
				list: () => services.agents.list(),
				configureBinding: (request, ctx) => {
					denySetupWrite("agents.configureBinding");
					return services.agents.configureBinding(request, manifest.id, ctx);
				},
				inspectBinding: (request, owner) => services.agents.inspectBinding(request, manifest.id, owner),
			},
			host: services.host,
			credentials: services.credentials,
			execution: services.execution,
			sessions: {
				command: (id, command) => {
					denySetupWrite("sessions.command");
					return services.sessions.command(id, command);
				},
				notify: (id, input) => {
					denySetupWrite("sessions.notify");
					return services.sessions.notify(id, input, manifest.id);
				},
				list: (filter) => services.sessions.list(filter),
				get: (id) => services.sessions.get(id),
				open: (request) => {
					denySetupWrite("sessions.open");
					return services.sessions.open(request);
				},
				submit: ((id, input, options) => {
					denySetupWrite("sessions.submit");
					return services.sessions.submit(
						id,
						input,
						{
							...(options?.wait !== undefined ? { wait: options.wait } : {}),
							...(options?.busy ? { busy: options.busy } : {}),
							...(options?.executionOwner ? { executionOwner: options.executionOwner } : {}),
							...(options?.resources ? { resources: options.resources } : {}),
						},
						manifest.id,
					);
				}) as SessionsAPI["submit"],
				abort: (id) => {
					denySetupWrite("sessions.abort");
					return services.sessions.abort(id);
				},
				close: (id) => {
					denySetupWrite("sessions.close");
					return services.sessions.close(id);
				},
				transcript: (id, range) => services.sessions.transcript(id, range),
				observe: async (id, send) => {
					denySetupWrite("sessions.observe");
					if (!services.sessions.observe) throw new Error("Session observation unavailable");
					return services.sessions.observe(id, send);
				},
			},
			subagents: {
				run: (request, ctx) => {
					denySetupWrite("subagents.run");
					return services.subagents.run(request, ctx);
				},
			},
			identity: {
				account: (ref) => services.identity.account(ref),
				person: (ref) => services.identity.person(ref),
				createPerson: (person) => {
					denySetupWrite("identity.createPerson");
					return services.identity.createPerson(person);
				},
				link: (account, person) => {
					denySetupWrite("identity.link");
					return services.identity.link(account, person);
				},
				unlink: (account) => {
					denySetupWrite("identity.unlink");
					return services.identity.unlink(account);
				},
				relation: (agent, account) => services.identity.relation(agent, account),
				lookup: (ref) => services.identity.lookup(ref),
			},
			services: services.services,
			models: services.models,
			paths: { data: bindings.dataPath(manifest.id) },
			storage: guardStorage(bindings.storage(manifest.id), denySetupWrite),
		};
		try {
			await plugin.setup(api);
		} finally {
			settingUp = false;
		}

		const issues = await entry.check(registrations);
		if (issues.length) throw new Error(issues.join("\n"));

		for (const provider of registrations.permissions) services.permissions.register(provider);

		for (const provider of registrations.channels) {
			claim("channels", provider.type, manifest.id);
			channelProviders.set(provider.type, { pluginId: manifest.id, provider });
		}
		for (const provider of registrations.envs) {
			claim("envs", provider.type, manifest.id);
			envProviders.set(provider.type, { pluginId: manifest.id, provider });
		}
		for (const tool of registrations.tools) claim("tools", tool.name, manifest.id);
		for (const context of registrations.contexts) {
			claim("contexts", context.id, manifest.id);
			contexts.set(context.id, context);
		}
		for (const trigger of registrations.triggers) claim("triggers", trigger.id, manifest.id);
		for (const hook of registrations.hooks) claim("hooks", hook.id, manifest.id);
		for (const preset of registrations.presets) {
			claim("presets", preset.id, manifest.id);
			presets.set(preset.id, preset);
		}
		for (const skill of manifest.contributes.skills ?? []) claim("skills", skill, manifest.id);
		for (const skillDir of registrations.skills) {
			const path = resolve(directory, skillDir);
			skillDirs.push(path);
			skillSources.set(path, manifest.id);
		}
		tools.set(manifest.id, registrations.tools);
		hooks.set(manifest.id, registrations.hooks);
		triggers.push(...registrations.triggers.map((trigger) => ({ pluginId: manifest.id, trigger })));
		listeners.push(...registrations.listeners.map((listener) => ({ pluginId: manifest.id, ...listener })));
	}

	if (config.channels?.[CONSOLE]) throw new Error(`channels.${CONSOLE}: reserved for the built-in console channel`);
	channels.set(CONSOLE, consoleChannel());
	// 单个渠道实例不合法只跳过并记错误，不让整台 Agent 起不来（JV2-J09-03）
	for (const [id, value] of Object.entries(config.channels ?? {})) {
		try {
			const found = channelProviders.get(value.type);
			if (!found) throw new Error(`channels.${id}: no provider for type ${value.type}`);
			const instance = instanceConfig(value);
			const { configSchema } = found.provider;
			if (configSchema) validateConfig(found.pluginId, `channels.${id} config`, configSchema, instance);
			const channel = await found.provider.create(id, instance);
			if (channel.output.stream && !channel.stream) throw new Error(`channels.${id}: stream output requires stream()`);
			channel.multiAgent = found.provider.multiAgent === true;
			channels.set(id, channel);
		} catch (error) {
			channelErrors.set(id, String(error instanceof Error ? error.message : error));
			services.log.error("Channel instance skipped", { instance: id, error: channelErrors.get(id) });
		}
	}
	for (const [id, value] of Object.entries(config.envs ?? {})) {
		if (id === "local" && value.type === "local") continue;
		const found = envProviders.get(value.type);
		if (!found) throw new Error(`envs.${id}: no provider for type ${value.type}`);
		const instance = instanceConfig(value);
		if (found.provider.configSchema)
			validateConfig(found.pluginId, `envs.${id} config`, found.provider.configSchema, instance);
		envs.set(id, await found.provider.create(id, instance));
	}

	const stop = () => stopContributions(started, services.log);
	return {
		views,
		channels,
		channelErrors,
		envs,
		tools,
		hooks,
		contexts,
		presets,
		skillDirs,
		skillSources,
		info,
		async start(io, workControl) {
			try {
				for (const [id, channel] of channels) {
					if (id === CONSOLE || bindings.sharedChannels?.get(id) === channel) continue;
					const owner = channelProviders.get(config.channels![id]!.type)!.pluginId;
					await channel.start({
						emit: (event) => io.emit(pluginEvent(owner, event, id, channel.multiAgent)),
						ask: (event) => io.ask(pluginEvent(owner, event, id, channel.multiAgent)),
						...(owner === "channel-mcp" && config.channels![id]!.type === "mcp"
							? {
									ownerViewAct: async (viewId: string, action: string, input?: unknown) => {
										const account = (config.channels![id] as { account?: unknown }).account;
										if (
											typeof account !== "string" ||
											(await services.identity.relation("main", acct(id, account))) !== "owner"
										)
											throw new Error("MCP account is not an owner");
										if (
											viewId !== "cron.manage" ||
											!views.list().some((view) => view.id === viewId && view.actScope === "owner")
										)
											throw new Error("Owner management view unavailable");
										return views.act(viewId, action, input);
									},
								}
							: {}),
						...(owner === "channel-card" && config.channels![id]!.type === "card" && workControl
							? { control: workControl(id) }
							: {}),
						ownerConnected: ({ account, conv, agent }) => {
							if (
								!account.startsWith(`acct:${id}:`) ||
								!conv.startsWith(`conv:${id}:`) ||
								(agent && !channel.multiAgent) ||
								(channel.multiAgent &&
									(!agent || !account.startsWith(`acct:${id}:${agent}:`) || !conv.startsWith(`conv:${id}:${agent}:`)))
							)
								throw new Error(`${owner}: invalid owner connection`);
							return io.emit({
								type: "channel.connected",
								from: `plugin:${owner}`,
								conv,
								data: {
									account,
									kind: "dm",
									...(agent ? { target: agent } : {}),
									text: `渠道 ${id} 已连接主人 ${account}，私聊是 ${conv}。你可以向主人打个招呼。`,
								},
							});
						},
					});
					started.push({ pluginId: owner, stop: () => channel.stop() });
				}
				for (const { pluginId, trigger } of triggers) {
					const stop = await scheduler.start(`${pluginId}:${trigger.id}`, trigger, (event) =>
						io.emit(pluginEvent(pluginId, event)),
					);
					started.push({ pluginId, stop });
				}
			} catch (error) {
				try {
					await stop();
				} catch {}
				throw error;
			}
		},
		stop,
		async drain() {
			observing = false;
			await Promise.all(observations.values());
		},
		async observe(event) {
			if (!observing) return;
			await Promise.all(
				[...pluginIds].map((pluginId) => {
					const next = (observations.get(pluginId) ?? Promise.resolve()).then(async () => {
						for (const listener of listeners) {
							if (
								listener.pluginId !== pluginId ||
								(listener.type !== event.type &&
									!(listener.type.endsWith(".*") && event.type.startsWith(listener.type.slice(0, -1))))
							)
								continue;
							try {
								await listener.handler(structuredClone(event));
							} catch (error) {
								services.log.error("Plugin event observer failed", {
									plugin: pluginId,
									type: event.type,
									error: String(error),
								});
							}
						}
					});
					observations.set(pluginId, next);
					return next;
				}),
			);
		},
	} satisfies LoadedPlugins;
}
