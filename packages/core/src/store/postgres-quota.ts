import type { Pool, PoolClient } from "pg";
import type { QuotaStore } from "./quota.js";

export function postgresQuota(db: Pool | PoolClient, tenant: string, bot: string): QuotaStore {
	const count = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
	return {
		async add(day, scope, key, tokens, rounds = 0) {
			await db.query(
				`INSERT INTO bot_quota_days VALUES($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT(tenant_id,bot_id,day,scope,key) DO UPDATE SET tokens=bot_quota_days.tokens+excluded.tokens,rounds=bot_quota_days.rounds+excluded.rounds`,
				[tenant, bot, day, scope, JSON.stringify(key), count(tokens), count(rounds)],
			);
		},
		async get(day, scope, key) {
			const row = (
				await db.query<{ tokens: string; rounds: string }>(
					"SELECT tokens,rounds FROM bot_quota_days WHERE tenant_id=$1 AND bot_id=$2 AND day=$3 AND scope=$4 AND key=$5",
					[tenant, bot, day, scope, JSON.stringify(key)],
				)
			).rows[0];
			return { tokens: Number(row?.tokens ?? 0), rounds: Number(row?.rounds ?? 0) };
		},
	};
}
