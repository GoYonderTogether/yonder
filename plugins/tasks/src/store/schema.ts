import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeRow } from "./append.js";
import { replay, type TaskEvent } from "./project.js";

const file = "tasks.sqlite";

/** 建表与迁移。连接由调用方持有，这里只保证结构就绪。 */
export function connect(data: string): DatabaseSync {
	mkdirSync(data, { recursive: true, mode: 0o700 });
	const path = join(data, file);
	const db = new DatabaseSync(path);
	chmodSync(path, 0o600);
	db.exec(`CREATE TABLE IF NOT EXISTS events (
		seq INTEGER PRIMARY KEY, task TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL
	)`);
	// 读路径按 task 取单个任务的历史，没有这个索引就退化成全表扫。
	db.exec("CREATE INDEX IF NOT EXISTS events_task ON events(task, seq)");
	db.exec("CREATE TABLE IF NOT EXISTS reminder_windows (destination TEXT PRIMARY KEY, claimed INTEGER NOT NULL)");
	db.exec(`CREATE TABLE IF NOT EXISTS task_current (
		id TEXT PRIMARY KEY,
		ref TEXT NOT NULL,
		title TEXT NOT NULL,
		state TEXT NOT NULL,
		owner TEXT,
		parent TEXT,
		session TEXT,
		origin TEXT,
		revision INTEGER NOT NULL,
		record TEXT NOT NULL
	)`);
	return db;
}

export function needsBackfill(db: DatabaseSync): boolean {
	const rows = Number((db.prepare("SELECT COUNT(*) AS n FROM task_current").get() as { n: number }).n);
	if (rows) return false;
	return Number((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n) > 0;
}

/** 投影是派生数据：随时可以清空重放，结果必须与增量维护的一致。 */
export function rebuild(db: DatabaseSync): number {
	db.exec("BEGIN IMMEDIATE");
	try {
		db.exec("DELETE FROM task_current");
		const events = db
			.prepare("SELECT * FROM events ORDER BY seq")
			.all()
			.map((row) => ({ ...row, data: JSON.parse(String(row.data)) }) as unknown as TaskEvent);
		const projected = replay(events);
		for (const entry of projected.values()) writeRow(db, entry);
		db.exec("COMMIT");
		return projected.size;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
