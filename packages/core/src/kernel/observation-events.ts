import type { SessionUpdate } from "@yonder/sdk";
import type { TodoUpdatedEvent } from "../runtime/todo.js";
import type { ModelFallbackEvent } from "../runtime/types.js";
import type { Store } from "../store/index.js";

/**
 * Runtime events that are both recorded and shown to session observers (contracts §3.3, §3.4). Recording comes
 * first; the observer copy is the same payload, so `sessions.watch` clients see what `events.query` returns.
 */
export function observedRuntimeEvents(store: Store, forward: (session: string, update: SessionUpdate) => void) {
	const record = async (
		type: "model.fallback" | "todo.updated",
		session: string,
		data: ModelFallbackEvent | TodoUpdatedEvent,
	) => {
		const info = await store.sessions.get(session);
		await store.events.record({
			type,
			...(info?.agent ? { from: `agent:${info.agent}` as const } : {}),
			data,
		});
		forward(session, { type, session, event: data });
	};
	return {
		onModelFallback: (event: ModelFallbackEvent) => record("model.fallback", event.session, event),
		onTodo: (event: TodoUpdatedEvent) => record("todo.updated", event.session, event),
	};
}
