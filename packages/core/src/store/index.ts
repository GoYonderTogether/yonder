import { randomBytes } from "node:crypto";
import type {
	AccountInfo,
	EventInput,
	EventPage,
	EventQuery,
	IdentityAPI,
	Ref,
	Route,
	SessionInfo,
	YEvent,
} from "@yonder/sdk";
import { parseRef, person } from "@yonder/sdk";
import type { Db, DbExecutor, DbValue } from "../runtime/db.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let entropy = 0n;
function ulid() {
	const now = Math.max(Date.now(), lastTime);
	entropy = now === lastTime ? entropy + 1n : BigInt(`0x${randomBytes(10).toString("hex")}`);
	lastTime = now;
	let value = (BigInt(now) << 80n) | entropy;
	let id = "";
	for (let i = 0; i < 26; i++, value >>= 5n) id = alphabet[Number(value & 31n)] + id;
	return id;
}

export const newEvent = (input: EventInput, routes?: Route[]): YEvent => ({
	...input,
	id: ulid(),
	ts: new Date().toISOString(),
	...(routes ? { routes } : {}),
});

type EventRow = Omit<YEvent, "data" | "routes"> & { data: string; routes: string | null };
function defined<T extends object>(row: T): T {
	return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as T;
}
function eventRow(row: EventRow): YEvent {
	const { data, routes, ...rest } = row;
	return { ...defined(rest), data: JSON.parse(data), ...(routes ? { routes: JSON.parse(routes) } : {}) };
}
function sessionRow(row: SessionInfo): SessionInfo {
	return {
		...defined(row),
		agent: row.agent,
		id: String(row.id),
		...(row.parent != null ? { parent: String(row.parent) } : {}),
	};
}

export async function createStore(
	db: Db,
	owner: (agent: string) => Ref | undefined = () => undefined,
	readOnly = false,
	onEvent?: (event: YEvent) => void,
) {
	if (!readOnly)
		await db.exec(`
		CREATE TABLE IF NOT EXISTS y_events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL, parent TEXT, "from" TEXT, conv TEXT, data TEXT NOT NULL, routes TEXT);
		CREATE INDEX IF NOT EXISTS y_events_ts ON y_events(ts);
		CREATE INDEX IF NOT EXISTS y_events_type ON y_events(type);
		CREATE INDEX IF NOT EXISTS y_events_from ON y_events("from");
		CREATE INDEX IF NOT EXISTS y_events_conv ON y_events(conv);
		CREATE INDEX IF NOT EXISTS y_events_parent ON y_events(parent);
		CREATE TABLE IF NOT EXISTS y_sessions (id INTEGER PRIMARY KEY, agent TEXT, profile TEXT NOT NULL, mode TEXT NOT NULL, key TEXT NOT NULL, parent INTEGER, version TEXT NOT NULL, opened TEXT NOT NULL, closed TEXT);
		CREATE UNIQUE INDEX IF NOT EXISTS y_sessions_open_key ON y_sessions(COALESCE(agent, ''), key) WHERE closed IS NULL;
		CREATE TABLE IF NOT EXISTS y_accounts (ref TEXT PRIMARY KEY, person TEXT, name TEXT, firstSeen TEXT NOT NULL, lastSeen TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS y_persons (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT);
	`);
	async function insert(tx: DbExecutor, event: YEvent) {
		await tx.run(
			"INSERT INTO y_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			event.id,
			event.ts,
			event.type,
			event.parent ?? null,
			event.from ?? null,
			event.conv ?? null,
			JSON.stringify(event.data),
			event.routes ? JSON.stringify(event.routes) : null,
		);
		if (event.routes && event.from?.startsWith("acct:")) {
			const name = (event.data as { name?: string }).name ?? null;
			await tx.run(
				`INSERT INTO y_accounts(ref, name, firstSeen, lastSeen) VALUES (?, ?, ?, ?)
				ON CONFLICT(ref) DO UPDATE SET name = COALESCE(excluded.name, name), lastSeen = excluded.lastSeen`,
				event.from,
				name,
				event.ts,
				event.ts,
			);
		}
		return event;
	}
	const events = {
		async append(event: YEvent) {
			await db.transaction((tx) => insert(tx, event));
			onEvent?.(event);
			return event;
		},
		record: (input: EventInput, routes?: Route[]): Promise<YEvent> => events.append(newEvent(input, routes)),
		async get(id: string) {
			const row = await db.get<EventRow>("SELECT * FROM y_events WHERE id = ?", id);
			return row && eventRow(row);
		},
		async query(query: EventQuery = {}): Promise<EventPage> {
			const limit = query.limit ?? 100;
			if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
				throw new Error("event limit must be an integer from 1 to 1000");
			const where: string[] = [],
				values: DbValue[] = [];
			const add = (sql: string, value: DbValue) => {
				where.push(sql);
				values.push(value);
			};
			if (query.type)
				query.type.endsWith(".*") ? add("substr(type, 1, ?) = ?", query.type.length - 1) : add("type = ?", query.type);
			if (query.type?.endsWith(".*")) values.push(query.type.slice(0, -1));
			if (query.from) add('"from" = ?', query.from);
			if (query.conv) add("conv = ?", query.conv);
			if (query.agent)
				add("EXISTS (SELECT 1 FROM json_each(routes) r WHERE json_extract(r.value, '$.agent') = ?)", query.agent);
			if (query.since) add("ts >= ?", query.since);
			if (query.until) add("ts < ?", query.until);
			if (query.after) add("id > ?", query.after);
			const rows = await db.all<EventRow>(
				`SELECT * FROM y_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id LIMIT ?`,
				...values,
				limit + 1,
			);
			return {
				events: rows.slice(0, limit).map(eventRow),
				...(rows.length > limit ? { next: rows[limit - 1]!.id } : {}),
			};
		},
	};
	const sessions = {
		async put(session: SessionInfo) {
			await db.run(
				"INSERT INTO y_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				Number(session.id),
				session.agent,
				session.profile,
				session.mode,
				session.key,
				session.parent ? Number(session.parent) : null,
				session.version,
				session.opened,
				session.closed ?? null,
			);
			return session;
		},
		async get(id: string) {
			const row = await db.get<SessionInfo>("SELECT * FROM y_sessions WHERE id = ?", id);
			return row && sessionRow(row);
		},
		async find(agent: string | null, key: string) {
			const row = await db.get<SessionInfo>(
				"SELECT * FROM y_sessions WHERE agent IS ? AND key = ? AND closed IS NULL",
				agent,
				key,
			);
			return row && sessionRow(row);
		},
		async list(filter: { agent?: string; mode?: SessionInfo["mode"]; open?: boolean } = {}) {
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
			return (
				await db.all<SessionInfo>(
					`SELECT * FROM y_sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
					...values,
				)
			).map(sessionRow);
		},
		close: (id: string) =>
			db.run("UPDATE y_sessions SET closed = ? WHERE id = ? AND closed IS NULL", new Date().toISOString(), id),
		setVersion: (id: string, version: string) => db.run("UPDATE y_sessions SET version = ? WHERE id = ?", version, id),
	};
	function identity(actor?: Ref): IdentityAPI {
		const api: IdentityAPI = {
			async account(ref) {
				if (parseRef(ref).kind !== "acct") throw new Error("Expected acct reference");
				const row = await db.get<AccountInfo>("SELECT * FROM y_accounts WHERE ref = ?", ref);
				return row && defined(row);
			},
			async person(ref) {
				const parsed = parseRef(ref);
				if (parsed.kind !== "person") throw new Error("Expected person reference");
				const row = await db.get<{ id: string; name: string; note?: string }>(
					"SELECT * FROM y_persons WHERE id = ?",
					parsed.id,
				);
				if (!row) return undefined;
				return {
					ref,
					name: row.name,
					...(row.note != null ? { note: row.note } : {}),
					accounts: (
						await db.all<{ ref: string }>("SELECT ref FROM y_accounts WHERE person = ? ORDER BY ref", ref)
					).map((a) => a.ref),
				};
			},
			async createPerson(p) {
				const ref = person(p.id);
				await db.run(
					"INSERT INTO y_persons VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note",
					p.id,
					p.name,
					p.note ?? null,
				);
				return (await api.person(ref))!;
			},
			async link(account, ref) {
				if (parseRef(account).kind !== "acct") throw new Error("Expected acct reference");
				if (!(await api.person(ref))) throw new Error(`Unknown person: ${ref}`);
				const event = newEvent({
					type: "identity.link",
					...(actor ? { from: actor } : {}),
					data: { account, person: ref, linked: true },
				});
				await db.transaction(async (tx) => {
					await tx.run(
						"INSERT INTO y_accounts(ref, person, firstSeen, lastSeen) VALUES (?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET person = excluded.person",
						account,
						ref,
						event.ts,
						event.ts,
					);
					await insert(tx, event);
				});
				onEvent?.(event);
			},
			async unlink(account) {
				const row = await api.account(account);
				if (!row) throw new Error(`Unknown account: ${account}`);
				if (!row.person) return;
				const event = newEvent({
					type: "identity.link",
					...(actor ? { from: actor } : {}),
					data: { account, person: row.person, linked: false },
				});
				await db.transaction(async (tx) => {
					await tx.run("UPDATE y_accounts SET person = NULL WHERE ref = ?", account);
					await insert(tx, event);
				});
				onEvent?.(event);
			},
			async relation(agent, account) {
				const linked = (await api.account(account))?.person;
				return !linked ? "stranger" : linked === owner(agent) ? "owner" : "known";
			},
			async lookup(ref) {
				const parsed = parseRef(ref);
				if (parsed.kind !== "acct" && parsed.kind !== "person") throw new Error("lookup expects acct or person");
				const account = parsed.kind === "acct" ? await api.account(ref) : undefined;
				const personRef = parsed.kind === "person" ? ref : account?.person;
				const accounts = personRef
					? (await db.all<AccountInfo>("SELECT * FROM y_accounts WHERE person = ? ORDER BY ref", personRef)).map(
							defined,
						)
					: account
						? [account]
						: [];
				if (!accounts.length) return { accounts, convs: [], agents: [] };
				const refs = accounts.map((a) => a.ref),
					placeholders = refs.map(() => "?").join(",");
				const convs = await db.all<{ conv: string }>(
					`SELECT DISTINCT conv FROM y_events WHERE "from" IN (${placeholders}) AND conv IS NOT NULL ORDER BY conv`,
					...refs,
				);
				const agents = await db.all<{ agent: string }>(
					`SELECT DISTINCT s.agent FROM y_events e, json_each(e.routes) r JOIN y_sessions s ON s.id = json_extract(r.value, '$.session') WHERE e."from" IN (${placeholders}) AND s.agent IS NOT NULL ORDER BY s.agent`,
					...refs,
				);
				return { accounts, convs: convs.map((c) => c.conv), agents: agents.map((a) => a.agent) };
			},
		};
		return api;
	}
	return { events, sessions, identity };
}
export type Store = Awaited<ReturnType<typeof createStore>>;
