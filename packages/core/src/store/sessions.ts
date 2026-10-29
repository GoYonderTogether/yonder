import type { SessionInfo, SessionOwner } from "@yonder/sdk";
import type { Db, DbValue } from "../runtime/db.js";

/** Workbench fields a stored row can carry: absent leaves the column alone, `null` clears it (contracts §18). */
export type SessionWorkbench = {
	[K in "archivedAt" | "channels" | "needsOwner" | "owner" | "parent" | "pinned" | "title"]?: SessionInfo[K] | null;
};
/** Sessions written before the workbench fields existed belong to the owner. */
export const ownerIdentity: SessionOwner = { kind: "owner", id: "owner" };
type SessionRow = Omit<
	SessionInfo,
	"archivedAt" | "channels" | "id" | "needsOwner" | "owner" | "parent" | "pinned" | "title"
> & {
	id: number;
	parent: number | null;
	owner: string | null;
	archived_at: number | null;
	pinned: number | null;
	needs_owner: string | null;
	title: string | null;
	channels: string | null;
};
/** Stored JSON is ours, but a corrupt row must read as "not set" instead of breaking the list. */
const decode = <T>(encoded: string | null, read: (value: unknown) => T): T | undefined => {
	if (encoded === null) return undefined;
	try {
		return read(JSON.parse(encoded));
	} catch {
		return undefined;
	}
};
function sessionRow(row: SessionRow): SessionInfo {
	const { id, parent, agent, profile, mode, key, version, opened, closed } = row;
	const owner = decode(row.owner, (value) => value as SessionOwner);
	const needsOwner = decode(row.needs_owner, (value) => value as NonNullable<SessionInfo["needsOwner"]>);
	const channels = decode(row.channels, (value) => value as string[]);
	return {
		agent,
		profile,
		mode,
		key,
		version,
		opened,
		id: String(id),
		owner: owner ?? ownerIdentity,
		...(parent != null ? { parent: String(parent) } : {}),
		...(closed != null ? { closed } : {}),
		...(row.archived_at != null ? { archivedAt: row.archived_at } : {}),
		...(row.pinned ? { pinned: true } : {}),
		...(needsOwner ? { needsOwner } : {}),
		...(row.title != null ? { title: row.title } : {}),
		...(channels ? { channels } : {}),
	};
}

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
