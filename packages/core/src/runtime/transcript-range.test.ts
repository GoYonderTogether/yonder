import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createStore } from "../store/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"transcript from/limit return the same window as slicing the full history",
	async () => {
		const home = await mkdtemp("/tmp/yonder-transcript-");
		try {
			const db = await openDatabase(`${home}/state.db`);
			const store = await createStore(db);
			const profile = resolveProfile({ capabilities: [], tools: { offer: [] }, limits: { maxMinutes: 1 } });
			const runtime = await Runtime.open({
				home,
				db,
				config: { schema: 1, credentials: auth },
				readEvent: store.events.get,
				prepareInput: async (_id, event) => ({ text: String((event.data as { text: string }).text), event }),
				resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
			});
			const session = await runtime.create({ agent: null, profile: "check", cwd: home });
			for (const word of ["range-one", "range-two"]) {
				const event = await store.events.record({
					type: "session.input",
					data: { session, text: `Reply exactly ${word}. Do not call tools.` },
				});
				const run = await runtime.submit(session, { event, text: String((event.data as { text: string }).text) });
				expect(run.status).toBe("done");
			}
			const all = await runtime.transcript(session, { limit: 1000 });
			expect(all.length).toBeGreaterThanOrEqual(4);
			expect(await runtime.transcript(session, { limit: 1 })).toEqual(all.slice(0, 1));
			const third = all[2];
			if (!third) throw new Error("expected at least three entries");
			const from = third.id;
			expect(await runtime.transcript(session, { from, limit: 2 })).toEqual(all.slice(2, 4));
			expect(await runtime.transcript(session, { from })).toEqual(all.slice(2));
			await runtime.close();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
