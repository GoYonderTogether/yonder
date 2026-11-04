import type { BudgetFacts, NotificationStore } from "@yonder/bot-core/store/state";
import type { Pool } from "pg";

export function notificationStore(pool: Pool, tenant: string, bot: string): NotificationStore {
	return {
		async list() {
			return (
				await pool.query<{ key: string; value: string }>(
					"SELECT key,value FROM bot_notification_preferences WHERE tenant_id=$1 AND bot_id=$2",
					[tenant, bot],
				)
			).rows;
		},
		async set(key, value) {
			if (value === null)
				await pool.query("DELETE FROM bot_notification_preferences WHERE tenant_id=$1 AND bot_id=$2 AND key=$3", [
					tenant,
					bot,
					key,
				]);
			else
				await pool.query(
					"INSERT INTO bot_notification_preferences(tenant_id,bot_id,key,value) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,bot_id,key) DO UPDATE SET value=excluded.value",
					[tenant, bot, key, value],
				);
		},
	};
}
export function budgetStore(pool: Pool, tenant: string, bot: string) {
	return {
		async read(session: string): Promise<BudgetFacts> {
			const sum = (
				await pool.query<{ tokens: string; runs: string; first: string | null }>(
					`SELECT COALESCE(SUM((data->'usage'->>'input')::BIGINT+(data->'usage'->>'output')::BIGINT),0) AS tokens,COUNT(*) AS runs,MIN(ts) AS first FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='run.end' AND data->>'session'=$3`,
					[tenant, bot, session],
				)
			).rows[0];
			const opened = (
				await pool.query<{ opened: string }>(
					"SELECT opened FROM bot_sessions WHERE tenant_id=$1 AND bot_id=$2 AND id=$3",
					[tenant, bot, Number(session)],
				)
			).rows[0];
			const seen = (
				await pool.query<{ kind: string | null }>(
					"SELECT data->>'kind' AS kind FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='budget.exceeded' AND data->>'session'=$3",
					[tenant, bot, session],
				)
			).rows.flatMap(({ kind }) => (kind === null ? [] : [kind]));
			return {
				tokens: Number(sum?.tokens ?? 0),
				runs: Number(sum?.runs ?? 0),
				...(sum?.first ? { first: sum.first } : {}),
				...(opened ? { opened: opened.opened } : {}),
				seen,
			};
		},
	};
}
