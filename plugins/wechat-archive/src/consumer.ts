import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Cursor acknowledgments belong to the original source consumer, even after a home move. */
export function archiveConsumer(db: DatabaseSync, data: string, key: string, prefix = "yonder-wechat"): string {
	const name = `consumer:${key}`;
	const saved = db.prepare("SELECT value FROM meta WHERE key=?").get(name)?.value;
	if (saved) return String(saved);
	const consumer = `${prefix}-${createHash("sha256")
		.update(data + key)
		.digest("hex")
		.slice(0, 16)}`;
	db.prepare("INSERT INTO meta(key,value) VALUES(?,?)").run(name, consumer);
	return consumer;
}
