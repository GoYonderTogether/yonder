import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import type { Kernel } from "../kernel/index.js";

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

export const activityMethods: MethodDef[] = [
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
];
