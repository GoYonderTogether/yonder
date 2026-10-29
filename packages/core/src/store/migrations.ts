import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Db } from "../runtime/db.js";

export interface Migration {
	version: number;
	up: string;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		up: `
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
	`,
	},
	{
		// Workbench state (contracts §18): every column is additive and nullable or defaulted, so v1 rows read back unchanged.
		version: 2,
		up: `
		ALTER TABLE y_sessions ADD COLUMN owner TEXT;
		ALTER TABLE y_sessions ADD COLUMN archived_at INTEGER;
		ALTER TABLE y_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE y_sessions ADD COLUMN needs_owner TEXT;
		ALTER TABLE y_sessions ADD COLUMN title TEXT;
		ALTER TABLE y_sessions ADD COLUMN channels TEXT;
		`,
	},
];

export const CURRENT_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

const META = "CREATE TABLE IF NOT EXISTS y_meta (key TEXT PRIMARY KEY, value TEXT)";
const SET_VERSION = "INSERT OR REPLACE INTO y_meta(key, value) VALUES ('schema_version', ?)";

async function exists(db: Db, table: string) {
	return !!(await db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", table));
}

async function backup(db: Db, from: number) {
	const main = (await db.all<{ name: string; file: string }>("PRAGMA database_list")).find((d) => d.name === "main");
	if (!main?.file) return; // in-memory database: nothing to back up
	const dir = join(dirname(main.file), "backups");
	const target = join(dir, `state-v${from}.db`);
	await mkdir(dir, { recursive: true });
	await rm(target, { force: true });
	await db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
}

/** Bring the database to the latest schema. Old unversioned databases are stamped v1 without rebuilding. */
export async function migrate(db: Db, migrations: Migration[] = MIGRATIONS): Promise<void> {
	const target = Math.max(...migrations.map((m) => m.version));
	let current = 0;
	if (await exists(db, "y_meta")) {
		const row = await db.get<{ value: string }>("SELECT value FROM y_meta WHERE key = 'schema_version'");
		current = Number(row?.value ?? 0);
	} else if (await exists(db, "y_sessions")) {
		await db.transaction(async (tx) => {
			await tx.exec(META);
			await tx.run(SET_VERSION, "1");
		});
		current = 1;
	}
	if (current > target) throw new Error(`数据库版本 v${current} 高于本程序支持的 v${target}，拒绝降级`);
	const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
	if (!pending.length) return;
	if (current > 0) await backup(db, current);
	await db.transaction(async (tx) => {
		await tx.exec(META);
		for (const m of pending) {
			await tx.exec(m.up);
			await tx.run(SET_VERSION, String(m.version));
		}
	});
}
