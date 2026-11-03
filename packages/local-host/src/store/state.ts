import type { BudgetFacts, NotificationStore } from "@yonder/bot-core/store/state";
import type { Db } from "@yonder/runtime-adapter/contracts";

export function notificationStore(db: Db): NotificationStore {
	return {
		list: () => db.all("SELECT key,value FROM y_meta WHERE key LIKE 'notification.pref:%'"),
		async set(key, value) {
			if (value === null) await db.run("DELETE FROM y_meta WHERE key=?", key);
			else await db.run("INSERT OR REPLACE INTO y_meta(key,value) VALUES(?,?)", key, value);
		},
	};
}
export function budgetStore(db: Db) {
	return {
		async read(session: string): Promise<BudgetFacts> {
			const sum = await db.get<{ tokens: number; runs: number; first: string | null }>(
				`SELECT COALESCE(SUM(json_extract(data,'$.usage.input')+json_extract(data,'$.usage.output')),0) AS tokens,
				COUNT(*) AS runs,MIN(ts) AS first FROM y_events WHERE type='run.end' AND json_extract(data,'$.session')=?`,
				session,
			);
			const opened = await db.get<{ opened: string }>("SELECT opened FROM y_sessions WHERE id=?", Number(session));
			const rows = await db.all<{ data: string }>(
				"SELECT data FROM y_events WHERE type='budget.exceeded' AND json_extract(data,'$.session')=?",
				session,
			);
			const seen = rows.flatMap(({ data }) => {
				try {
					const kind = JSON.parse(data).kind;
					return typeof kind === "string" ? [kind] : [];
				} catch {
					return [];
				}
			});
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
