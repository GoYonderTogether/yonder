import type { createDelivery } from "@yonder/bot-core/delivery/index";
import type { outboundQueue } from "@yonder/bot-core/delivery/outbound";
import type { createRouter } from "@yonder/bot-core/routing/index";
import type { createSessions } from "@yonder/bot-core/sessions/index";
import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter";
import type { KernelServices, LoadedPlugins } from "../plugins/index.js";
import { captureExecutionOwner } from "../sessions/execution-source.js";
import type { Store } from "../store/contracts.js";
import { runSubagent } from "./subagents.js";

const unavailable = (): never => {
	throw new Error("Harness service is unavailable before start");
};

type CreateDelivery = typeof createDelivery;
type CreateRouter = typeof createRouter;
type CreateSessions = typeof createSessions;
type CreateOutbound = typeof outboundQueue;
type ResolvedSession = Awaited<ReturnType<ReturnType<CreateSessions>["resolveSession"]>>;
type ToolCatalog = NonNullable<Parameters<typeof Runtime.open>[0]["tools"]>;
type Social = NonNullable<KernelServices["social"]>;
type SocialContext = NonNullable<Parameters<Social["inspect"]>[1]>;

export interface ServicesWiring {
	home: string;
	config: YonderConfig;
	store: Store;
	agents: Map<string, AgentConfig>;
	log: (level: "info" | "warn" | "error", message: string, data?: object) => void;
	credentials: KernelServices["credentials"];
	models: KernelServices["models"];
	permissions: KernelServices["permissions"];
	observeSession: NonNullable<KernelServices["sessions"]["observe"]>;
	resolveExecutionOwner: (owner: {
		session: string;
		agent: string | null;
		profile: string;
	}) => Promise<RuntimeSessionConfig>;
	runtime: () => Runtime;
	// Assigned later in openKernel; every accessor is read at call time, exactly as the original closures did.
	loaded: () => LoadedPlugins;
	tools: () => ToolCatalog;
	router: () => ReturnType<CreateRouter>;
	social: () => {
		inspect(request: Parameters<Social["inspect"]>[0], ctx: SocialContext): ReturnType<Social["inspect"]>;
		update(request: Parameters<Social["update"]>[0], ctx: SocialContext): ReturnType<Social["update"]>;
	};
	delivery: () => ReturnType<CreateDelivery>;
	outbound: () => ReturnType<CreateOutbound>;
	sessions: () => ReturnType<CreateSessions>;
	objectManagement: () => {
		bindings: {
			configureBinding(
				...args: Parameters<KernelServices["agents"]["configureBinding"]>
			): ReturnType<KernelServices["agents"]["configureBinding"]>;
			inspectBinding(
				...args: Parameters<KernelServices["agents"]["inspectBinding"]>
			): ReturnType<KernelServices["agents"]["inspectBinding"]>;
		};
	};
	services: () => KernelServices;
	host: KernelServices["host"];
}

/** The plugin-facing service bundle openKernel hands to loadPlugins. */
export function createKernelServices(wiring: ServicesWiring): KernelServices {
	const { store, agents, log } = wiring;
	return {
		social: {
			admitBatch: (request, pluginId) => wiring.router().admitBatch(request, pluginId),
			inspect: (request, ctx) => {
				if (!ctx) throw new Error("Tool context required");
				return wiring.social().inspect(request, ctx);
			},
			update: (request, ctx) => {
				if (!ctx) throw new Error("Tool context required");
				return wiring.social().update(request, ctx);
			},
			resume: async () => {
				throw new Error("Social resume unavailable");
			},
		},
		permissions: wiring.permissions,
		agents: {
			configureBinding: (...args) => wiring.objectManagement().bindings.configureBinding(...args),
			inspectBinding: (...args) => wiring.objectManagement().bindings.inspectBinding(...args),
			list: async () =>
				[...agents.values()]
					.filter((a) => !a.archivedAt)
					.map(({ id, name, owner, avatarUrl }) => ({ id, name, owner, ...(avatarUrl ? { avatarUrl } : {}) })),
		},
		credentials: wiring.credentials,
		models: wiring.models,
		log: {
			info: (m, d) => log("info", m, d),
			warn: (m, d) => log("warn", m, d),
			error: (m, d) => log("error", m, d),
		},
		events: {
			emit: (event) => wiring.router().emit(event),
			ask: (event) => wiring.router().ask(event),
			query: (query) => store.events.query(query),
			on: unavailable,
		},
		messages: {
			send: async (request, pluginId, ctx) => {
				const { owner, ...message } = request;
				if (ctx) return wiring.delivery().sendTool(ctx, message);
				if (message.notification && owner && agents.get(owner.agent ?? "")?.social?.enabled) {
					try {
						const current = await wiring.resolveExecutionOwner(owner);
						if (!current.resolved.capabilities.includes("message"))
							return { ok: false, error: "Program delivery requires current message capability" };
						return wiring.outbound().enqueue(owner, pluginId, message.text, message.notification);
					} catch (error) {
						return { ok: false, error: error instanceof Error ? error.message : String(error) };
					}
				}
				if (!owner) return wiring.delivery().sendPlugin(pluginId, message);
				try {
					const config = await wiring.resolveExecutionOwner(owner);
					const session = await store.sessions.get(owner.session);
					return wiring.delivery().sendOwned(pluginId, message, config, session!);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
		},
		sessions: {
			command: (id, command) => wiring.sessions().api.command(id, command),
			notify: (id: string, input: { event: string; text: string }, pluginId?: string) =>
				wiring.sessions().notifyFrom(id, input, pluginId ? `plugin:${pluginId}` : "system:yonder"),
			list: (filter) => wiring.sessions().api.list(filter),
			get: (id) => wiring.sessions().api.get(id),
			open: (req) => wiring.sessions().api.open(req),
			submit: (id, input, opts, pluginId) =>
				pluginId
					? wiring.sessions().submitFrom(id, input, opts, `plugin:${pluginId}`)
					: wiring.sessions().api.submit(id, input, opts),
			abort: (id) => wiring.sessions().api.abort(id),
			close: (id) => wiring.sessions().api.close(id),
			transcript: (id, range) => wiring.sessions().api.transcript(id, range),
			observe: wiring.observeSession,
		},
		subagents: { run: (request, ctx) => runSubagent(wiring.runtime(), wiring.tools(), request, ctx) },
		execution: {
			capture: (ctx) => captureExecutionOwner(store, agents, wiring.runtime(), ctx),
			resolve: async (owner) => {
				const { resolved, resources } = await wiring.resolveExecutionOwner(owner);
				return {
					capabilities: [...resolved.capabilities],
					...(resources ? { resources: structuredClone(resources) } : {}),
					...(resolved.channelInstances === undefined ? {} : { channelInstances: [...resolved.channelInstances] }),
				};
			},
			run: async (request) => {
				const active = await wiring.resolveExecutionOwner(request.owner);
				if (!active.resolved.capabilities.includes("exec") || !request.capabilities.includes("exec"))
					throw new Error("Command execution requires current and creator exec capability");
				return wiring.runtime().executeCommand(active, {
					command: request.command,
					...(request.cwd ? { cwd: request.cwd } : {}),
					...(request.signal ? { signal: request.signal } : {}),
				});
			},
		},
		identity: store.identity(),
		services: { resolve: (capability) => wiring.runtime().resolveService(capability) },
		host: wiring.host,
	};
}

export type { ResolvedSession };
