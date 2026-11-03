import type { Pool } from "pg";

/** Worker-owned virtual files; personality remains ordinary SOUL.md/AGENTS.md files. */
export const definitionSchema = `CREATE TABLE IF NOT EXISTS bot_files (
	tenant_id TEXT NOT NULL,
	bot_id TEXT NOT NULL,
	path TEXT NOT NULL,
	content TEXT NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (tenant_id, bot_id, path)
)`;

export async function migrateDefinitions(pool: Pool): Promise<void> {
	await pool.query(definitionSchema);
}
