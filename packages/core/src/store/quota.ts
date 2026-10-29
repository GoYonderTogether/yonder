import type { Db } from "../runtime/db.js";

/** 账本里一天一格：`day` 是主人时区下的 `YYYY-MM-DD`，`scope`+`key` 是被计量的对象（IMP-19）。 */
export type QuotaScope = "guest_qr" | "guest_rounds" | "guest_source" | "owner" | "person";

export interface QuotaCounters {
	tokens: number;
	rounds: number;
}

// 账本表在第一次使用时建好：旧库不需要迁移，没有外人用量时不产生任何行。
const DDL = `CREATE TABLE IF NOT EXISTS y_quota_days (
	day TEXT NOT NULL,
	scope TEXT NOT NULL,
	key TEXT NOT NULL,
	tokens INTEGER NOT NULL DEFAULT 0,
	rounds INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, scope, key)
)`;

/** 外人额度账本的持久化：只做当天累加与读取，判定留在 `kernel/quota.ts`。 */
export function quotaStore(db: Db) {
	const ready = db.exec(DDL);
	const count = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
	return {
		async add(day: string, scope: QuotaScope, key: string, tokens: number, rounds = 0) {
			await ready;
			await db.run(
				`INSERT INTO y_quota_days (day, scope, key, tokens, rounds) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(day, scope, key) DO UPDATE SET tokens = tokens + excluded.tokens, rounds = rounds + excluded.rounds`,
				day,
				scope,
				key,
				count(tokens),
				count(rounds),
			);
		},
		async get(day: string, scope: QuotaScope, key: string): Promise<QuotaCounters> {
			await ready;
			const row = await db.get<{ rounds: number; tokens: number }>(
				"SELECT tokens, rounds FROM y_quota_days WHERE day = ? AND scope = ? AND key = ?",
				day,
				scope,
				key,
			);
			return { tokens: row?.tokens ?? 0, rounds: row?.rounds ?? 0 };
		},
	};
}
export type QuotaStore = ReturnType<typeof quotaStore>;
