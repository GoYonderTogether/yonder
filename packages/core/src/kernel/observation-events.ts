import type { SessionUpdate } from "@yonder/sdk";
import type { Runtime } from "../runtime/index.js";
import type { TodoUpdatedEvent } from "../runtime/todo.js";
import type { ModelFallbackEvent } from "../runtime/types.js";
import type { Store } from "../store/index.js";

/** Terminal listeners per session; a run end and a recorded runtime event both fan out to them. */
export type TerminalSends = Map<string, Set<(update: import("../runtime/index.js").TerminalUpdate) => Promise<void>>>;

export function sessionObserver(store: Store, ends: TerminalSends, runtime: () => Runtime) {
	return async (id: string, send: (update: SessionUpdate) => Promise<void>) => {
		if (!(await store.sessions.get(id))) throw new Error(`Unknown session: ${id}`);
		const listeners = ends.get(id) ?? new Set();
		listeners.add(send);
		ends.set(id, listeners);
		try {
			const dispose = await runtime().observe(id, send);
			return async () => {
				listeners.delete(send);
				if (!listeners.size) ends.delete(id);
				await dispose();
			};
		} catch (error) {
			listeners.delete(send);
			if (!listeners.size) ends.delete(id);
			throw error;
		}
	};
}

/** Fan one update out to a session's terminal listeners; a failing listener must not block the others. */
export function terminalUpdates(ends: TerminalSends, report: (error: unknown) => void) {
	return (session: string, update: import("../runtime/index.js").TerminalUpdate) => {
		for (const send of ends.get(session) ?? []) void send(update).catch(report);
	};
}
/**
 * Runtime events that are both recorded and shown to session observers (contracts §3.3, §3.4). Recording comes
 * first; the observer copy is the same payload, so `sessions.watch` clients see what `events.query` returns.
 */
export function observedRuntimeEvents(
	store: Store,
	forward: (session: string, update: SessionUpdate) => void,
	modelNotice?: (event: ModelFallbackEvent) => void,
) {
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
		onModelFallback: async (event: ModelFallbackEvent) => {
			await record("model.fallback", event.session, event);
			modelNotice?.(event);
		},
		onTodo: (event: TodoUpdatedEvent) => record("todo.updated", event.session, event),
	};
}
