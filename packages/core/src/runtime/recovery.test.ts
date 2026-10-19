import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createStore } from "../store/index.js";
import { openDatabase } from "./db.js";
import { Runtime, type RuntimeRun } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna receipt recovers an interrupted Yonder projection without another model call",
	async () => {
		const home = await mkdtemp("/tmp/yonder-recovery-runtime-");
		let db = await openDatabase(`${home}/state.db`);
		let store = await createStore(db);
		let selected = resolveProfile({ limits: { maxMinutes: 1 } });
		const configuration = async () => ({ agent: null, profile: "recovery", cwd: home, resolved: selected });
		let runtime = await Runtime.open({
			home,
			db,
			config: { schema: 1, credentials: auth },
			resolveSession: configuration,
			readEvent: (id) => store.events.get(id),
			onRun: async () => {
				throw new Error("N05 deliberate interruption before run.end projection");
			},
		});
		try {
			const session = await runtime.create({ agent: null, profile: "recovery", cwd: home });
			const event = await store.events.record({
				type: "session.input",
				data: {
					session,
					text: "Reply exactly native-receipt-ready. Do not call tools.",
					waiting: true,
					busy: "followup",
				},
			});
			await expect(runtime.submit(session, { text: (event.data as { text: string }).text, event })).rejects.toThrow(
				"deliberate interruption",
			);
			expect(await store.events.runEnd(session, "unknown")).toBeUndefined();
			const entriesBefore = await runtime.transcript(session);
			expect(entriesBefore.some((entry) => entry.text.includes("native-receipt-ready"))).toBe(true);
			const totalBefore = await runtime.usage(session);
			await runtime.close();
			db = await openDatabase(`${home}/state.db`);
			store = await createStore(db);
			selected = resolveProfile({ model: "openai/gpt-6.1-sol", limits: { maxMinutes: 1 } });
			const projected: RuntimeRun[] = [];
			runtime = await Runtime.open({
				home,
				db,
				config: { schema: 1, credentials: auth },
				resolveSession: configuration,
				readEvent: (id) => store.events.get(id),
				onRun: async (id, run) => {
					if (
						await store.events.recordRun({
							type: "run.end",
							parent: event.id,
							data: {
								session: id,
								runId: run.runId,
								inputs: run.inputs,
								status: run.status,
								model: run.config?.resolved.model,
								usage: run.usage,
							},
						})
					)
						projected.push(run);
				},
			});
			await runtime.recover();
			expect(projected).toHaveLength(1);
			expect(projected[0]).toMatchObject({
				status: "done",
				inputs: [event.id],
				text: expect.stringContaining("native-receipt-ready"),
				config: { resolved: { model: "openai/gpt-6-luna" } },
				usage: totalBefore,
			});
			await runtime.recover();
			expect(projected).toHaveLength(1);
			expect(await runtime.transcript(session)).toEqual(entriesBefore);
			expect(await runtime.usage(session)).toEqual(totalBefore);
			const duplicate = await runtime.submit(session, { event, text: "This duplicate must not call a model." });
			expect(duplicate.runId).toBe(projected[0]?.runId);
			expect(await runtime.transcript(session)).toEqual(entriesBefore);
			expect(projected).toHaveLength(1);
		} finally {
			try {
				await runtime.close();
			} finally {
				await rm(home, { recursive: true, force: true });
			}
		}
	},
	90000,
);
