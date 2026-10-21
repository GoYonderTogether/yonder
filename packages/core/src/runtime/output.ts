import type { AgentEvent } from "@earendil-works/pi-durable";
import type { RuntimeInput } from "./types.js";

export function projectOutput(event: AgentEvent, input: RuntimeInput, textBlocks: Map<number, string>) {
	const text = (index: number, value: string) => {
		const previous = textBlocks.get(index) ?? "";
		textBlocks.set(index, value);
		const delta = value.startsWith(previous) ? value.slice(previous.length) : value;
		if (delta) input.onOutput?.({ type: "text", delta });
	};
	const content = (blocks: Array<{ type: string; text?: string }>) =>
		blocks.forEach((block, index) => {
			if (block.type === "text") text(index, block.text ?? "");
		});
	if (event.type === "message_start" && event.message.role === "assistant") {
		input.onOutput?.({ type: "message_start", id: String(event.message.timestamp) });
		textBlocks.clear();
		content(event.message.content);
	}
	if (event.type === "message_end")
		for (const message of event.entry.model ?? [])
			if (message.role === "assistant") {
				if (message.stopReason !== "aborted") content(message.content);
				input.onOutput?.({
					type: "message_end",
					text:
						message.stopReason === "aborted"
							? ""
							: message.content
									.filter((block) => block.type === "text")
									.map((block) => block.text)
									.join(""),
				});
			}
	if (event.type === "message_update")
		for (const change of event.changes) {
			if (change.type === "text_delta")
				text(change.contentIndex, (textBlocks.get(change.contentIndex) ?? "") + change.delta);
			else if (change.type === "message") content(change.message.content);
			else if ((change.type === "text_start" || change.type === "block") && change.block?.type === "text")
				text(change.contentIndex, change.block.text);
		}
	if (event.type === "tool_execution_start") input.onOutput?.({ type: "tool", phase: "start", name: event.toolName });
	if (event.type === "tool_execution_end")
		input.onOutput?.({
			type: "tool",
			phase: "end",
			name: event.toolName,
			ok: event.result
				? !event.result.isError
				: event.entry
					? !event.entry.model?.some((m) => m.role === "toolResult" && m.isError)
					: false,
		});
	if (event.type === "task_failed") input.onOutput?.({ type: "error", message: event.message });
}

export function imageData(uri: string): string {
	const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri);
	if (!match?.[1]) throw new Error("Image data URI must contain base64 data");
	return match[1];
}
