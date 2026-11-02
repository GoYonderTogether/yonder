import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PluginFiles, ToolContext } from "@yonder/sdk";
import { createFilePluginStorage, tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";
import type { TaskEvent } from "../src/store/project.js";

const ctx = { agent: "main", session: "1", capabilities: ["read", "write"] } as ToolContext;
const content = {
	title: "Import original events",
	objective: "Retain old history",
	acceptance: ["History is unchanged"],
	nonGoals: [],
};

async function legacy() {
	const root = await tempHome("tasks-legacy-");
	const source = new Store(createFilePluginStorage(join(root, "source")).open());
	const task = await source.open(content, ctx);
	await source.update(task.id, { state: "active", note: "Original progress" }, ctx);
	await source.render({ agent: "main", session: "1", profile: "owner", workspace: { read: async () => undefined } });
	await source.spend(task.id, 200, true);
	const history = (await source.get(task.id, ctx)).history;
	await source.close();
	const path = join(root, "tasks.sqlite");
	const db = new DatabaseSync(path);
	db.exec(
		"CREATE TABLE events(seq INTEGER PRIMARY KEY,task TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL)",
	);
	const insert = db.prepare("INSERT INTO events VALUES(?,?,?,?,?)");
	for (const event of history) insert.run(event.seq, event.task, event.kind, event.at, JSON.stringify(event.data));
	db.close();
	return { root, path, task, history, files: createFilePluginStorage(root).open() };
}

test("imports every original SQLite event once, preserves the old database and reopens with its full history", async () => {
	const f = await legacy();
	const bytes = await readFile(f.path);
	try {
		const store = new Store(f.files);
		expect(await f.files.read("projection.json")).toBeUndefined();
		expect((await store.get(f.task.id, ctx)).history).toEqual(f.history);
		expect(JSON.parse((await f.files.read("projection.json"))!).legacyImported).toBe(true);
		await store.close();
		const reopened = new Store(createFilePluginStorage(f.root).open());
		expect((await reopened.get(f.task.id, ctx)).history).toEqual(f.history);
		const second = await reopened.open(content, ctx);
		expect(second.ref).toBe("T2");
		expect((await reopened.get(second.id, ctx)).history[0]!.seq).toBe(f.history.at(-1)!.seq + 1);
		expect(await readFile(f.path)).toEqual(bytes);
		await reopened.close();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("backfill after import retains new events instead of restoring the retained old SQLite snapshot", async () => {
	const f = await legacy();
	try {
		const store = new Store(f.files);
		await store.update(f.task.id, { title: "Changed after import" }, ctx);
		const history = (await store.get(f.task.id, ctx)).history;
		await store.close();
		await f.files.remove("projection.json");
		const reopened = new Store(createFilePluginStorage(f.root).open());
		const restored = await reopened.get(f.task.id, ctx);
		expect(restored.task.title).toBe("Changed after import");
		expect(restored.history).toEqual(history);
		await reopened.close();
		const again = new Store(createFilePluginStorage(f.root).open());
		expect((await again.get(f.task.id, ctx)).history).toEqual(history);
		await again.close();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});

test("an import write failure leaves neither imported history nor the successful marker", async () => {
	const f = await legacy();
	const guarded = (files: PluginFiles): PluginFiles =>
		new Proxy(files, {
			get(target, key) {
				if (key === "transaction")
					return (change: (tx: PluginFiles) => Promise<unknown>) => target.transaction((tx) => change(guarded(tx)));
				if (key === "write")
					return (path: string, text: string) => {
						if (path === "projection.json") throw new Error("Import storage failure");
						return target.write(path, text);
					};
				return Reflect.get(target, key, target);
			},
		});
	try {
		await expect(new Store(guarded(f.files)).get(f.task.id, ctx)).rejects.toThrow("Import storage failure");
		expect(await f.files.read("projection.json")).toBeUndefined();
		expect(await f.files.list("history")).toEqual([]);
		const retry = new Store(f.files);
		expect((await retry.get(f.task.id, ctx)).history).toEqual(f.history as TaskEvent[]);
		await retry.close();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});
