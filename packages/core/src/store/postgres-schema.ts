import type { Pool, PoolClient } from "pg";

export const postgresStoreSchema = `
CREATE TABLE IF NOT EXISTS bot_events (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,id TEXT NOT NULL,ts TEXT NOT NULL,type TEXT NOT NULL,
 parent TEXT,"from" TEXT,conv TEXT,data JSONB NOT NULL,routes JSONB,
 PRIMARY KEY(tenant_id,bot_id,id)
);
CREATE INDEX IF NOT EXISTS bot_events_type ON bot_events(tenant_id,bot_id,type,id);
CREATE INDEX IF NOT EXISTS bot_events_session ON bot_events(tenant_id,bot_id,(data->>'session'),id);
CREATE TABLE IF NOT EXISTS bot_sessions (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,id BIGINT NOT NULL,agent TEXT,profile TEXT NOT NULL,mode TEXT NOT NULL,
 key TEXT NOT NULL,parent BIGINT,version TEXT NOT NULL,opened TEXT NOT NULL,closed TEXT,
 owner TEXT,archived_at BIGINT,pinned INTEGER NOT NULL DEFAULT 0,needs_owner TEXT,title TEXT,channels TEXT,
 PRIMARY KEY(tenant_id,bot_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_sessions_open_key ON bot_sessions(tenant_id,bot_id,COALESCE(agent,''),key) WHERE closed IS NULL;
CREATE TABLE IF NOT EXISTS bot_accounts (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,ref TEXT NOT NULL,person TEXT,name TEXT,"firstSeen" TEXT NOT NULL,"lastSeen" TEXT NOT NULL,
 PRIMARY KEY(tenant_id,bot_id,ref)
);
CREATE TABLE IF NOT EXISTS bot_persons (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,note TEXT,
 PRIMARY KEY(tenant_id,bot_id,id)
);
CREATE TABLE IF NOT EXISTS bot_quota_days (
 tenant_id TEXT NOT NULL,bot_id TEXT NOT NULL,day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,
 tokens BIGINT NOT NULL DEFAULT 0,rounds BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,bot_id,day,scope,key)
)`;

export async function migratePostgresStore(pool: Pool): Promise<void> {
	await pool.query(postgresStoreSchema);
}

/** The local Db serializes transactions; PostgreSQL serializes the same Bot's compound changes. */
export async function postgresTransaction<T>(
	pool: Pool,
	tenant: string,
	bot: string,
	change: (tx: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([tenant, bot])]);
		const value = await change(client);
		await client.query("COMMIT");
		return value;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
