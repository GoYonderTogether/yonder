import { type createDelivery, sourceMessage } from "../delivery/index.js";
import type { Runtime } from "../runtime/index.js";
import type { RuntimeOptions } from "../runtime/types.js";
import type { createStore } from "../store/index.js";
import type { createViews } from "../views/index.js";

/** Runtime callbacks that turn background tool results and run warnings into recorded events and session notes. */
export function backgroundHandlers(ctx: {
	store: Awaited<ReturnType<typeof createStore>>;
	runtime: () => Runtime;
	delivery: ReturnType<typeof createDelivery>;
	report: (error: unknown) => void;
	views: ReturnType<typeof createViews>;
}): Pick<RuntimeOptions, "onBackground" | "onWarning" | "onBackgroundChanged"> {
	const { store, runtime: realRuntime, delivery } = ctx;
	return {
		onBackgroundChanged: () => ctx.views.invalidate("core", ["core.background.rail", "core.background.floating"]),
		onBackground: async (id, input) => {
			const row = await store.sessions.get(id);
			const origin = input.origin;
			const msgId = origin ? sourceMessage(origin) : undefined;
			const text = `[Background ${input.id} ${input.name} ${input.result.isError ? "failed" : "completed"}]\n${input.result.text.slice(-12000)}\nFull result: process status ${input.id}. Continue the original task if needed; do not repeat already completed work.`;
			const event = await store.events.record(
				{
					type: "runtime.tool-result",
					...(origin ? { parent: origin.id } : {}),
					...(origin?.conv ? { conv: origin.conv } : {}),
					data: {
						session: id,
						job: input.id,
						...(msgId ? { msgId } : {}),
						tool: input.name,
						text,
						waiting: false,
						status: input.result.isError ? "error" : "done",
					},
				},
				origin?.routes?.filter((route) => route.session === id) ?? [],
			);
			if (!row || row.closed) return;
			const onOutput = delivery.onStart(row, event, false);
			await realRuntime().enqueue(id, {
				text,
				event,
				wake: "run",
				busy: "steer",
				requestId: `background:${input.id}`,
				...(onOutput ? { onOutput } : {}),
				attachments: input.result.attachments ?? [],
			});
		},
		onWarning: async (id, input) => {
			const row = await store.sessions.get(id);
			const event = await store.events.record({
				type: "runtime.warning",
				data: { session: id, kind: input.kind, text: input.text },
			});
			for (const target of [id, ...(row?.parent ? [row.parent] : [])]) {
				const parent = await store.sessions.get(target);
				if (!parent || parent.closed) continue;
				const text = target === id ? input.text : `Subtask session ${id}: ${input.text}`;
				await realRuntime().notify(target, { event: event.id, from: "system:yonder", text });
				await realRuntime().writeNote(target, `warning:${event.id}:${target}`, text);
			}
		},
	};
}
