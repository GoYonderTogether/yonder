import type { Context } from "@earendil-works/chord";
import type { Seq, StorageWrite } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import type { PoolClient } from "pg";
import type { PostgresStorage } from "./storage.js";

export const projectionSchema = `
CREATE TABLE IF NOT EXISTS bot_runtime_heads (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, seq BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,bot_id)
);
CREATE TABLE IF NOT EXISTS bot_runtime_records (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, id BIGINT NOT NULL, type TEXT NOT NULL,
 seq BIGINT NOT NULL, record TEXT NOT NULL, lookup JSONB NOT NULL, PRIMARY KEY(tenant_id,bot_id,id)
);
CREATE INDEX IF NOT EXISTS bot_runtime_records_type ON bot_runtime_records(tenant_id,bot_id,type,id);
CREATE INDEX IF NOT EXISTS bot_runtime_records_conversation ON bot_runtime_records(tenant_id,bot_id,type,((lookup->>'conversationId')::bigint),id);
CREATE TABLE IF NOT EXISTS bot_runtime_revisions (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, id BIGINT NOT NULL, seq BIGINT NOT NULL,
 content TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(tenant_id,bot_id,id,seq)
)`;

/** Encode indexed strings as JSON text so PostgreSQL never normalizes NULs or lone UTF-16 surrogates. */
export function indexValue(value: unknown): unknown {
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return value.map(indexValue);
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, indexValue(item)]));
	return value;
}
function lookup(record: object) {
	const {
		model: _model,
		data: _data,
		edits: _edits,
		input: _input,
		memos: _memos,
		state,
		...metadata
	} = record as Record<string, unknown>;
	return JSON.stringify(
		indexValue({ ...metadata, ...(state ? { state: { status: (state as { status: string }).status } } : {}) }),
	);
}

/** Apply an authoritative log batch without retaining a transcript or old document versions in JS. */
export async function project(client: PoolClient, scope: string[], writes: readonly StorageWrite[], seq: Seq) {
	for (const write of [...(writes as readonly Exclude<StorageWrite, { type: "document.copy" }>[])].sort(
		(a, b) => Number(a.type === "document.retire") - Number(b.type === "document.retire"),
	)) {
		if (write.type === "document.change") {
			await client.query("INSERT INTO bot_runtime_revisions VALUES($1,$2,$3,$4,$5,$6)", [
				...scope,
				write.id,
				seq,
				JSON.stringify(write.content),
				write.content.kind,
			]);
		} else if (write.type === "document.retire") {
			const row = (
				await client.query<{ record: string }>(
					"SELECT record FROM bot_runtime_records WHERE tenant_id=$1 AND bot_id=$2 AND id=$3",
					[...scope, write.id],
				)
			).rows[0]!;
			await client.query(
				"UPDATE bot_runtime_records SET record=$4, lookup=lookup || jsonb_build_object('retiredAt',$5::bigint) WHERE tenant_id=$1 AND bot_id=$2 AND id=$3",
				[...scope, write.id, JSON.stringify({ ...JSON.parse(row.record), retiredAt: seq }), seq],
			);
		} else {
			const document = write.type === "document.create";
			const record = document ? { ...write.record, createdAt: seq } : write.value;
			await client.query(
				`INSERT INTO bot_runtime_records VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(tenant_id,bot_id,id) DO UPDATE SET record=EXCLUDED.record,lookup=EXCLUDED.lookup,seq=EXCLUDED.seq`,
				[...scope, record.id, document ? "document" : write.type, seq, JSON.stringify(record), lookup(record)],
			);
			if (document)
				await client.query("INSERT INTO bot_runtime_revisions VALUES($1,$2,$3,$4,$5,$6)", [
					...scope,
					record.id,
					seq,
					JSON.stringify(write.content),
					write.content.kind,
				]);
		}
	}
	await client.query("UPDATE bot_runtime_heads SET seq=$3 WHERE tenant_id=$1 AND bot_id=$2", [...scope, seq]);
}

/** Reuse pi's atomic-write validation on only the IDs and document addresses this commit touches. */
export async function prepare(
	storage: PostgresStorage,
	client: PoolClient,
	scope: string[],
	writes: readonly StorageWrite[],
	seq: Seq,
	context: Context,
) {
	const normalized: StorageWrite[] = [];
	const changed = new Set(
		writes
			.filter((w) => w.type.startsWith("document."))
			.map((w) => ("record" in w ? w.record.id : "id" in w ? w.id : 0)),
	);
	for (const write of writes) {
		if (write.type !== "document.copy") {
			normalized.push(write);
			continue;
		}
		if (changed.has(write.source.id)) throw new Error("Fork source document is changed in the copy batch");
		const source = await storage.documentFrom(client, write.source.id, write.source.at);
		if (
			source?.record.scope.kind !== "conversation" ||
			write.record.scope.kind !== "conversation" ||
			source.record.kind !== write.record.kind ||
			source.record.key !== write.record.key ||
			source.record.history !== write.record.history ||
			source.record.fork !== write.record.fork
		)
			throw new Error("Fork source document does not match the copied record");
		normalized.push({
			type: "document.create",
			record: write.record,
			content: { kind: "base", version: source.version, value: source.value },
		});
	}
	const ids = normalized.map((w) => ("record" in w ? w.record.id : "value" in w ? w.value.id : w.id));
	const addresses = normalized
		.filter((w) => w.type === "document.create")
		.map((w) => {
			const { kind, scope, key } = w.record;
			return { kind, scope, ...(key === undefined ? {} : { key }) };
		});
	const rows = await client.query<{ type: string; record: string }>(
		`SELECT type,record FROM bot_runtime_records
  WHERE tenant_id=$1 AND bot_id=$2 AND (id=ANY($3::bigint[]) OR (type='document' AND NOT(lookup ? 'retiredAt') AND EXISTS(SELECT 1 FROM jsonb_array_elements($4::jsonb) a WHERE lookup @> a AND (lookup ? 'key')=(a ? 'key'))))`,
		[...scope, ids, JSON.stringify(indexValue(addresses))],
	);
	const seed: StorageWrite[] = [];
	for (const { type, record: encoded } of rows.rows) {
		const record = JSON.parse(encoded) as Record<string, unknown>;
		if (type !== "document") {
			seed.push({ type, value: record } as StorageWrite);
			continue;
		}
		const { createdAt: _created, retiredAt, ...definition } = record;
		const current =
			retiredAt === undefined ? await storage.documentFrom(client, record.id as number, "current") : undefined;
		seed.push({
			type: "document.create",
			record: definition,
			content: { kind: "base", version: current?.version ?? 1, value: current?.value ?? {} },
		} as StorageWrite);
		if (retiredAt !== undefined) seed.push({ type: "document.retire", id: record.id } as StorageWrite);
	}
	const memory = new MemoryStorage();
	if (seed.length) memory.prepareCommit(seed, (seq - 1) as Seq).apply();
	const prepared = memory.prepareCommit(normalized, seq);
	await memory.close(context);
	return prepared.writes;
}
