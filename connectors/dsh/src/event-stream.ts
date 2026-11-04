import type { HarnessMessage, HarnessUpdate } from "./adapter.js";
import { harnessMessage, harnessUpdates } from "./adapter.js";

/** The two `sessionController.follow` shapes this module consumes. */
export interface FollowSource {
	follow(request: { address: { kind: "session"; sessionId: string } }, signal: AbortSignal): AsyncIterable<FollowFrame>;
}

export interface FollowEvent {
	seq: number;
	type: string;
	time: number;
	data: unknown;
}

export type FollowFrame =
	| { type: "snapshot"; cursor: number; records: Array<{ event: FollowEvent }> }
	| { type: "event"; event: FollowEvent }
	| { type: "assistant-stream"; frame: { type: string; chunk?: unknown } };

/**
 * Follow one DSH session and hand its events over as gateway-shaped updates.
 * Streaming text arrives as `assistant-stream` chunks; committed events arrive as
 * `event` frames. Closing the returned function removes the follow subscription but
 * never cancels the harness turn (spec 23 §2.4).
 */
export async function watchEvent(
	source: FollowSource,
	sessionId: string,
	onUpdate: (update: HarnessUpdate) => void,
	signal: AbortSignal,
): Promise<() => Promise<void>> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener("abort", abort, { once: true });
	const frames = source.follow({ address: { kind: "session", sessionId } }, controller.signal);
	let partial: HarnessMessage | undefined;
	let text = "";
	const task = (async () => {
		try {
			for await (const frame of frames) {
				if (controller.signal.aborted) return;
				if (frame.type === "snapshot") {
					onUpdate({
						type: "snapshot",
						items: frame.records.flatMap((record) => {
							const message = harnessMessage((record.event.data as { message?: unknown } | undefined)?.message);
							return message ? [{ id: String(record.event.seq), message }] : [];
						}),
						messages: [],
						running: false,
						inbox: [],
					});
					continue;
				}
				if (frame.type === "assistant-stream") {
					const chunk = frame.frame.chunk as { type?: unknown; text?: unknown; blockType?: unknown } | undefined;
					if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
						text += chunk.text;
						partial = { role: "assistant", content: [{ type: "text", text }] };
						onUpdate({ type: "message", id: "live", message: partial, streaming: true });
					} else if (chunk?.type === "block-start" && chunk.blockType !== "text") {
						// A non-text block starts a new segment; the next text delta begins fresh.
						text = "";
						partial = undefined;
					}
					continue;
				}
				for (const update of harnessUpdates({
					sessionId,
					seq: frame.event.seq,
					type: frame.event.type,
					data: frame.event.data,
					time: frame.event.time,
				})) {
					if (update.type === "message" && update.id !== "live") {
						partial = undefined;
						text = "";
					}
					onUpdate(update);
				}
			}
		} catch {
			// The subscription ended (session closed, harness shutting down); the caller re-subscribes.
		}
	})();
	return async () => {
		signal.removeEventListener("abort", abort);
		controller.abort();
		await task.catch(() => {});
	};
}
