import type { Delivery, OutMessage } from "@yonder/sdk";
import type { Store } from "../store/index.js";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The delivery ledger: every attempt, confirmed output and unknown outcome is a durable event. */
export function createLedger(store: Store) {
	async function record(
		from: string | undefined,
		target: string,
		msg: OutMessage,
		delivery: Delivery,
		session?: string,
		parent?: string,
		attempt?: string,
		message?: string,
	) {
		await store.events.record({
			type: "message.out",
			...(from ? { from } : {}),
			...(target.startsWith("conv:") ? { conv: target } : {}),
			...(parent ? { parent } : {}),
			data: {
				...msg,
				...(session ? { session } : {}),
				to: target,
				delivery,
				...(attempt ? { attempt } : {}),
				...(message ? { message } : {}),
			},
		});
	}
	async function attempt(
		target: string,
		method: "send" | "stream",
		session?: string,
		parent?: string,
		runId?: string,
		message?: string,
		outgoing?: OutMessage,
		from?: string,
	): Promise<string | undefined> {
		return store.events.claimAttempt({
			type: "message.attempt",
			...(parent ? { parent } : {}),
			...(target.startsWith("conv:") ? { conv: target } : {}),
			data: {
				target,
				method,
				...(session ? { session } : {}),
				...(runId ? { runId } : {}),
				...(message ? { message } : {}),
				...(outgoing ? { outgoing } : {}),
				...(from ? { from } : {}),
			},
		});
	}
	async function unknown(id: string, error: unknown, partial?: Delivery): Promise<Delivery> {
		await store.events.record({
			type: "message.unknown",
			data: { attempt: id, reason: message(error), ...(partial?.id ? { id: partial.id } : {}) },
		});
		return { ...partial, ok: false, uncertain: true, error: `发送结果未知：${message(error)}；不会自动重发` };
	}
	return { attempt, record, unknown };
}
