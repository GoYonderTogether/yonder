import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { apply } from "@earendil-works/chord/delta";
import {
	type ConversationId,
	type ConversationQuery,
	type ConversationRecord,
	type Cursor,
	type DocumentAddress,
	type DocumentContent,
	type DocumentId,
	type DocumentPoint,
	type DocumentQuery,
	type DocumentRecord,
	type EntryId,
	type EntryQuery,
	type EntryRecord,
	type Id,
	type Page,
	type ScanOrder,
	type Seq,
	type Storage,
	StorageRequestError,
	type StorageWrite,
	type StoredDocument,
	type SubmissionId,
	type SubmissionQuery,
	type SubmissionRecord,
	type TaskId,
	type TaskQuery,
	type TaskRecord,
} from "@earendil-works/pi-durable";
import type { Pool, PoolClient } from "pg";
import { indexValue, prepare, project, projectionSchema } from "./projection.js";

export const postgresRuntimeSchema = `
CREATE TABLE IF NOT EXISTS bot_runtime_ids (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, next_id BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,bot_id)
);
CREATE TABLE IF NOT EXISTS bot_runtime_commits (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, seq BIGINT NOT NULL, writes JSON NOT NULL,
 PRIMARY KEY(tenant_id,bot_id,seq)
);${projectionSchema}`;
export async function migratePostgresRuntime(pool: Pool): Promise<void> {
	await pool.query(postgresRuntimeSchema);
}
type Task = TaskRecord<JsonValue, JsonValue, JsonValue>;
const alive = (record: DocumentRecord, at: DocumentPoint) =>
	at === "current"
		? record.retiredAt === undefined
		: record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
function scan(order: ScanOrder | undefined, cursor: Cursor | undefined, fallback: ScanOrder) {
	const selected = cursor?.order ?? order ?? fallback;
	if (
		(selected !== "ascending" && selected !== "descending") ||
		(cursor && (!Number.isSafeInteger(cursor.after) || (order !== undefined && order !== selected)))
	)
		throw new StorageRequestError("Invalid storage cursor or scan order");
	return { order: selected as ScanOrder, after: cursor?.after as number | undefined };
}
function page<T extends { id: Id<string> }>(items: T[], limit: number, order: ScanOrder): Page<T, Cursor> {
	return {
		items: items.slice(0, limit),
		...(items.length > limit ? { next: { after: (items[limit - 1] as T).id, order } } : {}),
	};
}

/** PostgreSQL stores projections and revisions; activation never hydrates the Bot's history. */
export class PostgresStorage implements Storage {
	private closed = false;
	private constructor(
		private readonly pool: Pool,
		private readonly tenant: string,
		private readonly bot: string,
	) {}
	private get scope() {
		return [this.tenant, this.bot];
	}
	private assertOpen() {
		if (this.closed) throw new Error("PostgresStorage is closed");
	}
	static async open(pool: Pool, tenant: string, bot: string, context: Context = BACKGROUND_CONTEXT) {
		const storage = new PostgresStorage(pool, tenant, bot);
		await pool.query("INSERT INTO bot_runtime_ids VALUES($1,$2,2) ON CONFLICT DO NOTHING", storage.scope);
		await pool.query(
			"INSERT INTO bot_runtime_heads(tenant_id,bot_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
			storage.scope,
		);
		// Existing installations retain their immutable log. Migrate in bounded batches once, not on every activation.
		await storage.transaction(async (client) => {
			const { rows } = await client.query<{ seq: string }>(
				"SELECT seq FROM bot_runtime_heads WHERE tenant_id=$1 AND bot_id=$2 FOR UPDATE",
				storage.scope,
			);
			let seq = Number(rows[0]?.seq);
			for (;;) {
				context.abortSignal?.throwIfAborted();
				const commits = await client.query<{ seq: string; writes: StorageWrite[] }>(
					"SELECT seq,writes FROM bot_runtime_commits WHERE tenant_id=$1 AND bot_id=$2 AND seq>$3 ORDER BY seq LIMIT 100",
					[...storage.scope, seq],
				);
				if (!commits.rows.length) break;
				for (const commit of commits.rows) {
					seq = Number(commit.seq);
					await project(client, storage.scope, commit.writes, seq as Seq);
				}
			}
		});
		return storage;
	}
	private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const result = await run(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async mintId<I extends Id<string>>(): Promise<I> {
		this.assertOpen();
		const result = await this.pool.query<{ id: string }>(
			"UPDATE bot_runtime_ids SET next_id=next_id+1 WHERE tenant_id=$1 AND bot_id=$2 RETURNING next_id-1 AS id",
			this.scope,
		);
		const id = Number(result.rows[0]?.id);
		if (!Number.isSafeInteger(id)) throw new Error("ID space is exhausted");
		return id as I;
	}
	async commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
		this.assertOpen();
		context.abortSignal?.throwIfAborted();
		return this.transaction(async (client) => {
			const result = await client.query<{ seq: string }>(
				"SELECT seq FROM bot_runtime_heads WHERE tenant_id=$1 AND bot_id=$2 FOR UPDATE",
				this.scope,
			);
			const seq = (Number(result.rows[0]?.seq) + 1) as Seq;
			const prepared = await prepare(this, client, this.scope, writes, seq, context);
			await client.query("INSERT INTO bot_runtime_commits VALUES($1,$2,$3,$4)", [
				...this.scope,
				seq,
				JSON.stringify(prepared),
			]);
			await project(client, this.scope, prepared, seq);
			const nextId = Math.max(
				2,
				...prepared.map((w) => Number("record" in w ? w.record.id : "value" in w ? w.value.id : w.id) + 1),
			);
			await client.query("UPDATE bot_runtime_ids SET next_id=greatest(next_id,$3) WHERE tenant_id=$1 AND bot_id=$2", [
				...this.scope,
				nextId,
			]);
			return seq;
		});
	}
	private async record<T>(type: string, id: number, db: Pool | PoolClient = this.pool): Promise<T | undefined> {
		this.assertOpen();
		const row = (
			await db.query<{ record: string }>(
				"SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type=$3 AND id=$4",
				[...this.scope, type, id],
			)
		).rows[0];
		return row ? (JSON.parse(row.record) as T) : undefined;
	}
	conversation(id: ConversationId, _context: Context) {
		return this.record<ConversationRecord>("conversation", id);
	}
	task(id: TaskId, _context: Context) {
		return this.record<Task>("task", id);
	}
	submission(id: SubmissionId, _context: Context) {
		return this.record<SubmissionRecord>("submission", id);
	}
	private async records<_T extends { id: Id<string> }>(
		type: string,
		filter: object,
		limit: number,
		cursor: Cursor | undefined,
		order: ScanOrder | undefined,
		extra = "",
		params: unknown[] = [],
	) {
		this.assertOpen();
		const start = scan(order, cursor, "ascending");
		const { rows } = await this.pool.query<{ record: string }>(
			`SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type=$3 AND lookup @> $4::jsonb AND id ${start.order === "ascending" ? ">" : "<"} $5 ${extra} ORDER BY id ${start.order === "ascending" ? "ASC" : "DESC"} LIMIT $6`,
			[
				...this.scope,
				type,
				JSON.stringify(indexValue(filter)),
				start.after ?? (start.order === "ascending" ? -1 : Number.MAX_SAFE_INTEGER),
				limit + 1,
				...params,
			],
		);
		return page(
			rows.map((r) => JSON.parse(r.record)),
			limit,
			start.order,
		);
	}
	scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, _context: Context) {
		const { order, ownerConversationId, ownerTaskId } = query;
		const owner = {
			...(ownerConversationId === undefined ? {} : { conversationId: ownerConversationId }),
			...(ownerTaskId === undefined ? {} : { taskId: ownerTaskId }),
		};
		return this.records<ConversationRecord>(
			"conversation",
			Object.keys(owner).length ? { owner } : {},
			limit,
			cursor,
			order,
		);
	}
	scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, _context: Context) {
		const { order, status, ...filter } = query;
		return this.records<Task>(
			"task",
			{ ...filter, ...(status === undefined ? {} : { state: { status } }) },
			limit,
			cursor,
			order,
		);
	}
	scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, _context: Context) {
		const { order, ...filter } = query;
		return this.records<SubmissionRecord>("submission", filter, limit, cursor, order);
	}
	async submissionByRequest(conversationId: ConversationId, requestId: string, _context: Context) {
		return (await this.records<SubmissionRecord>("submission", { conversationId, requestId }, 1, undefined, undefined))
			.items[0];
	}
	private async segments(id: ConversationId, upper = Number.MAX_SAFE_INTEGER) {
		const segments: Array<{ id: ConversationId; upper: number }> = [];
		let record = await this.record<ConversationRecord>("conversation", id);
		if (!record) throw new StorageRequestError(`Unknown conversation: ${id}`);
		for (;;) {
			segments.push({ id: record.id, upper });
			if (!record.parent) return segments;
			upper = Math.min(upper, record.parent.at);
			record = (await this.record<ConversationRecord>("conversation", record.parent.conversationId))!;
		}
	}
	entry(id: EntryId, context: Context): Promise<{ entry: EntryRecord; commitSeq: Seq } | undefined>;
	entry(
		conversationId: ConversationId,
		id: EntryId,
		context: Context,
	): Promise<{ entry: EntryRecord; commitSeq: Seq } | undefined>;
	async entry(first: EntryId | ConversationId, second: EntryId | Context, context?: Context) {
		this.assertOpen();
		const id = (context === undefined ? first : second) as EntryId;
		const row = (
			await this.pool.query<{ record: string; seq: string }>(
				"SELECT record,seq FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type='entry' AND id=$3",
				[...this.scope, id],
			)
		).rows[0];
		if (context !== undefined) {
			const segments = await this.segments(first as ConversationId);
			if (row && !segments.some((s) => s.id === JSON.parse(row.record).conversationId && id <= s.upper))
				return undefined;
		}
		return row ? { entry: JSON.parse(row.record), commitSeq: Number(row.seq) as Seq } : undefined;
	}
	async scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, _context: Context) {
		this.assertOpen();
		const { order, after } = scan(query.order, cursor, "descending");
		const lower = Math.max(query.minEntryId ?? 0, order === "ascending" && after !== undefined ? after + 1 : 0);
		const upper = Math.min(
			query.maxEntryId ?? Number.MAX_SAFE_INTEGER,
			order === "descending" && after !== undefined ? after - 1 : Number.MAX_SAFE_INTEGER,
		);
		const values: EntryRecord[] = [];
		const segments = await this.segments(query.conversationId, upper);
		for (const segment of order === "ascending" ? segments.reverse() : segments) {
			const { rows } = await this.pool.query<{ record: string }>(
				`SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type='entry' AND (lookup->>'conversationId')::bigint=$3 AND id BETWEEN $4 AND $5 ORDER BY id ${order === "ascending" ? "ASC" : "DESC"} LIMIT $6`,
				[...this.scope, segment.id, lower, segment.upper, limit + 1 - values.length],
			);
			values.push(...rows.map((r) => JSON.parse(r.record)));
			if (values.length > limit) break;
		}
		return page(values, limit, order);
	}
	async findLatestHeadMarker(
		conversationId: ConversationId,
		atOrBeforeEntryId: EntryId | undefined,
		_context: Context,
	) {
		for (const segment of await this.segments(conversationId, atOrBeforeEntryId)) {
			const { rows } = await this.pool.query<{ record: string }>(
				"SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type='entry' AND (lookup->>'conversationId')::bigint=$3 AND id<=$4 AND lookup ? 'head' ORDER BY id DESC LIMIT 1",
				[...this.scope, segment.id, segment.upper],
			);
			if (rows[0]) return JSON.parse(rows[0].record);
		}
		return undefined;
	}
	async documentFrom(
		db: Pool | PoolClient,
		id: DocumentId | number,
		at: DocumentPoint,
	): Promise<StoredDocument | undefined> {
		const record = await this.record<DocumentRecord>("document", id, db);
		if (!record) return undefined;
		if (at !== "current" && (record.scope.kind !== "conversation" || record.history === "latest"))
			throw new StorageRequestError(`Document ${id} does not retain historical content`);
		if (!alive(record, at)) return undefined;
		const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
		const revisions = await db.query<{ content: string }>(
			`SELECT content FROM bot_runtime_revisions WHERE tenant_id=$1 AND bot_id=$2 AND id=$3 AND seq<=$4 AND seq >= (SELECT max(seq) FROM bot_runtime_revisions WHERE tenant_id=$1 AND bot_id=$2 AND id=$3 AND seq<=$4 AND kind='base') ORDER BY seq`,
			[...this.scope, id, upper],
		);
		const base = JSON.parse((revisions.rows[0] as { content: string }).content) as Extract<
			DocumentContent,
			{ kind: "base" }
		>;
		let value = base.value;
		for (const revision of revisions.rows.slice(1)) {
			const content = JSON.parse(revision.content) as DocumentContent;
			if (content.kind !== "delta" || content.version !== base.version)
				throw new Error("Document crosses a version boundary without a base");
			value = apply(value, content.ops) as typeof value;
		}
		return { record, version: base.version, value, deltasSinceBase: revisions.rows.length - 1 };
	}
	document(id: DocumentId, at: DocumentPoint, _context: Context) {
		return this.documentFrom(this.pool, id, at);
	}
	async findDocument(address: DocumentAddress, at: DocumentPoint, _context: Context) {
		this.assertOpen();
		const { rows } = await this.pool.query<{ record: string }>(
			"SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND type='document' AND lookup @> $3::jsonb AND (lookup ? 'key')=$4 ORDER BY id",
			[...this.scope, JSON.stringify(indexValue(address)), address.key !== undefined],
		);
		return rows.map((r) => JSON.parse(r.record)).find((r) => alive(r, at));
	}
	async scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, _context: Context) {
		const { at, ...filter } = query;
		const cutoff = at === "current" ? Number.MAX_SAFE_INTEGER : at;
		return this.records<DocumentRecord>(
			"document",
			filter,
			limit,
			cursor,
			"ascending",
			"AND (lookup->>'createdAt')::bigint<=$7 AND (NOT(lookup ? 'retiredAt') OR (lookup->>'retiredAt')::bigint>$7)",
			[cutoff],
		);
	}
	async close(_context: Context) {
		this.closed = true;
	}
}
