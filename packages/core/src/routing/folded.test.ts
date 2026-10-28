import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { createRouter } from "./index.js";

test("folded group mentions remain write-only and retain the effective policy", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const agent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: { group: {} },
				social: {
					enabled: true,
					authorized: { conversations: ["conv:test:group"] },
					defaults: { group: { mode: "folded", foldedEverySeconds: 300 } },
				},
				bindings: [{ id: "group", match: { kind: "group" }, session: { mode: "persistent", per: "conv" } }],
			}),
		);
		const router = createRouter({
			store,
			agents: new Map([[agent.id, agent]]),
			sessions: {
				ensureAgent: async () => ({ session: { id: "s" }, profileMismatch: false }),
			} as unknown as Parameters<typeof createRouter>[0]["sessions"],
			runtime: () => {
				throw new Error("No model");
			},
		});
		const event = await router.emit({
			type: "message.in",
			from: "acct:test:user",
			conv: "conv:test:group",
			data: { kind: "group", mentioned: true, text: "hello" },
		});
		expect(event.routes?.[0]?.wake).toBe("write");
		const fact = (await store.events.query({ type: "routing.social-decision" })).events[0];
		expect(fact?.data).toMatchObject({ reason: "folded", policy: { mode: "folded", foldedEverySeconds: 300 } });
	} finally {
		await db.close();
	}
});
