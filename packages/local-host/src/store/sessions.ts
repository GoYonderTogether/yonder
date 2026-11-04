import { type SessionRow, type SessionWorkbench, sessionRow } from "@yonder/bot-core/store/sessions";
import type { Db, DbValue } from "@yonder/runtime-adapter/contracts";
import type { SessionInfo } from "@yonder/sdk";

export { ownerIdentity, type SessionRow, type SessionWorkbench, sessionRow } from "@yonder/bot-core/store/sessions";
/** Session rows plus their workbench state (contracts §18). */
export function sessionStore(db: Db) {
	return {
		async put(session: SessionInfo) {
			await db.run(
				`INSERT INTO y_sessions (id, agent, profile, mode, key, parent, version, opened, closed, owner, archived_at, pinned, needs_owner, title, channels)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			);
			return session;
		},
		async get(id: string) {
			const row = await db.get<SessionRow>("SELECT * FROM y_sessions WHERE id = ?", id);
			return row && sessionRow(row);
		},
		async find(agent: string | null, key: string) {
			const row = await db.get<SessionRow>(
				"SELECT * FROM y_sessions WHERE agent IS ? AND key = ? AND closed IS NULL",
				agent,
				key,
			);
			return row && sessionRow(row);
		},
		async list(
			filter: { agent?: string; mode?: SessionInfo["mode"]; open?: boolean; archived?: boolean; pinned?: boolean } = {},
		) {
			const where: string[] = [],
				values: DbValue[] = [];
			if (filter.agent !== undefined) {
				where.push("agent = ?");
				values.push(filter.agent);
			}
			if (filter.mode) {
				where.push("mode = ?");
				values.push(filter.mode);
			}
			if (filter.open !== undefined) where.push(`closed IS ${filter.open ? "" : "NOT "}NULL`);
			// Archived sessions are finished work: list returns them only when asked (contracts §18).
			where.push(`archived_at IS ${filter.archived ? "NOT " : ""}NULL`);
			if (filter.pinned !== undefined) where.push(`pinned = ${filter.pinned ? 1 : 0}`);
			return (
				await db.all<SessionRow>(
					`SELECT * FROM y_sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
					...values,
				)
			).map(sessionRow);
		},
		/** Workbench state; `null` clears a field and an absent key leaves it alone. */
		async update(id: string, patch: SessionWorkbench) {
			const row = await db.get<SessionRow>("SELECT * FROM y_sessions WHERE id = ?", id);
			if (!row) return;
			const encoded = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));
			const number = (value: number | null | undefined) => (value === null || value === undefined ? null : value);
			await db.run(
				"UPDATE y_sessions SET owner = ?, archived_at = ?, pinned = ?, needs_owner = ?, title = ?, channels = ?, parent = ? WHERE id = ?",
				"owner" in patch ? encoded(patch.owner) : row.owner,
				"archivedAt" in patch ? number(patch.archivedAt) : row.archived_at,
				"pinned" in patch ? (patch.pinned ? 1 : 0) : row.pinned,
				"needsOwner" in patch ? encoded(patch.needsOwner) : row.needs_owner,
				"title" in patch ? (patch.title ?? null) : row.title,
				"channels" in patch ? encoded(patch.channels) : row.channels,
				"parent" in patch ? number(patch.parent ? Number(patch.parent) : null) : row.parent,
				id,
			);
		},
		close: (id: string) =>
			db.run("UPDATE y_sessions SET closed = ? WHERE id = ? AND closed IS NULL", new Date().toISOString(), id),
		setVersion: (id: string, version: string) => db.run("UPDATE y_sessions SET version = ? WHERE id = ?", version, id),
	};
}
export type SessionStore = ReturnType<typeof sessionStore>;
