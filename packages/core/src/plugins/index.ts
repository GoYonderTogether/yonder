import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	Channel,
	ChannelIO,
	ChannelProvider,
	ContextContribution,
	Delivery,
	EnvProvider,
	EventInput,
	ExecutionEnv,
	Hook,
	PluginAPI,
	PluginModule,
	Preset,
	SessionsAPI,
	Tool,
	ToolContext,
	Trigger,
	TSchema,
	YEvent,
} from "@yonder/sdk";
import { API_VERSION } from "@yonder/sdk";
import { checkRegistrations, createRegistrationCollector, readPluginManifest } from "@yonder/sdk/testing";
import { Errors } from "typebox/value";
import type { YonderConfig } from "../config/index.js";
import { CONSOLE, consoleChannel } from "../kernel/console.js";
import { peerWorkspaceContext } from "../prompt/index.js";
import { createViews } from "../views/index.js";

type PluginMessage = Parameters<PluginAPI["messages"]["send"]>[0];
export type KernelServices = Omit<
	Pick<
		PluginAPI,
		| "permissions"
		| "social"
		| "agents"
		| "events"
		| "messages"
		| "credentials"
		| "sessions"
		| "subagents"
		| "identity"
		| "services"
		| "host"
		| "execution"
		| "models"
		| "log"
	>,
	"messages" | "sessions"
> & {
	messages: { send(message: PluginMessage, pluginId: string, ctx?: ToolContext): Promise<Delivery> };
	sessions: Omit<SessionsAPI, "submit" | "notify"> & {
		notify(id: string, input: { event: string; text: string }, pluginId?: string): ReturnType<SessionsAPI["notify"]>;
		submit(
			id: string,
			input: Parameters<SessionsAPI["submit"]>[1],
			options?: Parameters<SessionsAPI["submit"]>[2],
			pluginId?: string,
		): ReturnType<SessionsAPI["submit"]>;
	};
};

export interface LoadedPlugins {
	views: ReturnType<typeof createViews>;
	channels: Map<string, Channel>;
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
	start(io: ChannelIO): Promise<void>;
	stop(): Promise<void>;
	observe(event: YEvent): Promise<void>;
}

type Lifecycle = { pluginId: string; stop(): Promise<void> };
type Listener = { pluginId: string; type: string; handler: (event: YEvent) => void | Promise<void> };

function pluginEvent(id: string, event: EventInput, channel?: string, multiAgent = false): EventInput {
	if (["routing.social-decision", "notification.intent", "notification.final"].includes(event.type))
		throw new Error(`${id}: ${event.type} is a core event`);
	if (event.type === "message.in" && channel) {
		if (
			!event.from?.startsWith(`acct:${channel}:`) ||
			!event.conv?.startsWith(`conv:${channel}:`) ||
			("target" in event.data && !multiAgent)
		)
			throw new Error(`${id}: message.in must use its own channel and cannot specify target`);
	} else if (!event.type.startsWith(`${id}.`) || event.type.length === id.length + 1)
		throw new Error(`${id}: event type must start with ${id}.`);
	return event;
}

/** A plugin's private state directory (`api.paths.data`). */
export const pluginDataPath = (home: string, id: string) => join(home, ".yonder", "plugins", id);

export async function pluginDirectory(home: string, use: string): Promise<string> {
	if (isAbsolute(use) || use.startsWith(".")) return resolve(home, use);
	const homeParent = pathToFileURL(join(home, "yonder-loader.mjs")).href;
	let manifest: string | undefined;
	try {
		manifest = findPackageJSON(use, homeParent);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
		manifest = findPackageJSON(use, import.meta.url);
	}
	if (!manifest) throw new Error(`Cannot find plugin package root for ${use}`);
	return dirname(manifest);
}

function validateConfig(pluginId: string, label: string, schema: TSchema, value: unknown): void {
	const errors = [...Errors(schema, value)].map((error) => `${error.instancePath || "/"}: ${error.message}`);
	if (errors.length) throw new Error(`${pluginId}: invalid ${label}: ${errors.join("; ")}`);
}

function instanceConfig(value: { type: string } & Record<string, unknown>): Record<string, unknown> {
	const { type: _, ...config } = value;
	return config;
}

export async function loadPlugins(
	home: string,
	config: YonderConfig,
	services: KernelServices,
): Promise<LoadedPlugins> {
	const views = createViews();
	const channels = new Map<string, Channel>();
	const envs = new Map<string, ExecutionEnv>();
	const tools = new Map<string, Tool[]>();
	const hooks = new Map<string, Hook[]>();
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
	const started: Lifecycle[] = [];
	const pluginIds = new Set<string>();
	const contributionOwners = new Map<string, string>();

	const claim = (slot: string, name: string, pluginId: string) => {
		const key = `${slot}:${name}`;
		const owner = contributionOwners.get(key);
		if (owner) throw new Error(`${slot}.${name}: contribution conflict between ${owner} and ${pluginId}`);
		contributionOwners.set(key, pluginId);
	};

	claim("contexts", peerWorkspaceContext.id, "core");
	for (const entry of config.plugins ?? []) {
		const directory = await pluginDirectory(home, entry.use);
		const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")) as {
			version: string;
			yonder?: { id?: unknown; apiVersion?: unknown };
			deprecated?: unknown;
		};
		const apiVersion = pkg.yonder?.apiVersion ?? 1;
		if (typeof apiVersion === "number" && apiVersion > API_VERSION) {
			// A plugin built for a newer plugin API is skipped so the remaining plugins still load (04 §6).
			services.log.error("Plugin needs a newer Yonder (需要更新的 Yonder)", {
				plugin: String(pkg.yonder?.id ?? entry.use),
				apiVersion,
				supported: API_VERSION,
			});
			continue;
		}
		const manifest = await readPluginManifest(directory);
		const { version } = pkg;
		if (typeof version !== "string" || !version) throw new Error(`${manifest.id}: missing package version`);
		info.push({
			id: manifest.id,
			version,
			use: entry.use,
			directory,
			contributes: manifest.contributes,
			...(pkg.deprecated === true ? { deprecated: true } : {}),
		});
		if (pluginIds.has(manifest.id)) throw new Error(`${manifest.id}: plugin is listed more than once`);
		pluginIds.add(manifest.id);
		const loaded = await import(pathToFileURL(resolve(directory, manifest.entry)).href);
		const plugin = loaded.default as PluginModule;
		if (typeof plugin?.setup !== "function")
			throw new Error(`${manifest.id}: entry default export must provide setup(api)`);
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
		const api: PluginAPI = {
			id: manifest.id,
			version: JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version,
			locale: config.locale ?? "zh-CN",
			timezone: config.timezone ?? "Asia/Shanghai",
			config: pluginConfig,
			log: {
				info: (message, data) => services.log.info(message, { ...data, plugin: manifest.id }),
				warn: (message, data) => services.log.warn(message, { ...data, plugin: manifest.id }),
				error: (message, data) => services.log.error(message, { ...data, plugin: manifest.id }),
			},
			...(manifest.id === "social" && services.social ? { social: services.social } : {}),
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
			agents: services.agents,
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
			paths: { data: pluginDataPath(home, manifest.id) },
		};
		try {
			await plugin.setup(api);
		} finally {
			settingUp = false;
		}

		const issues = await checkRegistrations(manifest, registrations, directory);
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
	for (const [id, value] of Object.entries(config.channels ?? {})) {
		const found = channelProviders.get(value.type);
		if (!found) throw new Error(`channels.${id}: no provider for type ${value.type}`);
		const instance = instanceConfig(value);
		if (found.provider.configSchema)
			validateConfig(found.pluginId, `channels.${id} config`, found.provider.configSchema, instance);
		const channel = await found.provider.create(id, instance);
		if (channel.output.stream && !channel.stream)
			throw new Error(`channels.${id}: stream output requires provider stream()`);
		channel.multiAgent = found.provider.multiAgent === true;
		channels.set(id, channel);
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

	const stop = async () => {
		let failure: unknown;
		for (const item of started.splice(0).reverse()) {
			try {
				await item.stop();
			} catch (error) {
				services.log.error("Plugin contribution failed to stop", { plugin: item.pluginId, error: String(error) });
				failure ??= error;
			}
		}
		if (failure) throw failure;
	};
	return {
		views,
		channels,
		envs,
		tools,
		hooks,
		contexts,
		presets,
		skillDirs,
		skillSources,
		info,
		async start(io) {
			try {
				for (const [id, channel] of channels) {
					if (id === CONSOLE) continue;
					const owner = channelProviders.get(config.channels![id]!.type)!.pluginId;
					await channel.start({
						emit: (event) => io.emit(pluginEvent(owner, event, id, channel.multiAgent)),
						ask: (event) => io.ask(pluginEvent(owner, event, id, channel.multiAgent)),
					});
					started.push({ pluginId: owner, stop: () => channel.stop() });
				}
				for (const { pluginId, trigger } of triggers) {
					await trigger.start({ emit: (event) => io.emit(pluginEvent(pluginId, event)) });
					started.push({ pluginId, stop: () => trigger.stop() });
				}
			} catch (error) {
				try {
					await stop();
				} catch {}
				throw error;
			}
		},
		stop,
		async observe(event) {
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
