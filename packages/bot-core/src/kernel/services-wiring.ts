import type { createSessions } from "@yonder/bot-core/sessions/index";
import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import type { Runtime } from "@yonder/runtime-adapter";
import { createPermissions } from "../permissions.js";
import type { KernelServices, LoadedPlugins } from "../plugins/index.js";
import { captureExecutionOwner } from "../sessions/execution-source.js";
import type { Store } from "../store/contracts.js";
import type { createBot } from "./create-bot.js";
import { runSubagent } from "./subagents.js";

const unavailable = (): never => {
	throw new Error("Harness service is unavailable before start");
};

type CreateSessions = typeof createSessions;
type ResolvedSession = Awaited<ReturnType<ReturnType<CreateSessions>["resolveSession"]>>;
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
	observeSession: NonNullable<KernelServices["sessions"]["observe"]>;
	runtime: () => Runtime;
	// Assigned later in openKernel; every accessor is read at call time, exactly as the original closures did.
	loaded: () => LoadedPlugins;
	bot: () => Pick<Awaited<ReturnType<typeof createBot>>, "tools" | "router" | "delivery" | "outbound" | "sessions">;
	social: () => {
		inspect(request: Parameters<Social["inspect"]>[0], ctx: SocialContext): ReturnType<Social["inspect"]>;
		update(request: Parameters<Social["update"]>[0], ctx: SocialContext): ReturnType<Social["update"]>;
	};
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
	const resolveOwner = (owner: import("@yonder/sdk").ExecutionOwner) =>
		resolveExecutionOwner(store, agents, wiring.bot().sessions, owner);
	return {
		social: {
			admitBatch: (request, pluginId) => wiring.bot().router.admitBatch(request, pluginId),
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
		permissions: createPermissions(async (ctx) => {
			wiring.runtime().assertToolContext(ctx);
			await assertExecutionOwner(store, agents, ctx);
			return (await wiring.runtime().sessionConfig(ctx.session)).resolved.plugins;
		}),
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
			emit: (event) => wiring.bot().router.emit(event),
			ask: (event) => wiring.bot().router.ask(event),
			query: (query) => store.events.query(query),
			on: unavailable,
		},
		messages: {
			send: async (request, pluginId, ctx) => {
				const { owner, ...message } = request;
				if (ctx) return wiring.bot().delivery.sendTool(ctx, message);
				if (message.notification && owner && agents.get(owner.agent ?? "")?.social?.enabled) {
					try {
						const current = await resolveOwner(owner);
						if (!current.resolved.capabilities.includes("message"))
							return { ok: false, error: "Program delivery requires current message capability" };
						return wiring.bot().outbound.enqueue(owner, pluginId, message.text, message.notification);
					} catch (error) {
						return { ok: false, error: error instanceof Error ? error.message : String(error) };
					}
				}
				if (!owner) return wiring.bot().delivery.sendPlugin(pluginId, message);
				try {
					const config = await resolveOwner(owner);
					const session = await store.sessions.get(owner.session);
					return wiring.bot().delivery.sendOwned(pluginId, message, config, session!);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
		},
		sessions: {
			command: (id, command) => wiring.bot().sessions.api.command(id, command),
			notify: (id: string, input: { event: string; text: string }, pluginId?: string) =>
				wiring.bot().sessions.notifyFrom(id, input, pluginId ? `plugin:${pluginId}` : "system:yonder"),
			list: (filter) => wiring.bot().sessions.api.list(filter),
			get: (id) => wiring.bot().sessions.api.get(id),
			open: (req) => wiring.bot().sessions.api.open(req),
			submit: (id, input, opts, pluginId) =>
				pluginId
					? wiring.bot().sessions.submitFrom(id, input, opts, `plugin:${pluginId}`)
					: wiring.bot().sessions.api.submit(id, input, opts),
			abort: (id) => wiring.bot().sessions.api.abort(id),
			close: (id) => wiring.bot().sessions.api.close(id),
			transcript: (id, range) => wiring.bot().sessions.api.transcript(id, range),
			observe: wiring.observeSession,
		},
		subagents: { run: (request, ctx) => runSubagent(wiring.runtime(), wiring.bot().tools, request, ctx) },
		execution: {
			capture: (ctx) => captureExecutionOwner(store, agents, wiring.runtime(), ctx),
			resolve: async (owner) => {
				const { resolved, resources } = await resolveOwner(owner);
				return {
					capabilities: [...resolved.capabilities],
					...(resources ? { resources: structuredClone(resources) } : {}),
					...(resolved.channelInstances === undefined ? {} : { channelInstances: [...resolved.channelInstances] }),
				};
			},
			run: async (request) => {
				const active = await resolveOwner(request.owner);
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

async function assertExecutionOwner(
	store: Store,
	agents: Map<string, AgentConfig>,
	owner: import("@yonder/sdk").ExecutionOwner,
) {
	const row = await store.sessions.get(owner.session);
	if (!row || row.agent !== owner.agent || row.profile !== owner.profile)
		throw new Error("Execution owner does not match the stored session");
	if (owner.agent && agents.get(owner.agent)?.archivedAt) throw new Error(`Agent archived: ${owner.agent}`);
}
export async function resolveExecutionOwner(
	store: Store,
	agents: Map<string, AgentConfig>,
	sessions: ReturnType<CreateSessions>,
	owner: import("@yonder/sdk").ExecutionOwner,
) {
	await assertExecutionOwner(store, agents, owner);
	return sessions.resolveSession(owner.session);
}
