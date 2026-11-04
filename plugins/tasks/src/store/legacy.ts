import { statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { replay, type TaskEvent } from "./project.js";

/** Read the former local-only event table without opening it for writes. */
export function readLegacyEvents(localRoot: string): TaskEvent[] | undefined {
	const path = join(localRoot, "tasks.sqlite");
	try {
		if (!statSync(path).isFile()) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const events = db
			.prepare("SELECT seq, task, kind, at, data FROM events ORDER BY seq")
			.all()
			.map((row) => ({ ...row, seq: Number(row.seq), data: JSON.parse(String(row.data)) }) as unknown as TaskEvent);
		// Reuse the original projection replay as the import integrity check before committing the marker.
		replay(events);
		return events;
	} finally {
		db.close();
	}
}
