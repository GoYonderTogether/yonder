import { DatabaseSync } from "node:sqlite";
import type { Storage } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Db } from "../../contracts.js";

// The Yonder-facing database types live in L0 (store/db.ts) so store and config never import up into runtime;
// only opening the connection is pi-specific, so only that stays here (07 §1: runtime is the sole pi adapter).
export type { Db, DbExecutor, DbValue } from "../../contracts.js";

export async function openDatabase(path: string, readOnly = false): Promise<Db> {
	if (!readOnly) return openNodeSqliteDatabase(path);
	const raw = new DatabaseSync(path, { readOnly: true });
	const db = new NodeSqliteDatabase(raw);
	db.close = async () => raw.close();
	return db;
}

/** Adapt the one host-owned connection to pi storage while retaining the shared pi_ namespace. */
export function openRuntimeStorage(db: Db): Promise<Storage> {
	return SqliteStorage.open(db, { prefix: "pi_" });
}
