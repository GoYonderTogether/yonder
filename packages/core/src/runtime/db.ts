import { DatabaseSync } from "node:sqlite";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

export type DbValue = null | number | bigint | string | Uint8Array;
export interface DbExecutor {
	exec(sql: string): Promise<void>;
	run(sql: string, ...params: DbValue[]): Promise<void>;
	get<T extends object>(sql: string, ...params: DbValue[]): Promise<T | undefined>;
	all<T extends object>(sql: string, ...params: DbValue[]): Promise<T[]>;
}
export interface Db extends DbExecutor {
	transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export async function openDatabase(path: string, readOnly = false): Promise<Db> {
	if (!readOnly) return openNodeSqliteDatabase(path);
	const raw = new DatabaseSync(path, { readOnly: true });
	const db = new NodeSqliteDatabase(raw);
	db.close = async () => raw.close();
	return db;
}
