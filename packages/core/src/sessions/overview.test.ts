import { expect, test } from "vitest";
import type { YonderConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { botOverview } from "./overview.js";

test("bots.overview returns the Bot's main session and its children", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const base = { profile: "default", version: "1", opened: "now" } as const;
		await store.sessions.put({ ...base, id: "1", key: "k1", agent: "bot", mode: "task" });
		await store.sessions.put({ ...base, id: "2", key: "k2", agent: "bot", mode: "task", parent: "1" });
		await store.sessions.put({ ...base, id: "3", key: "k3", agent: "other", mode: "task" });
		const overview = await botOverview({} as YonderConfig, new Map(), store, async (row) => row)("bot");
		expect(overview.sessions.map((row) => row.id).sort()).toEqual(["1", "2"]);
	} finally {
		db.close();
	}
});
