import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const text = Type.String({ minLength: 1 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
const id = obj({ id: text });
const busy = Type.Optional(Type.Union([Type.Literal("followup"), Type.Literal("steer"), Type.Literal("interrupt")]));
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import type { Attachment, EventQuery } from "@yonder/sdk";
import { loadYonderConfig } from "../config/index.js";
import { defaultPiSessionsDir, listPiSessions, showPiSession } from "../imports/pi-sessions.js";
import type { Kernel } from "../kernel/index.js";
import { guardSession, ownsBots } from "./guard.js";
import { MethodError } from "./method-types.js";
import { dedupe } from "./submit-dedupe.js";

async function importsDir(home: string) {
	const configured = (await loadYonderConfig(home)).imports?.piSessionsDir;
	if (!configured) return defaultPiSessionsDir();
	const { homedir } = await import("node:os");
	const { resolve } = await import("node:path");
	return resolve(home, configured.replace(/^~(?=$|\/)/, homedir()));
}

export const legacyMethods: MethodDef[] = [
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
		params: obj({ shipped: Type.Optional(Type.Boolean()) }),
		since: 1,
		handler: async (p, ctx) => (p.shipped ? ctx.kernel.channels.shipped() : ctx.kernel.channels.list()),
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
		async handler(params, ctx) {
			await guardSession(ctx, params.id);
			return ctx.kernel.notify(params.id, { event: params.event, text: params.text });
		},
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
		async handler(_p, ctx) {
			const rows = await ctx.kernel.terminal.list();
			return ownsBots(ctx) ? rows : rows.filter((row) => row.mode === "task");
		},
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
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			return ctx.kernel.terminal.queued(p.id);
		},
	}),
	define({
		name: "terminal.dequeue",
		scope: "write",
		params: id,
		since: 1,
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			return ctx.kernel.terminal.queued(p.id, true);
		},
	}),
	define({
		name: "terminal.info",
		scope: "read",
		params: id,
		since: 1,
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			return ctx.kernel.terminal.info(p.id);
		},
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
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			return ctx.kernel.sessions.command(p.id, p.command);
		},
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
			await guardSession(ctx, p.id);
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
		name: "events.query",
		scope: "read",
		params: obj({ query: Type.Optional(Type.Unknown()) }),
		since: 1,
		async handler(p, ctx) {
			const query = (p.query ?? {}) as EventQuery;
			const page = await ctx.kernel.events.query(query);
			if (ownsBots(ctx)) return page;
			// Without owner scope only events belonging to task sessions are returned (contracts §14.3).
			const events = [];
			for (const event of page.events) {
				const ids = (event.routes ?? []).map((route) => route.session).filter((id) => id !== undefined);
				if ("session" in event.data && typeof event.data.session === "string") ids.push(event.data.session);
				if (!ids.length) continue;
				try {
					let known = true;
					for (const id of new Set(ids)) {
						const session = await ctx.kernel.sessions.get(id);
						if (!session) {
							known = false;
							continue;
						}
						await guardSession(ctx, id, session);
					}
					if (known) events.push(event);
				} catch (error) {
					if (!(error instanceof MethodError) || error.code !== "forbidden" || query.id) throw error;
				}
			}
			return { ...page, events };
		},
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
