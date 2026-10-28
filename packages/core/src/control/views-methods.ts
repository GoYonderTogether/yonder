import Type, { type TSchema } from "typebox";
import { guardSession } from "./guard.js";
import { type HostCtx, type MethodDef, MethodError } from "./method-types.js";
import { registry } from "./methods.js";

const text = Type.String({ minLength: 1 });
const filter = Type.Object({
	placement: Type.Optional(Type.Union([Type.Literal("rail"), Type.Literal("floating"), Type.Literal("page")])),
	session: Type.Optional(text),
});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	return def as unknown as MethodDef;
}

export async function visibleViews(
	ctx: HostCtx,
	params: { placement?: "rail" | "floating" | "page"; session?: string },
) {
	if (params.session) await guardSession(ctx, params.session);
	const methods = registry.facts(ctx.principal);
	return ctx.kernel.views
		.list(params)
		.filter((view) => [view.data ?? "views.data", ...(view.needs?.methods ?? [])].every((method) => method in methods));
}

async function viewCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (error instanceof Error && "code" in error && (error.code === "invalid_params" || error.code === "not_found"))
			throw new MethodError(error.code, error.message);
		throw error;
	}
}

export const viewsMethods: MethodDef[] = [
	define({
		name: "views.list",
		scope: "read",
		params: filter,
		since: 1,
		async handler(p, ctx) {
			return { views: await visibleViews(ctx, p) };
		},
	}),
	define({
		name: "views.data",
		scope: "read",
		since: 1,
		params: Type.Object({ viewId: text, session: Type.Optional(text) }),
		async handler(p, ctx) {
			if (p.session) await guardSession(ctx, p.session);
			if (!(await visibleViews(ctx, p)).some((v) => v.id === p.viewId))
				throw new MethodError("not_found", `Unknown view: ${p.viewId}`);
			return viewCall(() => ctx.kernel.views.data(p.viewId, p.session));
		},
	}),
	define({
		name: "views.act",
		scope: "write",
		since: 1,
		params: Type.Object({
			viewId: text,
			action: text,
			input: Type.Optional(Type.Unknown()),
			session: Type.Optional(text),
		}),
		async handler(p, ctx) {
			if (p.session) await guardSession(ctx, p.session);
			const view = (await visibleViews(ctx, p)).find((v) => v.id === p.viewId);
			if (!view) throw new MethodError("not_found", `Unknown view: ${p.viewId}`);
			if (!ctx.principal.scopes.includes(view.actScope ?? "write"))
				throw new MethodError("forbidden", "Insufficient view action scope");
			return viewCall(() => ctx.kernel.views.act(p.viewId, p.action, p.input, p.session));
		},
	}),
	define({
		name: "views.watch",
		scope: "read",
		params: filter,
		since: 1,
		stream: { type: "views.changed", resumable: false },
		async handler(p, ctx, signal, emit) {
			const views = await visibleViews(ctx, p);
			const iterator = ctx.kernel.views.watch(p);
			const stop = () => {
				void iterator.return?.();
			};
			if (signal.aborted) stop();
			else signal.addEventListener("abort", stop, { once: true });
			void (async () => {
				for await (const event of iterator) {
					const visible = new Set((await visibleViews(ctx, p)).map((view) => view.id));
					const ids = event.ids.filter((id) => visible.has(id));
					if (ids.length)
						await emit({
							...event,
							ids,
							...(event.badge
								? { badge: Object.fromEntries(Object.entries(event.badge).filter(([id]) => visible.has(id))) }
								: {}),
						});
				}
			})().catch(() => stop());
			return { views };
		},
	}),
];
