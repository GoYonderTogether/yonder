import Type, { type TSchema } from "typebox";
import type { Kernel } from "../kernel/index.js";
import { type HostCtx, type MethodDef, MethodError } from "./method-types.js";

const text = Type.String({ minLength: 1 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const id = obj({ id: text });
const missing = (kind: string, value: string) => new MethodError("not_found", `Unknown ${kind}: ${value}`);
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

/** sessions.* control methods (contracts §1, §10 remote isolation). */
export const sessionMethods: MethodDef[] = [
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
];
