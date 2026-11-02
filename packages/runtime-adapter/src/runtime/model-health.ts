export type ModelHealth = import("../contracts.js").RuntimeModelHealth;
export type ModelHealthRecord = {
	until: number;
	probeAt: number;
	reason: string;
	failures: number;
	resetUntil?: number;
};
