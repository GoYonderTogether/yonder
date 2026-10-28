import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { cid, SessionDoc } from "./docs.js";
import { Runtime } from "./index.js";
import type { TodoUpdatedEvent } from "./todo.js";
import type { ModelFallbackEvent } from "./types.js";

// Events owed to observers live in the session document next to the state they describe. A crash after the state
// commit but before delivery must not lose them: the next start delivers them, once, and clears the outbox.
it("events owed at a crash are delivered after restart and then cleared", async () => {
	const home = mkdtempSync(join(realpathSync(tmpdir()), "yonder-outbox-"));
	const open = async (sinks: {
		onTodo?: (event: TodoUpdatedEvent) => Promise<void>;
		onModelFallback?: (event: ModelFallbackEvent) => Promise<void>;
	}) =>
		Runtime.open({
			home,
			db: await openDatabase(join(home, "state.db")),
			config: { schema: 1, credentials: "auth.json", compaction: { enabled: false } },
			resolveSession: async () => ({
				agent: null,
				profile: "outbox",
				cwd: home,
				resolved: resolveProfile({ capabilities: [], tools: { offer: [] } }),
			}),
			...sinks,
		});
	let runtime: Runtime | undefined;
	try {
		runtime = await open({});
		const session = await runtime.create({ agent: null, profile: "outbox", cwd: home });
		const todo: TodoUpdatedEvent = {
			session,
			done: 0,
			total: 1,
			items: [{ id: "1", text: "a", state: "todo", order: 0 }],
		};
		const fallback: ModelFallbackEvent = {
			session,
			state: "fallback",
			from: { provider: "p", model: "a" },
			to: { provider: "p", model: "b" },
			reason: "unavailable",
		};
		// The "crash": the state commit that owes both events happens, delivery never does.
		const harness = (runtime as unknown as { harness: import("@earendil-works/pi-durable").Harness }).harness;
		await harness.commit(
			async (tx) => {
				const doc = await tx.doc(SessionDoc, cid(session));
				doc.outbox = [
					JSON.stringify({ kind: "fallback", data: fallback }),
					JSON.stringify({ kind: "todo", data: todo }),
				];
			},
			{ signal: new AbortController().signal } as never,
		);
		await runtime.close();

		const seen: string[] = [];
		runtime = await open({
			onModelFallback: async (event) => void seen.push(`fallback:${event.state}`),
			onTodo: async (event) => void seen.push(`todo:${event.total}`),
		});
		await runtime.recover();
		expect(seen).toEqual(["fallback:fallback", "todo:1"]);
		await runtime.close();

		runtime = await open({
			onModelFallback: async (event) => void seen.push(`again:${event.state}`),
			onTodo: async (event) => void seen.push(`again:${event.total}`),
		});
		await runtime.recover();
		expect(seen).toEqual(["fallback:fallback", "todo:1"]);
	} finally {
		await runtime?.close();
		rmSync(home, { recursive: true, force: true });
	}
});
