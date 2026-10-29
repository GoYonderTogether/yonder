import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createStore } from "../store/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import type { RuntimeRun } from "./types.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"recover() replays unsettled run receipts but skips runs whose run.end is already durable",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-settled-"));
		const profile = resolveProfile({ capabilities: [], tools: { offer: [] }, limits: { maxMinutes: 1 } });
		const open = async (extra: { settled?: (session: string, run: string) => Promise<boolean> } = {}) => {
			const db = await openDatabase(`${home}/state.db`);
			const store = await createStore(db);
			const runs: RuntimeRun[] = [];
			const idle: string[] = [];
			const runtime = await Runtime.open({
				home,
				db,
				config: { schema: 1, credentials: auth },
				readEvent: store.events.get,
				prepareInput: async (_id, event) => ({ text: String((event.data as { text: string }).text), event }),
				resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
				onRun: async (_session, run) => {
					runs.push(run);
				},
				onIdle: async (session) => {
					idle.push(session);
				},
				...extra,
			});
			return { runtime, store, runs, idle };
		};
		try {
			const first = await open();
			const session = await first.runtime.create({ agent: null, profile: "check", cwd: home });
			for (const word of ["settled-one", "settled-two"]) {
				const event = await first.store.events.record({
					type: "session.input",
					data: { session, text: `Reply exactly ${word}. Do not call tools.` },
				});
				const run = await first.runtime.submit(session, {
					event,
					text: String((event.data as { text: string }).text),
				});
				expect(run.status).toBe("done");
			}
			expect(first.runs).toHaveLength(2);
			await first.runtime.close();

			// Without the hook every historical receipt is replayed, which is what made startup grow with history.
			const replaying = await open();
			await replaying.runtime.recover();
			expect(replaying.runs.map((run) => run.text.trim()).sort()).toEqual(["settled-one", "settled-two"]);
			await replaying.runtime.close();

			// Once the ledger says the runs ended, recovery skips them and only re-evaluates the conversation once.
			const skipping = await open({ settled: async () => true });
			await skipping.runtime.recover();
			expect(skipping.runs).toHaveLength(0);
			expect(skipping.idle).toEqual([session]);
			await skipping.runtime.close();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
