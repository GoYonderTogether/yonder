import type { SessionInfo, SessionOwner } from "@yonder/sdk";
/** Workbench fields a stored row can carry: absent leaves the column alone, `null` clears it (contracts §18). */
export type SessionWorkbench = {
	[K in "archivedAt" | "channels" | "needsOwner" | "owner" | "parent" | "pinned" | "title"]?: SessionInfo[K] | null;
};
/** Sessions written before the workbench fields existed belong to the owner. */
export const ownerIdentity: SessionOwner = { kind: "owner", id: "owner" };
export type SessionRow = Omit<
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
export function sessionRow(row: SessionRow): SessionInfo {
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

export type SessionStore = import("./contracts.js").Store["sessions"];
