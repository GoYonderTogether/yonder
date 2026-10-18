import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { AgentEvent, AgentEventStream, ConversationId, Harness } from "@earendil-works/pi-durable";
import { watchEvents } from "@earendil-works/pi-durable";

/** JSON-only view of native facts. No pi runtime object crosses the control boundary. */
export interface TerminalUpdate {
	type: "snapshot" | "message" | "tool" | "state" | "error" | "end" | "inbox";
	event?: object;
	id?: string;
	message?: object;
	messages?: Array<{ id: string; message: object }>;
	streaming?: boolean;
	running?: boolean;
	inputs?: string[];
	inbox?: Array<{ id: string; mode: string }>;
	tool?: { id: string; name: string; args?: object; phase: "start" | "update" | "end"; text?: string; result?: object };
	error?: string;
}

export async function observeTerminal(harness: Harness, id: string, send: (update: TerminalUpdate) => Promise<void>) {
	const stream: AgentEventStream = await watchEvents(harness, Number(id) as ConversationId, C);
	let currentId = "live";
	let partial: Extract<AgentEvent, { type: "message_start" }>["message"] | undefined;
	const clone = <T>(value: T): T => structuredClone(value);
	const message = async (entry: { id: number; model?: readonly object[] }) => {
		for (const [index, item] of (entry.model ?? []).entries()) {
			const id = `${entry.id}:${index}`;
			if ("role" in item && item.role === "assistant") currentId = id;
			await send({ type: "message", id, message: item, streaming: false });
		}
	};
	stream.start(async (events) => {
		for (const event of events) {
			if (event.type === "snapshot") {
				await send({
					type: "snapshot",
					messages: event.entries.flatMap((entry) =>
						(entry.model ?? []).map((message, index) => ({ id: `${entry.id}:${index}`, message })),
					),
					running: !!event.run,
					inputs: (event.run?.inputs ?? []).map(String),
					inbox: event.inbox.map((item) => ({ id: String(item.id), mode: item.mode })),
				});
				partial = event.generation?.message ? clone(event.generation.message) : undefined;
				if (partial) await send({ type: "message", id: currentId, message: partial, streaming: true });
			} else if (event.type === "message_start") {
				if (event.message.role === "assistant") {
					currentId = "live";
					partial = clone(event.message);
					await send({ type: "message", id: currentId, message: partial, streaming: true });
				}
			} else if (event.type === "message_update" && partial?.role === "assistant") {
				for (const change of event.changes) {
					if (change.type === "message") partial = clone(change.message);
					else if (
						change.type === "text_start" ||
						change.type === "thinking_start" ||
						change.type === "toolcall_start" ||
						change.type === "block"
					)
						partial.content[change.contentIndex] = clone(change.block);
					else if (change.type === "text_delta" || change.type === "thinking_delta") {
						const block = partial.content[change.contentIndex];
						if (block?.type === "text" && change.type === "text_delta") block.text += change.delta;
						if (block?.type === "thinking" && change.type === "thinking_delta") block.thinking += change.delta;
					}
				}
				partial.usage = clone(event.usage);
				await send({ type: "message", id: currentId, message: partial, streaming: true });
			} else if (event.type === "message_end") {
				await message(event.entry);
				partial = undefined;
			} else if (event.type === "entry_appended") {
				await message(event.entry);
			} else if (event.type === "tool_execution_start") {
				await send({
					type: "tool",
					tool: { id: event.toolCallId, name: event.toolName, args: event.args, phase: "start" },
				});
			} else if (event.type === "tool_execution_update" && event.output) {
				await send({
					type: "tool",
					tool: {
						id: event.toolCallId,
						name: event.toolName,
						phase: "update",
						text: "set" in event.output ? event.output.set : (event.output.append ?? ""),
					},
				});
			} else if (event.type === "tool_execution_end") {
				const result = event.result ?? event.entry?.model?.find((item) => item.role === "toolResult");
				await send({
					type: "tool",
					tool: { id: event.toolCallId, name: event.toolName, phase: "end", ...(result ? { result } : {}) },
				});
			} else if (event.type === "inbox_update") {
				await send({ type: "inbox", inbox: event.items.map((item) => ({ id: String(item.id), mode: item.mode })) });
			} else if (event.type === "run_start" || event.type === "run_end") {
				await send({ type: "state", running: event.type === "run_start", inputs: event.inputs.map(String) });
			} else if (event.type === "task_failed") await send({ type: "error", error: event.message });
		}
	});
	return async () => {
		await stream.stop();
	};
}
