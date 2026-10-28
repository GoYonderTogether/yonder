import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrate } from "./migrations.js";

const version = async (db: Awaited<ReturnType<typeof openDatabase>>) =>
	(await db.get<{ value: string }>("SELECT value FROM y_meta WHERE key = 'schema_version'"))?.value;

test("fresh database is v1", async () => {
	const db = await openDatabase(":memory:");
	try {
		await migrate(db);
		expect(await version(db)).toBe(String(CURRENT_SCHEMA_VERSION));
		expect(CURRENT_SCHEMA_VERSION).toBe(1);
		await db.exec("SELECT * FROM y_events, y_sessions, y_accounts, y_persons LIMIT 0");
	} finally {
		await db.close();
	}
});

test("legacy database without y_meta is stamped v1 and keeps its data", async () => {
	const db = await openDatabase(":memory:");
	try {
		await db.exec(MIGRATIONS.find((m) => m.version === 1)?.up ?? "");
		await db.run("INSERT INTO y_persons(id, name) VALUES ('p', 'owner')");
		await migrate(db);
		expect(await version(db)).toBe("1");
		expect(await db.get("SELECT name FROM y_persons WHERE id = 'p'")).toEqual({ name: "owner" });
	} finally {
		await db.close();
	}
});

test("a newer database is refused", async () => {
	const db = await openDatabase(":memory:");
	try {
		await migrate(db);
		await db.run("UPDATE y_meta SET value = '99' WHERE key = 'schema_version'");
		await expect(migrate(db)).rejects.toThrow("拒绝降级");
	} finally {
		await db.close();
	}
});

test("pending migration backs up first and then applies", async () => {
	const dir = await mkdtemp(join(tmpdir(), "yonder-mig-"));
	const db = await openDatabase(join(dir, "state.db"));
	try {
		await migrate(db);
		await db.run("INSERT INTO y_persons(id, name) VALUES ('p', 'owner')");
		const v2 = [...MIGRATIONS, { version: 2, up: "ALTER TABLE y_persons ADD COLUMN extra TEXT" }];
		await migrate(db, v2);
		expect(await version(db)).toBe("2");
		expect(existsSync(join(dir, "backups", "state-v1.db"))).toBe(true);
		const backup = await openDatabase(join(dir, "backups", "state-v1.db"), true);
		try {
			expect(await backup.get("SELECT name FROM y_persons")).toEqual({ name: "owner" });
			await expect(backup.get("SELECT extra FROM y_persons")).rejects.toThrow();
		} finally {
			await backup.close();
		}
	} finally {
		await db.close();
	}
});
