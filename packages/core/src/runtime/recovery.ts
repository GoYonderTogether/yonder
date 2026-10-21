import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import { GenerationTask, type Harness, hook, InboxDoc, LiveDoc } from "@earendil-works/pi-durable";
import { RunDoc } from "./docs.js";

// Native checkpoints own both the retry budget and the backoff across restarts.
export const RETRY_POLICY = { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
export const RESTART_NOTICE =
	"Task interrupted by restart. Re-check state, avoid repeating completed actions, and resume.";
const NETWORK_NOTICE =
	"Connection to the model interrupted. Re-check state, avoid repeating completed actions, and resume.";

export function transientModelError(message: Pick<AssistantMessage, "stopReason" | "errorMessage">): boolean {
	if (message.stopReason !== "error" || isContextOverflow(message as AssistantMessage)) return false;
	const text = message.errorMessage ?? "";
	if (
		/\b4(?!08\b|29\b)\d{2}\b|auth|api.?key|credential|permission|schema|invalid.?request|context|token.?limit|quota|billing|budget|abort|repeatStop/i.test(
			text,
		)
	)
		return false;
	return (
		/\b5\d\d\b|ECONNRESET|ECONNREFUSED|EPIPE/i.test(text) || isRetryableAssistantError(message as AssistantMessage)
	);
}

export function recoveryHooks(harness: () => Harness) {
	return [
		hook(GenerationTask, {
			beforeRequest: async (request, api, context) => {
				// A recovered request has a pinned cutoff. Pending write notes must
				// also reach that request, before pi places them at its next boundary.
				const inbox = await api.snapshot(InboxDoc, api.conversationId, context);
				const notes = (inbox?.items ?? []).flatMap((item) =>
					item.mode === "write" && item.entry.kind === "yonder.runtime-note" ? (item.entry.model ?? []) : [],
				);
				if (notes.length) return { messages: [...request.messages, ...(notes as unknown as Message[])] };
			},
			shouldRetry: (message) => transientModelError(message),
			afterResponse: async (message, api, context) => {
				const live = await api.snapshot(LiveDoc, api.conversationId, context);
				if (!live?.run) return;
				const retry = transientModelError(message) && (live.generation?.attempt ?? 1) <= RETRY_POLICY.maxRetries;
				if (message.stopReason === "error" && !retry) return;
				await harness().commit(async (tx) => {
					const state = await tx.doc(RunDoc, api.conversationId, String(live.run!.inputs[0]), null);
					if (retry && !state.networkInterrupted) {
						await tx.appendEntry(api.conversationId, {
							kind: "yonder.runtime-note",
							data: { from: "system:yonder", text: NETWORK_NOTICE },
							model: [{ role: "user", content: [{ type: "text", text: NETWORK_NOTICE }], timestamp: Date.now() }],
						});
					}
					state.networkInterrupted = retry;
				}, context);
			},
		}),
	];
}
