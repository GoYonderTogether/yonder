import type { Context } from "@earendil-works/chord";
import type { Id, Seq, StorageWrite } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import type { Pool } from "pg";

export const postgresRuntimeSchema = `
CREATE TABLE IF NOT EXISTS bot_runtime_ids (
	tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, next_id BIGINT NOT NULL,
	PRIMARY KEY(tenant_id,bot_id)
);
CREATE TABLE IF NOT EXISTS bot_runtime_commits (
	tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, seq BIGINT NOT NULL, writes JSON NOT NULL,
	PRIMARY KEY(tenant_id,bot_id,seq)
)`;

export async function migratePostgresRuntime(pool: Pool): Promise<void> {
	await pool.query(postgresRuntimeSchema);
}

/**
 * Durable incremental commits use pi's existing validation/projections, just as JsonlStorage does.
 * ponytail: activation replays one Bot's log into memory; index retained records if measured history exceeds the RSS budget.
 */
export class PostgresStorage extends MemoryStorage {
	private constructor(
		private readonly pool: Pool,
		private readonly tenant: string,
		private readonly bot: string,
	) {
		super();
	}

	static async open(pool: Pool, tenant: string, bot: string, context: Context): Promise<PostgresStorage> {
		const storage = new PostgresStorage(pool, tenant, bot);
		await pool.query("INSERT INTO bot_runtime_ids VALUES($1,$2,2) ON CONFLICT DO NOTHING", [tenant, bot]);
		const result = await pool.query<{ seq: string; writes: StorageWrite[] }>(
			"SELECT seq,writes FROM bot_runtime_commits WHERE tenant_id=$1 AND bot_id=$2 ORDER BY seq",
			[tenant, bot],
		);
		for (const commit of result.rows) {
			context.abortSignal?.throwIfAborted();
			storage.prepareCommit(commit.writes, Number(commit.seq) as Seq).apply();
		}
		return storage;
	}

	override async mintId<I extends Id<string>>(): Promise<I> {
		// Also checks that close() has not released this instance; the pool remains owned by the worker.
		await super.mintId();
		const result = await this.pool.query<{ id: string }>(
			"UPDATE bot_runtime_ids SET next_id=next_id+1 WHERE tenant_id=$1 AND bot_id=$2 RETURNING next_id-1 AS id",
			[this.tenant, this.bot],
		);
		const id = Number(result.rows[0]!.id);
		if (!Number.isSafeInteger(id)) throw new Error("ID space is exhausted");
		return id as I;
	}

	override async commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
		context.abortSignal?.throwIfAborted();
		const prepared = this.prepareCommit(writes);
		const nextId = Math.max(
			2,
			...prepared.writes.map((write) =>
				write.type === "document.create" || write.type === "document.copy"
					? Number(write.record.id) + 1
					: "value" in write
						? Number(write.value.id) + 1
						: Number(write.id) + 1,
			),
		);
		await this.pool.query(
			`WITH saved AS (INSERT INTO bot_runtime_commits(tenant_id,bot_id,seq,writes) VALUES($1,$2,$3,$4) RETURNING seq)
			UPDATE bot_runtime_ids SET next_id=greatest(next_id,$5) WHERE tenant_id=$1 AND bot_id=$2`,
			[this.tenant, this.bot, Number(prepared.seq), JSON.stringify(prepared.writes), nextId],
		);
		return prepared.apply();
	}
}
