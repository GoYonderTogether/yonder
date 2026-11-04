import type { RuntimeActivityExecution } from "./types.js";

/** Normal execution wins over concurrent retry; input waiting wins over settled issues. */
export function aggregateExecution(rows: readonly RuntimeActivityExecution[]): RuntimeActivityExecution {
	for (const phase of ["running", "retrying", "waiting-input", "blocked"] as const) {
		const current = rows.find((row) => row.phase === phase);
		if (current) return current;
	}
	return { phase: "idle" };
}
