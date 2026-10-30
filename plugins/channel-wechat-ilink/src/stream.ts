import type { Delivery, OutMessage, OutputPart } from "@yonder/sdk";

export async function streamOutput(
	send: (target: string, message: OutMessage, signal?: AbortSignal) => Promise<Delivery>,
	target: string,
	output: AsyncIterable<OutputPart>,
	replyTo?: string,
	signal?: AbortSignal,
): Promise<Delivery> {
	let text = "";
	for await (const part of output) {
		signal?.throwIfAborted();
		if (part.type === "final") text = part.text;
	}
	if (!text.trim() || text.trim() === "NO_REPLY") return { ok: true };
	return send(target, { text, ...(replyTo ? { replyTo } : {}) }, signal);
}
