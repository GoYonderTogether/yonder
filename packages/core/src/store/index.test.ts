import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { createStore, newEvent } from "./index.js";

test("appended events and identity are queried from SQLite", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		const identity = store.identity("acct:cli:local");
		await identity.createPerson({ id: "owner", name: "owner" });
		await identity.link("acct:cli:local", "person:owner");
		const event = newEvent(
			{
				type: "message.in",
				from: "acct:cli:local",
				conv: "conv:cli:local",
				data: { kind: "dm", text: "read the workspace" },
			},
			[{ agent: "main", binding: null, dropped: "no-binding" }],
		);
		await store.events.append(event);
		expect((await store.events.query({ type: "message.*", agent: "main" })).events).toEqual([event]);
		expect(await identity.relation("main", "acct:cli:local")).toBe("owner");
		expect((await identity.lookup("person:owner")).convs).toEqual(["conv:cli:local"]);
	} finally {
		await db.close();
	}
});
