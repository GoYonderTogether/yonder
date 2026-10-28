import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import { guardSession, visibleSessionFilter } from "./guard.js";
import { type HostCtx, MethodError } from "./method-types.js";

async function activitySummary(ctx: HostCtx) {
	const agents = await ctx.kernel.terminal.activity();
	const visible = await visibleSessionFilter(ctx);
	const all = agents.flatMap((agent) =>
		agent.tasks.map((task) => ({ id: task.id, agent: agent.id, state: task.state })),
	);
	const sessions = visible ? [] : all;
	if (visible) for (const row of all) if (await visible(row.id)) sessions.push(row);
	return {
		running: sessions.filter((row) => row.state === "running").length,
		waiting: sessions.filter((row) => row.state === "waiting").length,
		sessions,
	};
}

export const activityMethods: MethodDef[] = [
	define({
		name: "sessions.trace",
		scope: "read",
		params: obj({ id: Type.String({ minLength: 1 }), after: Type.Optional(Type.String({ minLength: 1 })) }),
		since: 1,
		async handler(p, ctx) {
			const session = await ctx.kernel.sessions.get(p.id);
			if (!session) throw new MethodError("not_found", `Unknown session: ${p.id}`);
			await guardSession(ctx, p.id, session);
			const page = await ctx.kernel.events.query({ ...(p.after ? { after: p.after } : {}), limit: 100 });
			const events = [];
			for (const event of page.events) {
				const data = event.data as Record<string, unknown>;
				let belongs = data.session === p.id || event.routes?.some((route) => route.session === p.id);
				if (event.type === "message.unknown" && typeof data.attempt === "string") {
					const attempt = (await ctx.kernel.events.query({ id: data.attempt })).events[0];
					belongs = attempt?.type === "message.attempt" && (attempt.data as Record<string, unknown>).session === p.id;
				}
				if (!belongs) continue;
				try {
					const ids = (event.routes ?? []).flatMap((route) => (route.session ? [route.session] : []));
					if (typeof data.session === "string") ids.push(data.session);
					let known = true;
					for (const id of new Set(ids)) {
						const row = await ctx.kernel.sessions.get(id);
						if (!row) known = false;
						else await guardSession(ctx, id, row);
					}
					if (!known) continue;
					events.push(event);
				} catch (error) {
					if (!(error instanceof MethodError) || error.code !== "forbidden") throw error;
				}
			}
			return { events, ...(page.next ? { next: page.next } : {}) };
		},
	}),
	define({
		name: "activity.summary",
		scope: "read",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => activitySummary(ctx),
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
			const dispose = ctx.kernel.observeNotifications((notification) => {
				void guardSession(ctx, notification.session)
					.then(() => emit({ type: "event", name: "notification", data: notification }))
					.catch(() => {});
			});
			const first = await activitySummary(ctx);
			let last = JSON.stringify(first);
			const timer = setInterval(() => {
				void activitySummary(ctx)
					.then(async (next) => {
						const encoded = JSON.stringify(next);
						if (encoded === last || signal.aborted) return;
						last = encoded;
						await emit(next);
					})
					.catch(() => {});
			}, 2000);
			signal.addEventListener(
				"abort",
				() => {
					clearInterval(timer);
					dispose();
				},
				{ once: true },
			);
			return first;
		},
	}),
];
