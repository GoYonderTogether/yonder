/** 账本里一天一格：`day` 是主人时区下的 `YYYY-MM-DD`，`scope`+`key` 是被计量的对象（IMP-19）。 */
export type QuotaScope = "guest_qr" | "guest_rounds" | "guest_source" | "owner" | "person";
export interface QuotaCounters {
	tokens: number;
	rounds: number;
}
/** 外人额度账本的持久化：只做当天累加与读取，判定留在 `kernel/quota.ts`。 */
export interface QuotaStore {
	add(day: string, scope: QuotaScope, key: string, tokens: number, rounds?: number): Promise<void>;
	get(day: string, scope: QuotaScope, key: string): Promise<QuotaCounters>;
}
