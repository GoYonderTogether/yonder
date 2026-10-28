import type { Attachment, EventQuery } from "@yonder/sdk";
import Type, { type Static, type TSchema } from "typebox";
import { Errors } from "typebox/value";
import { loadYonderConfig } from "../config/index.js";
import { defaultPiSessionsDir, listPiSessions, showPiSession } from "../imports/pi-sessions.js";
import type { Kernel } from "../kernel/index.js";
import type { ControlHandler } from "./index.js";
import {
	allScopes,
	type HostCtx,
	type MethodDef,
	MethodError,
	PROTOCOL,
	type Principal,
	type Scope,
} from "./method-types.js";
import { dedupe } from "./submit-dedupe.js";

export * from "./method-types.js";

const text = Type.String({ minLength: 1 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
const id = obj({ id: text });
const busy = Type.Optional(Type.Union([Type.Literal("followup"), Type.Literal("steer"), Type.Literal("interrupt")]));

function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: handler params are validated against def.params by registry.prepare before any handler runs.
	return def as unknown as MethodDef;
}

/** Bot conversations (every non-task session) need `owner` scope; task sessions keep the plain read/write scopes. */
const ownsBots = (ctx: HostCtx) => ctx.principal.scopes.includes("owner");
async function guardSession(ctx: HostCtx, id: string, session?: { mode: string }) {
	const row = session ?? (await ctx.kernel.sessions.get(id));
	if (row && row.mode !== "task" && !ownsBots(ctx))
		throw new MethodError("forbidden", "Bot conversations require owner scope");
}

async function activitySummary(kernel: Kernel) {
	const agents = await kernel.terminal.activity();
	const sessions = agents.flatMap((agent) =>
		agent.tasks.map((task) => ({ id: task.id, agent: agent.id, state: task.state })),
	);
	return {
		running: sessions.filter((row) => row.state === "running").length,
		waiting: sessions.filter((row) => row.state === "waiting").length,
		sessions,
	};
}

async function importsDir(home: string) {
	const configured = (await loadYonderConfig(home)).imports?.piSessionsDir;
	if (!configured) return defaultPiSessionsDir();
	const { homedir } = await import("node:os");
	const { resolve } = await import("node:path");
	return resolve(home, configured.replace(/^~(?=$|\/)/, homedir()));
}

const missing = (kind: string, value: string) => new MethodError("not_found", `Unknown ${kind}: ${value}`);

const defs: MethodDef[] = [
	define({
		name: "capabilities.get",
		scope: "read",
		params: noParams,
		since: 1,
		async handler(_params, ctx) {
			const info = await ctx.releaseInfo();
			const plugins = (await ctx.kernel.management({ action: "plugins.list" } as never)) as Array<{
				id: string;
				version?: string;
			}>;
			return {
				protocol: PROTOCOL,
				kind: ctx.principal.kind,
				version: { yonder: info.version, commit: info.origin?.commit ?? null },
				methods: registry.facts(ctx.principal),
				events: ["session.update", "activity.summary"],
				plugins: plugins.map((plugin) => ({ id: plugin.id, version: plugin.version ?? "", views: [] })),
				granted: ctx.principal.scopes,
				limits: { maxSubs: 64, attachmentMaxBytes: 0, transcriptPage: 50 },
				features: { requestIdDedupe: true, resumableWatch: true },
			};
		},
	}),
	define({
		name: "awake.status",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ctx.awakeStatus(),
	}),
	define({
		name: "channels.list",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ctx.kernel.channels.list(),
	}),
	define({
		name: "channels.login",
		scope: "admin",
		params: obj({}),
		since: 1,
		handler: async (params, ctx, signal) =>
			ctx.kernel.channels.login(params as Parameters<Kernel["channels"]["login"]>[0], signal),
	}),
	define({
		name: "release.result",
		scope: "admin",
		params: obj({ data: Type.Unknown() }),
		since: 1,
		handler: async (params, ctx) => ctx.kernel.releaseResult(params.data as Parameters<Kernel["releaseResult"]>[0]),
	}),
	define({
		name: "sessions.notify",
		scope: "write",
		params: obj({ id: text, event: text, text: Type.String() }),
		since: 1,
		handler: async (params, ctx) => ctx.kernel.notify(params.id, { event: params.event, text: params.text }),
	}),
	define({
		name: "management",
		scope: "admin",
		params: obj({}),
		since: 1,
		// SAFETY: management validates its own request shape; the registry only forwards the raw object.
		handler: async (params, ctx) => ctx.kernel.management(params as unknown as Parameters<Kernel["management"]>[0]),
	}),
	define({
		name: "terminal.sessions",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ctx.kernel.terminal.list(),
	}),
	define({
		name: "terminal.presets",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ctx.kernel.terminal.presets(),
	}),
	define({
		name: "terminal.channels",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ctx.kernel.terminal.channels(),
	}),
	define({
		name: "terminal.queued",
		scope: "read",
		params: id,
		since: 1,
		handler: async (p, ctx) => ctx.kernel.terminal.queued(p.id),
	}),
	define({
		name: "terminal.dequeue",
		scope: "write",
		params: id,
		since: 1,
		handler: async (p, ctx) => ctx.kernel.terminal.queued(p.id, true),
	}),
	define({
		name: "terminal.info",
		scope: "read",
		params: id,
		since: 1,
		handler: async (p, ctx) => ctx.kernel.terminal.info(p.id),
	}),
	define({
		name: "service.info",
		scope: "read",
		local: true,
		params: noParams,
		since: 1,
		async handler(_p, ctx) {
			const info = await ctx.releaseInfo();
			return {
				version: info.version,
				commit: info.origin?.commit ?? null,
				home: ctx.home,
				pid: process.pid,
				ready: true,
				active: (await ctx.kernel.awakeActivity()).active,
				agents: await ctx.kernel.terminal.activity(),
			};
		},
	}),
	define({
		name: "sessions.command",
		scope: "write",
		params: obj({ id: text, command: text }),
		since: 1,
		handler: async (p, ctx) => ctx.kernel.sessions.command(p.id, p.command),
	}),
	define({
		name: "sessions.open",
		scope: "write",
		params: obj({
			preset: text,
			close: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("run-end")])),
			parent: Type.Optional(text),
		}),
		since: 1,
		handler: async (p, ctx) =>
			ctx.kernel.sessions.open({
				preset: p.preset,
				...(p.close ? { close: p.close } : {}),
				...(p.parent ? { parent: p.parent } : {}),
			}),
	}),
	define({
		name: "sessions.submit",
		scope: "write",
		params: obj({
			id: text,
			text: Type.String(),
			requestId: Type.Optional(text),
			attachments: Type.Optional(Type.Array(Type.Unknown())),
			busy,
		}),
		since: 1,
		async handler(p, ctx) {
			const run = () =>
				ctx.kernel.terminal.submit(
					p.id,
					{ text: p.text, ...(p.attachments ? { attachments: p.attachments as Attachment[] } : {}) },
					p.busy,
				);
			return p.requestId ? dedupe(p.id, p.requestId, run) : run();
		},
	}),
	define({
		name: "bots.list",
		scope: "owner",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ({ bots: await ctx.kernel.bots.list() }),
	}),
	define({
		name: "bots.send",
		scope: "owner",
		params: obj({ agent: text, text, requestId: Type.Optional(text) }),
		since: 1,
		async handler(p, ctx) {
			const run = () => ctx.kernel.bots.send(p.agent, p.text);
			return p.requestId ? dedupe(`bot:${p.agent}`, p.requestId, run) : run();
		},
	}),
	define({
		name: "sessions.watch",
		scope: "read",
		params: id,
		since: 1,
		stream: {
			type: "session.update",
			resumable: true,
			legacyFrame: (params, update) => ({ type: "update", session: params.id, update }),
		},
		async handler(p, ctx, signal, emit) {
			await guardSession(ctx, p.id);
			const info = await ctx.kernel.terminal.info(p.id);
			const dispose = await ctx.kernel.terminal.observe(p.id, async (update) => emit(update));
			if (signal.aborted) await dispose();
			else signal.addEventListener("abort", () => void dispose(), { once: true });
			return info;
		},
	}),
	define({
		name: "sessions.list",
		scope: "read",
		params: obj({ filter: Type.Optional(Type.Unknown()) }),
		since: 1,
		async handler(p, ctx) {
			const rows = await ctx.kernel.sessions.list((p.filter ?? {}) as Parameters<Kernel["sessions"]["list"]>[0]);
			return ownsBots(ctx) ? rows : rows.filter((row) => row.mode === "task");
		},
	}),
	define({
		name: "sessions.show",
		scope: "read",
		params: obj({ id: text, include: Type.Optional(Type.Union([Type.Literal("meta"), Type.Literal("transcript")])) }),
		since: 1,
		async handler(p, ctx) {
			const session = await ctx.kernel.sessions.get(p.id);
			if (!session) throw missing("session", p.id);
			await guardSession(ctx, p.id, session);
			// v1 keeps the transcript by default; `include:"meta"` is the slim form that becomes the default in v2.
			if (p.include === "meta") return { session, info: await ctx.kernel.terminal.info(p.id) };
			return { session, transcript: await ctx.kernel.sessions.transcript(p.id) };
		},
	}),
	define({
		name: "sessions.transcript",
		scope: "read",
		params: obj({
			id: text,
			before: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
		}),
		since: 1,
		async handler(p, ctx) {
			const session = await ctx.kernel.sessions.get(p.id);
			if (!session) throw missing("session", p.id);
			await guardSession(ctx, p.id, session);
			const limit = p.limit ?? 50;
			const rows = await ctx.kernel.sessions.transcript(p.id, {
				before: p.before ?? Number.MAX_SAFE_INTEGER,
				limit: limit + 1,
			});
			const hasMore = rows.length > limit;
			return { items: hasMore ? rows.slice(1) : rows, hasMore };
		},
	}),
	define({
		name: "sessions.abort",
		scope: "write",
		params: id,
		since: 1,
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			await ctx.kernel.sessions.abort(p.id);
			return { ok: true };
		},
	}),
	define({
		name: "sessions.close",
		scope: "write",
		params: id,
		since: 1,
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			await ctx.kernel.sessions.close(p.id);
			return { ok: true };
		},
	}),
	define({
		name: "activity.summary",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => activitySummary(ctx.kernel),
	}),
	define({
		name: "activity.watch",
		scope: "read",
		params: noParams,
		since: 1,
		stream: {
			type: "activity.summary",
			resumable: false,
			legacyFrame: (_params, update) => ({ type: "update", update }),
		},
		async handler(_p, ctx, signal, emit) {
			const first = await activitySummary(ctx.kernel);
			let last = JSON.stringify(first);
			const timer = setInterval(() => {
				void activitySummary(ctx.kernel)
					.then(async (next) => {
						const encoded = JSON.stringify(next);
						if (encoded === last || signal.aborted) return;
						last = encoded;
						await emit(next);
					})
					.catch(() => {});
			}, 2000);
			signal.addEventListener("abort", () => clearInterval(timer), { once: true });
			return first;
		},
	}),
	define({
		name: "events.query",
		scope: "read",
		params: obj({ query: Type.Optional(Type.Unknown()) }),
		since: 1,
		handler: async (p, ctx) => ctx.kernel.events.query((p.query ?? {}) as EventQuery),
	}),
	define({
		name: "identity.lookup",
		scope: "read",
		params: obj({ ref: text }),
		since: 1,
		handler: async (p, ctx) => ctx.kernel.identity.lookup(p.ref),
	}),
	define({
		name: "identity.link",
		scope: "admin",
		params: obj({ account: text, person: text }),
		since: 1,
		handler: async (p, ctx) => ctx.kernel.identity.link(p.account, p.person).then(() => ({ ok: true })),
	}),
	define({
		name: "identity.unlink",
		scope: "admin",
		params: obj({ account: text }),
		since: 1,
		handler: async (p, ctx) => ctx.kernel.identity.unlink(p.account).then(() => ({ ok: true })),
	}),
	define({
		name: "identity.person",
		scope: "admin",
		params: obj({ person: obj({ id: text, name: text, note: Type.Optional(Type.String()) }) }),
		since: 1,
		handler: async (p, ctx) =>
			ctx.kernel.identity.createPerson({
				id: p.person.id,
				name: p.person.name,
				...(typeof p.person.note === "string" ? { note: p.person.note } : {}),
			}),
	}),
	define({
		name: "imports.list",
		scope: "read",
		params: obj({
			cwd: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
		}),
		since: 1,
		handler: async (p, ctx) =>
			listPiSessions(await importsDir(ctx.home), {
				...(p.cwd === undefined ? {} : { cwd: p.cwd }),
				...(p.limit === undefined ? {} : { limit: p.limit }),
			}),
	}),
	define({
		name: "imports.show",
		scope: "read",
		params: obj({
			id: text,
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
		}),
		since: 1,
		async handler(p, ctx) {
			try {
				return await showPiSession(await importsDir(ctx.home), p.id, {
					...(p.offset === undefined ? {} : { offset: p.offset }),
					...(p.limit === undefined ? {} : { limit: p.limit }),
				});
			} catch (error) {
				if ((error as { code?: string }).code === "not_found")
					throw new MethodError("not_found", (error as Error).message);
				throw error;
			}
		},
	}),
	define({
		name: "gateway.ticket",
		scope: "admin",
		local: true,
		params: noParams,
		since: 1,
		async handler(_p, ctx) {
			if (!ctx.gateway) throw new MethodError("unavailable", "gateway is not running");
			return ctx.gateway.ticket();
		},
	}),
	define({
		name: "stop",
		scope: "admin",
		local: true,
		params: noParams,
		since: 1,
		async handler(_p, ctx) {
			setImmediate(() => ctx.stop());
			return { stopping: true };
		},
	}),
];

export interface MethodFacts {
	scope: Scope;
	stream?: true;
	local?: true;
	since: number;
}

export const registry = {
	get: (name: string) => defs.find((def) => def.name === name),
	list: () => defs,
	/** Methods visible to a principal: granted scope only, and no `local` method off the control socket. */
	facts(principal: Principal): Record<string, MethodFacts> {
		return Object.fromEntries(
			defs
				.filter((def) => principal.scopes.includes(def.scope) && (!def.local || principal.transport === "socket"))
				.map((def) => [
					def.name,
					{
						scope: def.scope,
						...(def.stream ? { stream: true as const } : {}),
						...(def.local ? { local: true as const } : {}),
						since: def.since,
					},
				]),
		);
	},
	/** Look up, authorise and validate; throws MethodError. Does not run the handler. */
	prepare(name: string, params: unknown, principal: Principal): MethodDef {
		const def = registry.get(name);
		if (!def) throw new MethodError("unknown_method", `unknown control method: ${name}`);
		if ((def.local && principal.transport !== "socket") || !principal.scopes.includes(def.scope))
			throw new MethodError("forbidden", `${name} requires ${def.local ? "a local connection" : `${def.scope} scope`}`);
		const errors = Errors(def.params, params);
		if (errors.length)
			throw new MethodError(
				"invalid_params",
				errors.map((error) => `${error.instancePath || "/"}: ${error.message}`).join("; "),
			);
		return def;
	},
	async call(
		name: string,
		params: unknown,
		ctx: HostCtx,
		signal: AbortSignal,
		emit: (value: unknown) => Promise<void> = async () => {},
	): Promise<unknown> {
		const def = registry.prepare(name, params ?? {}, ctx.principal);
		return def.handler(params ?? {}, ctx, signal, emit);
	},
};

export const socketPrincipal: Principal = { id: "socket", transport: "socket", kind: "local", scopes: allScopes };

/** control.sock handler: same wire format as before, dispatching through the registry. */
export function controlHandler(host: Omit<HostCtx, "principal">): ControlHandler {
	return async (request, connection) => {
		const params = (request.params ?? {}) as Record<string, unknown>;
		const def = registry.get(request.method);
		const legacy = def?.stream?.legacyFrame;
		// Spread per request: the daemon attaches `gateway` after the socket is already serving.
		const ctx: HostCtx = { ...host, principal: socketPrincipal };
		return registry.call(request.method, params, ctx, connection.signal, async (value) =>
			connection.send(legacy ? legacy(params, value) : value),
		);
	};
}
