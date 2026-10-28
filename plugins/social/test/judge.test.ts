import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { Batches } from "../src/batches.js";

test("the persisted judge budget prevents another model call after restart", async () => {
	vi.useFakeTimers();
	const now = new Date().toISOString();
	const conv = "conv:test:group";
	const ledger: YEvent[] = [
		{
			id: "1",
			ts: now,
			type: "message.in",
			conv,
			data: { text: "new" },
			routes: [{ agent: "a", binding: "group", session: "s", wake: "write" }],
		},
		{
			id: "2",
			ts: now,
			type: "routing.social-decision",
			parent: "1",
			data: {
				agent: "a",
				reason: "batch",
				revision: "r",
				policy: { batch: { count: 1 }, judge: { preset: "judge", maxCallsPerHour: 1 } },
			},
		},
		{ id: "3", ts: now, type: "social.judge-start", conv, data: { agent: "a", through: "0" } },
	];
	const open = vi.fn();
	const api = {
		social: { admitBatch: async () => ({ session: "s" }) },
		sessions: { open },
		events: {
			query: async (query: { type?: string; id?: string; conv?: string; since?: string }) => ({
				events: ledger.filter(
					(e) =>
						(!query.type || e.type === query.type) &&
						(!query.id || e.id === query.id) &&
						(!query.conv || e.conv === query.conv) &&
						(!query.since || e.ts >= query.since),
				),
			}),
			emit: async (event: EventInput) => {
				const item = { ...event, id: String(ledger.length + 1), ts: now };
				ledger.push(item);
				return item;
			},
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	try {
		const batches = new Batches(api);
		await batches.start();
		await vi.runAllTimersAsync();
		expect(open).not.toHaveBeenCalled();
		expect(ledger.some((e) => e.type === "social.batch-failed")).toBe(true);
		expect(ledger.some((e) => e.type === "social.batch-read")).toBe(false);
		await batches.stop();
		const recovered = new Batches(api);
		await recovered.start();
		await vi.runAllTimersAsync();
		expect(open).not.toHaveBeenCalled();
		expect(ledger.filter((e) => e.type === "social.batch-failed")).toHaveLength(1);
		await recovered.stop();
	} finally {
		vi.useRealTimers();
	}
});
