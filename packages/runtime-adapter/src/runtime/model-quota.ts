export type ModelQuota = import("../contracts.js").RuntimeModelQuota;
export type QuotaWindow = { usedPercent: number; windowMinutes: number; resetsAt: number; updatedAt: number };

export const QUOTA_WINDOW_MINUTES = 300;
export function accountKey(provider: string, slot: string): string {
	return `${provider}@${slot}`;
}
