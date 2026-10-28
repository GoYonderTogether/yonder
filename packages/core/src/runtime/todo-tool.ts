import { defineTool } from "@earendil-works/pi-durable";
import { type OutboxEntry, SessionDoc } from "./docs.js";
import { applyTodo, emptyTodos, type TodoArgs, todoDescription, todoEvent, todoParameters } from "./todo.js";

/**
 * The session todo tool: one commit writes the list and the event it owes, then the outbox hands that event to
 * the host. `deliver` drains the session's outbox.
 */
export function todoTool(deliver: (session: string) => Promise<void>) {
	return defineTool({
		name: "todo",
		description: todoDescription,
		parameters: todoParameters,
		execute: async (args, api, context) => {
			const outcome = await api.commit(async (tx) => {
				const doc = await tx.doc(SessionDoc, api.conversationId);
				// SAFETY: pi-durable validated args against todoParameters, which TodoArgs mirrors.
				const result = applyTodo(doc.todos ?? emptyTodos(), args as unknown as TodoArgs);
				if (result.list) {
					doc.todos = result.list;
					doc.outbox = [
						...(doc.outbox ?? []),
						JSON.stringify({
							kind: "todo",
							data: todoEvent(String(api.conversationId), result.list),
						} satisfies OutboxEntry),
					];
				}
				return result;
			}, context);
			if (outcome.list) await deliver(String(api.conversationId));
			return { output: [{ type: "text", text: outcome.text }] };
		},
	});
}
