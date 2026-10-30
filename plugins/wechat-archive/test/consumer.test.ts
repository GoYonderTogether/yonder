import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { archiveConsumer } from "../src/consumer.js";

test("source consumer survives database restart and home path changes without changing its cursor", async () => {
	const directory = await mkdtemp(join(tmpdir(), "wechat-consumer-"));
	const filename = join(directory, "archive.sqlite");
	let db = new DatabaseSync(filename);
	try {
		db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
		db.prepare("INSERT INTO meta VALUES(?,?)").run("cursor:Msg_abc", "539241");
		const original = archiveConsumer(db, "/previous-home/plugins/wechat-archive", "Msg_abc");
		db.close();
		db = new DatabaseSync(filename);
		expect(archiveConsumer(db, "/moved-home/plugins/wechat-archive", "Msg_abc", "changed-prefix")).toBe(original);
		expect(db.prepare("SELECT value FROM meta WHERE key=?").get("cursor:Msg_abc")?.value).toBe("539241");
		db.prepare("INSERT INTO meta VALUES(?,?)").run("consumer:*", "yonder-wechat-30f238bf2208dfcb");
		expect(archiveConsumer(db, "/moved-home/plugins/wechat-archive", "*")).toBe("yonder-wechat-30f238bf2208dfcb");
	} finally {
		db.close();
		await rm(directory, { recursive: true, force: true });
	}
});
