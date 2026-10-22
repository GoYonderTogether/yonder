import type { Models } from "@yonder/sdk";
import { type Decision, safeFallback, type Task, verifyDecision } from "./ledger.js";

export type AdminModelConfig = { provider: string; modelId: string };

/** Deliberately small model input: no task labels, conversation text, or event history. */
export type ObserverSnapshot = {
	executor: Task["executor"];
	accepted: Task["accepted"];
	delivery: Task["delivery"];
	pendingEvidenceIds: string[];
	quietUntil?: number;
	lastSent?: number;
};

export function observerSnapshot(task: Readonly<Task>): ObserverSnapshot {
	return {
		executor: task.executor,
		accepted: task.accepted,
		delivery: task.delivery,
		pendingEvidenceIds: [...task.pending],
		...(task.quietUntil === undefined ? {} : { quietUntil: task.quietUntil }),
		...(task.lastSent === undefined ? {} : { lastSent: task.lastSent }),
	};
}

const MAX_TOKENS = 256;
const TIMEOUT_MS = 8_000;

/** Model-only decision adapter; no tools, delivery, tick registration, or policy authority. */
export function createBoundedDecider(models: Models, adminModelConfig: AdminModelConfig) {
	return async (task: Readonly<Task>, now = Date.now()): Promise<Decision> => {
		const fallback = safeFallback(task as Task);
		const model = models.getModel(adminModelConfig.provider, adminModelConfig.modelId);
		if (model === undefined) return fallback;
		const snapshot = observerSnapshot(task);
		const controller = new AbortController();
		let rejectTimeout!: (reason: Error) => void;
		const timeout = new Promise<never>((_resolve, reject) => {
			rejectTimeout = reject;
		});
		const timer = setTimeout(() => {
			controller.abort();
			rejectTimeout(new Error("observer model timeout"));
		}, TIMEOUT_MS);
		try {
			const response = await Promise.race([
				models.completeSimple(
					model,
					{
						messages: [
							{
								role: "system",
								timestamp: now,
								content: [
									{
										type: "text",
										text: 'Return only a JSON object {"decision":"skip|update|notify|ask","evidence":[ids],"text":"..."}. Use only supplied pendingEvidenceIds; ask is forbidden. Do not invent evidence.',
									},
								],
							},
							{ role: "user", timestamp: now, content: [{ type: "text", text: JSON.stringify(snapshot) }] },
						],
					},
					{ maxTokens: MAX_TOKENS, signal: controller.signal },
				),
				timeout,
			]);
			if (controller.signal.aborted) return fallback;
			const text = response.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
			const parsed: unknown = JSON.parse(text);
			return verifyDecision(parsed, task as Task, now) ? (parsed as Decision) : fallback;
		} catch {
			return fallback;
		} finally {
			clearTimeout(timer);
		}
	};
}
