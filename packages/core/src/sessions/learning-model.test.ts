import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { createSessions } from "./index.js";

test.each([
	[{ cheap: "p/cheap", simple: "p/simple" }, "p/cheap"],
	[{ simple: "p/simple" }, "p/simple"],
	[{}, "p/config"],
])("independent task copies selected model and credential slots %j", async (models, expected) => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: "a",
			profile: "owner",
			mode: "main",
			key: "1",
			version: "1",
			opened: "now",
			closed: "now",
		});
		let saved: unknown;
		const runtime = {
			create: async () => "2",
			sessionConfig: async () => ({ resolved: { model: "p/main", credentialSlots: { p: "slot" }, ...models } }),
			sessionState: async () => ({ cwd: "/tmp", env: "local", capabilities: ["read"] }),
			setSessionState: async (_id: string, state: unknown) => {
				saved = state;
			},
		} as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents: new Map(),
			homePresets: new Map([["review", { id: "review", description: "review" }]]),
			pluginPresets: new Map(),
			home: "/tmp",
			config: { schema: 1, defaultModel: "p/main" },
			version: "1",
			runtime: () => runtime,
		});
		const task = await sessions.api.open({ preset: "review", modelSource: { session: "1", fallback: "p/config" } });
		expect(task.parent).toBeUndefined();
		expect(saved).toMatchObject({ models: { model: expected, credentialSlots: { p: "slot" } } });
	} finally {
		await db.close();
	}
});
