import { botOverview } from "@yonder/bot-core/sessions/overview";
import type { YonderConfig } from "@yonder/local-host/config/index";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import { expect, test } from "vitest";

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
