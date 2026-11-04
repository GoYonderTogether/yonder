import { createBranches } from "@yonder/bot-core/sessions/branches";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import type { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import { expect, test } from "vitest";

test("fork records parent, allows two layers and rejects the third with invalid_params", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: null,
			profile: "default",
			mode: "task",
			key: "k",
			version: "1",
			opened: "now",
		});
		let next = 100;
		const runtime = { fork: async () => String(next++) } as unknown as Runtime;
		const branches = createBranches(
			store,
			() => runtime,
			"1",
			async (row) => row,
		);
		const one = await branches.fork("1", 1);
		expect(one.parent).toBe("1");
		const two = await branches.fork(one.id, 1);
		expect(two.parent).toBe(one.id);
		expect((await store.sessions.get(two.id))?.parent).toBe(one.id);
		await expect(branches.fork(two.id, 1)).rejects.toMatchObject({ code: "invalid_params" });
	} finally {
		db.close();
	}
});
