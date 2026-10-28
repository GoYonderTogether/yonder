import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, PluginAPI } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { parseAgentConfig } from "../../../packages/core/src/config/index.js";
import { createRouter } from "../../../packages/core/src/routing/index.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { createStore } from "../../../packages/core/src/store/index.js";
import { Batches } from "../src/batches.js";

const golden = new URL("./events.golden.json", import.meta.url);
function shape(value: unknown): unknown {
	if (Array.isArray(value)) return [shape(value[0])];
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
	return typeof value;
}

test("SQLite routing facts rebuild a pending batch across restart and retain their event shapes", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-social-ledger-"));
	vi.useFakeTimers();
	try {
		let db = await openDatabase(join(root, "state.db"));
		let store = await createStore(db);
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
					defaults: { group: { batch: { count: 1, run: true } } },
				},
				bindings: [{ id: "group", match: { kind: "group" }, session: { mode: "persistent", per: "conv" } }],
			}),
		);
		const sessions = {
			ensureAgent: async () => ({ session: { id: "group-session" }, profileMismatch: false }),
		} as unknown as Parameters<typeof createRouter>[0]["sessions"];
		const router = createRouter({
			store,
			sessions,
			agents: new Map([["main", agent]]),
			runtime: () => {
				throw new Error("No model invoked");
			},
		});
		const source = await router.emit({
			type: "message.in",
			from: "acct:test:user",
			conv: "conv:test:group",
			data: { kind: "group", text: "hello" },
		});
		expect(source.routes?.[0]).toMatchObject({ session: "group-session", wake: "write" });
		const fact = (await store.events.query({ type: "routing.social-decision" })).events[0];
		expect(fact?.parent).toBe(source.id);
		await db.close();
		db = await openDatabase(join(root, "state.db"));
		store = await createStore(db);
		const calls: EventInput[] = [];
		const api = {
			events: {
				query: (query: Parameters<typeof store.events.query>[0]) => store.events.query(query),
				ask: async (input: EventInput) => {
					calls.push(input);
					const event = await store.events.record(input);
					return { event, results: [] };
				},
				emit: (input: EventInput) => store.events.record(input),
			},
			log: { warn: vi.fn() },
		} as unknown as PluginAPI;
		const batches = new Batches(api);
		await batches.start();
		await vi.runAllTimersAsync();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.data).toMatchObject({ agent: "main", through: source.id, sourceEvents: [source.id] });
		const failed = (await store.events.query({ type: "social.batch-failed" })).events[0];
		const direct = await store.events.record(
			{ type: "message.in", conv: "conv:test:group", data: { kind: "group", mentioned: true } },
			[{ agent: "main", binding: "group", session: "group-session", wake: "run" }],
		);
		batches.direct(direct);
		const end = await store.events.record({
			type: "run.end",
			data: { session: "group-session", inputs: [direct.id], status: "done" },
		});
		await batches.finished(end);
		const read = (await store.events.query({ type: "social.batch-read" })).events[0];
		await batches.stop();
		const current = {
			"routing.social-decision": shape(fact?.data),
			"social.batch-ready": shape(calls[0]?.data),
			"social.batch-failed": shape(failed?.data),
			"social.batch-read": shape(read?.data),
		};
		if (process.env.UPDATE_GOLDEN === "1") await writeFile(golden, `${JSON.stringify(current, null, "\t")}\n`);
		expect(current).toEqual(JSON.parse(await readFile(golden, "utf8")));
		await db.close();
	} finally {
		vi.useRealTimers();
		await rm(root, { recursive: true, force: true });
	}
});
