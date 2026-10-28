import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeSessionState } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { createSessions } from "./index.js";

test("judgment requires an explicit inexpensive model and restores its isolated profile", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: "a",
			profile: "group",
			mode: "persistent",
			key: "g",
			version: "1",
			opened: "now",
		});
		let cheap: string | undefined;
		let state: RuntimeSessionState = { agent: null, profile: "judge", cwd: "/tmp", env: "local" };
		const runtime = {
			create: async () => "2",
			sessionConfig: async () => ({ resolved: { model: "p/main", ...(cheap ? { cheap } : {}), credentialSlots: {} } }),
			sessionState: async () => state,
			setSessionState: async (_: string, saved: RuntimeSessionState) => {
				state = saved;
			},
		} as unknown as Runtime;
		const sessions = createSessions({
			store,
			agents: new Map(),
			homePresets: new Map([
				[
					"judge",
					{
						id: "judge",
						description: "judge",
						plugins: ["private"],
						contexts: ["private"],
						skills: ["*"],
						tools: { offer: ["bash"], search: ["*"] },
						fallback: { models: ["p/expensive"] },
					},
				],
			]),
			pluginPresets: new Map(),
			home: "/tmp",
			config: { schema: 1, defaultModel: "p/main" },
			version: "1",
			runtime: () => runtime,
		});
		await expect(sessions.api.open({ preset: "judge", modelSource: { session: "1" }, judgment: true })).rejects.toThrow(
			"explicit cheap or simple",
		);
		cheap = "p/cheap";
		await sessions.api.open({ preset: "judge", modelSource: { session: "1" }, judgment: true });
		const resolved = (await sessions.resolveSession("2")).resolved;
		expect(resolved).toMatchObject({
			model: "p/cheap",
			thinking: "low",
			fallback: { models: [] },
			capabilities: [],
			plugins: [],
			contexts: [],
			skills: [],
			tools: { offer: [], search: [] },
			prompt: { sections: [] },
			instructions: "",
		});
	} finally {
		await db.close();
	}
});
