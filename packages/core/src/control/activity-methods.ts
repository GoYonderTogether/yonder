import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import { visibleSessionFilter } from "./guard.js";
import type { HostCtx } from "./method-types.js";

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
			signal.addEventListener("abort", () => clearInterval(timer), { once: true });
			return first;
		},
	}),
];
