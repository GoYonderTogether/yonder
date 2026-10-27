import type { createDelivery } from "../delivery/index.js";
import type { RuntimeOptions } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import type { KernelLog } from "./workspace.js";

export interface KernelOptions {
	log?: KernelLog;
	/** Test-only timer injection; production runs keep the default interval. */
	test?: { heartbeatIntervalMs?: number };
}

/** Heartbeat wiring: the kernel resolves the session, delivery owns the deterministic beats. */
export function ticks(
	store: Store,
	delivery: ReturnType<typeof createDelivery>,
	test?: KernelOptions["test"],
): Pick<RuntimeOptions, "onTick" | "tickIntervalMs"> {
	return {
		tickIntervalMs: test?.heartbeatIntervalMs,
		onTick: async (id, run) => {
			const session = await store.sessions.get(id);
			if (session) return delivery.heartbeat(session, run, test?.heartbeatIntervalMs);
		},
	};
}
