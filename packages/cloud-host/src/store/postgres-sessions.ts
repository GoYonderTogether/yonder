import { type SessionRow, type SessionStore, sessionRow } from "@yonder/bot-core/store/sessions";
import type { Pool } from "pg";

export function postgresSessions(pool: Pool, tenant: string, bot: string): SessionStore {
	return {
		async put(session) {
			await pool.query(
				`INSERT INTO bot_sessions(tenant_id,bot_id,id,agent,profile,mode,key,parent,version,opened,closed,owner,archived_at,pinned,needs_owner,title,channels)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
				[
					tenant,
					bot,
					Number(session.id),
					session.agent,
					session.profile,
					session.mode,
					session.key,
					session.parent ? Number(session.parent) : null,
					session.version,
					session.opened,
					session.closed ?? null,
					session.owner ? JSON.stringify(session.owner) : null,
					session.archivedAt ?? null,
					session.pinned ? 1 : 0,
					session.needsOwner ? JSON.stringify(session.needsOwner) : null,
					session.title ?? null,
					session.channels ? JSON.stringify(session.channels) : null,
				],
			);
			return session;
		},
		async get(id) {
			const row = (
				await pool.query<SessionRow>("SELECT * FROM bot_sessions WHERE tenant_id=$1 AND bot_id=$2 AND id=$3", [
					tenant,
					bot,
					id,
				])
			).rows[0];
			return (
				row &&
				sessionRow({
					...row,
					id: Number(row.id),
					parent: row.parent === null ? null : Number(row.parent),
					archived_at: row.archived_at === null ? null : Number(row.archived_at),
				})
			);
		},
		async find(agent, key) {
			const row = (
				await pool.query<SessionRow>(
					"SELECT * FROM bot_sessions WHERE tenant_id=$1 AND bot_id=$2 AND agent IS NOT DISTINCT FROM $3 AND key=$4 AND closed IS NULL",
					[tenant, bot, agent, key],
				)
			).rows[0];
			return (
				row &&
				sessionRow({
					...row,
					id: Number(row.id),
					parent: row.parent === null ? null : Number(row.parent),
					archived_at: row.archived_at === null ? null : Number(row.archived_at),
				})
			);
		},
		async list(filter = {}) {
			const clauses = ["tenant_id=$1", "bot_id=$2"];
			const values: unknown[] = [tenant, bot];
			const add = (field: string, value: unknown) => {
				values.push(value);
				clauses.push(`${field}=$${values.length}`);
			};
			if (filter.agent !== undefined) add("agent", filter.agent);
			if (filter.mode) add("mode", filter.mode);
			if (filter.open !== undefined) clauses.push(`closed IS ${filter.open ? "" : "NOT "}NULL`);
			clauses.push(`archived_at IS ${filter.archived ? "NOT " : ""}NULL`);
			if (filter.pinned !== undefined) add("pinned", filter.pinned ? 1 : 0);
			return (
				await pool.query<SessionRow>(`SELECT * FROM bot_sessions WHERE ${clauses.join(" AND ")} ORDER BY id`, values)
			).rows.map((row) =>
				sessionRow({
					...row,
					id: Number(row.id),
					parent: row.parent === null ? null : Number(row.parent),
					archived_at: row.archived_at === null ? null : Number(row.archived_at),
				}),
			);
		},
		async update(id, patch) {
			const columns = {
				owner: "owner",
				archivedAt: "archived_at",
				pinned: "pinned",
				needsOwner: "needs_owner",
				title: "title",
				channels: "channels",
				parent: "parent",
			} as const;
			const json = new Set(["owner", "needsOwner", "channels"]);
			const values: unknown[] = [tenant, bot, id];
			const fields: string[] = [];
			for (const key of Object.keys(columns) as Array<keyof typeof columns>) {
				if (!(key in patch)) continue;
				const value = patch[key];
				values.push(
					key === "pinned"
						? value
							? 1
							: 0
						: value == null
							? null
							: json.has(key)
								? JSON.stringify(value)
								: key === "parent"
									? value
										? Number(value)
										: null
									: value,
				);
				fields.push(`${columns[key]}=$${values.length}`);
			}
			if (fields.length)
				await pool.query(
					`UPDATE bot_sessions SET ${fields.join(",")} WHERE tenant_id=$1 AND bot_id=$2 AND id=$3`,
					values,
				);
		},
		close: async (id) => {
			await pool.query(
				"UPDATE bot_sessions SET closed=$4 WHERE tenant_id=$1 AND bot_id=$2 AND id=$3 AND closed IS NULL",
				[tenant, bot, id, new Date().toISOString()],
			);
		},
		setVersion: async (id, version) => {
			await pool.query("UPDATE bot_sessions SET version=$4 WHERE tenant_id=$1 AND bot_id=$2 AND id=$3", [
				tenant,
				bot,
				id,
				version,
			]);
		},
	};
}
