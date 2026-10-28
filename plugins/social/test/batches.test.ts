import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { Batches } from "../src/batches.js";

test("waits for an admitted QQ batch to finish before scheduling its unread successor", async () => {
	vi.useFakeTimers();
	const ts = new Date().toISOString();
	const conv = "conv:qq:group:a";
	const route = { agent: "a", binding: "b", session: "s", wake: "write" as const };
	const ledger: YEvent[] = [
		{ id: "1", ts, type: "message.in", conv, data: { text: "old" }, routes: [route] },
		{ id: "2", ts, type: "channel-qq.group-batch", conv, data: { through: "1" }, routes: [{ ...route, wake: "run" }] },
		{ id: "3", ts, type: "message.in", conv, data: { text: "new" }, routes: [route] },
		{
			id: "4",
			ts,
			type: "routing.social-decision",
			parent: "3",
			data: {
				agent: "a",
				reason: "batch",
				revision: "r",
				policy: { batch: { count: 1, run: true }, minIntervalSeconds: 0 },
			},
		},
	];
	const ask = vi.fn(async (input: EventInput) => ({ event: { ...input, id: "6", ts }, results: [{ status: "done" }] }));
	const api = {
		events: {
			query: async (q: { id?: string; type?: string; conv?: string }) => ({
				events: ledger.filter(
					(e) => (!q.id || q.id === e.id) && (!q.type || q.type === e.type) && (!q.conv || q.conv === e.conv),
				),
			}),
			ask,
			emit: async (input: EventInput) => ({ ...input, id: "7", ts }),
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	const batches = new Batches(api);
	await batches.start();
	await vi.runAllTimersAsync();
	expect(ask).not.toHaveBeenCalled();
	await batches.legacyRead({ id: "5", ts, type: "channel-qq.group-read", conv, data: { through: "1" } });
	await vi.runAllTimersAsync();
	expect(ask).toHaveBeenCalledTimes(1);
	expect(ask.mock.calls[0]?.[0].data).toMatchObject({ through: "3", sourceEvents: ["3"] });
	await batches.stop();
	vi.useRealTimers();
});

test("imports the QQ read cursor without moving it backwards on restart", async () => {
	vi.useFakeTimers();
	const ts = new Date().toISOString();
	const source: YEvent = {
		id: "2",
		ts,
		type: "message.in",
		conv: "conv:qq:group:a",
		data: { text: "old" },
		routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
	};
	const ledger: YEvent[] = [
		source,
		{ id: "3", ts, type: "channel-qq.group-read", conv: source.conv, data: { through: "2" } },
		{ id: "4", ts, type: "social.batch-read", conv: source.conv, data: { agent: "a", through: "1" } },
		{
			id: "5",
			ts,
			type: "routing.social-decision",
			parent: "2",
			data: { agent: "a", reason: "batch", revision: "r", policy: { batch: { count: 1, run: true } } },
		},
	];
	const ask = vi.fn();
	const api = {
		events: {
			query: async (q: { id?: string; type?: string; conv?: string }) => ({
				events: ledger.filter(
					(e) => (!q.id || q.id === e.id) && (!q.type || q.type === e.type) && (!q.conv || q.conv === e.conv),
				),
			}),
			ask,
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	const batches = new Batches(api);
	await batches.start();
	await vi.runAllTimersAsync();
	expect(ask).not.toHaveBeenCalled();
	await batches.stop();
	vi.useRealTimers();
});

test.each([{}, { batch: { run: true, count: 1 }, judge: { preset: "cheap" } }])(
	"default and unimplemented judge policies retain unread messages across restart: %o",
	async (policy) => {
		vi.useFakeTimers();
		const ledger: YEvent[] = [
			{
				id: "1",
				ts: new Date().toISOString(),
				type: "message.in",
				conv: "conv:chat:group",
				data: { text: "x" },
				routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
			},
			{
				id: "d1",
				ts: new Date().toISOString(),
				type: "routing.social-decision",
				parent: "1",
				data: { agent: "a", reason: "batch", revision: "rev", policy },
			},
		];
		const ask = vi.fn();
		const api = {
			events: {
				query: async (query: { type?: string; id?: string }) => ({
					events: ledger.filter(
						(event) => (!query.type || event.type === query.type) && (!query.id || event.id === query.id),
					),
				}),
				ask,
			},
			log: { warn: vi.fn() },
		} as unknown as PluginAPI;
		for (let i = 0; i < 2; i++) {
			const batches = new Batches(api);
			await batches.start();
			await vi.advanceTimersByTimeAsync(3600000);
			await batches.stop();
		}
		expect(ask).not.toHaveBeenCalled();
		expect(ledger.some((event) => event.type === "social.batch-read")).toBe(false);
		vi.useRealTimers();
	},
);

test("combines routed messages and restores an already admitted batch", async () => {
	vi.useFakeTimers();
	const ledger: YEvent[] = [];
	const asks: EventInput[] = [];
	const api = {
		events: {
			query: async (query: { type?: string; id?: string }) => ({
				events: ledger.filter(
					(event) => (!query.type || event.type === query.type) && (!query.id || event.id === query.id),
				),
			}),
			ask: async (input: EventInput) => {
				asks.push(input);
				const existing = ledger.find(
					(event) =>
						event.type === input.type &&
						(event.data as { msgId?: string }).msgId === (input.data as { msgId?: string }).msgId,
				);
				const event = existing ?? { ...input, id: "batch", ts: new Date().toISOString() };
				if (!existing) ledger.push(event);
				return { event, results: [{ status: "done" }] };
			},
			emit: async (input: EventInput) => {
				const event = { ...input, id: "read", ts: new Date().toISOString() };
				ledger.push(event);
				return event;
			},
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	for (const id of ["1", "2"]) {
		ledger.push({
			id,
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:chat:group",
			data: { text: id },
			routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
		});
		ledger.push({
			id: `d${id}`,
			ts: new Date().toISOString(),
			type: "routing.social-decision",
			parent: id,
			data: { agent: "a", reason: "batch", revision: "rev", policy: { batch: { count: 2, run: true } } },
		});
	}
	const batches = new Batches(api);
	await batches.start();
	await vi.runAllTimersAsync();
	expect(asks).toHaveLength(1);
	expect(asks[0]?.data).toMatchObject({ agent: "a", through: "2", sourceEvents: ["1", "2"] });
	await batches.stop();
	ledger.pop();
	const restored = new Batches(api);
	await restored.start();
	await vi.runAllTimersAsync();
	expect(asks).toHaveLength(2);
	expect(asks[1]?.data).toEqual(asks[0]?.data);
	await restored.stop();
	vi.useRealTimers();
});

test("a failed batch stays paused after restart until a newer message arrives", async () => {
	vi.useFakeTimers();
	const ledger: YEvent[] = [
		{
			id: "1",
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:chat:group",
			data: { text: "x" },
			routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
		},
		{
			id: "d1",
			ts: new Date().toISOString(),
			type: "routing.social-decision",
			parent: "1",
			data: { agent: "a", reason: "batch", revision: "rev", policy: { batch: { count: 1, run: true } } },
		},
		{
			id: "failed",
			ts: new Date().toISOString(),
			type: "social.batch-failed",
			conv: "conv:chat:group",
			data: { agent: "a", through: "1" },
		},
	];
	const ask = vi.fn(async (input: EventInput) => ({
		event: { ...input, id: "batch", ts: new Date().toISOString() },
		results: [{ status: "done" }],
	}));
	const api = {
		events: {
			query: async (query: { type?: string; id?: string }) => ({
				events: ledger.filter(
					(event) => (!query.type || event.type === query.type) && (!query.id || event.id === query.id),
				),
			}),
			ask,
			emit: async (input: EventInput) => ({ ...input, id: "read", ts: new Date().toISOString() }),
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	const batches = new Batches(api);
	await batches.start();
	await vi.runAllTimersAsync();
	expect(ask).not.toHaveBeenCalled();
	const first = ledger[0];
	const firstDecision = ledger[1];
	if (!first || !firstDecision) throw new Error("Missing test events");
	ledger.push({ ...first, id: "2" });
	const decision = { ...firstDecision, id: "d2", parent: "2" };
	await batches.accept(decision);
	await vi.runAllTimersAsync();
	expect(ask).toHaveBeenCalledTimes(1);
	expect(ask.mock.calls[0]?.[0].data).toMatchObject({ through: "2", sourceEvents: ["1", "2"] });
	await batches.stop();
	vi.useRealTimers();
});

test("a successful bot mention consumes earlier unread messages without a later batch", async () => {
	vi.useFakeTimers();
	const ledger: YEvent[] = [
		{
			id: "1",
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:chat:group",
			data: { kind: "group", text: "x" },
			routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
		},
		{
			id: "d1",
			ts: new Date().toISOString(),
			type: "routing.social-decision",
			parent: "1",
			data: { agent: "a", reason: "batch", revision: "rev", policy: { batch: { delaySeconds: 60, run: true } } },
		},
	];
	const ask = vi.fn();
	const api = {
		events: {
			query: async (query: { type?: string; id?: string }) => ({
				events: ledger.filter(
					(event) => (!query.type || event.type === query.type) && (!query.id || event.id === query.id),
				),
			}),
			ask,
			emit: async (input: EventInput) => {
				const event = { ...input, id: "read", ts: new Date().toISOString() };
				ledger.push(event);
				return event;
			},
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	const batches = new Batches(api);
	await batches.start();
	const direct: YEvent = {
		id: "2",
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:chat:group",
		data: { kind: "group", mentioned: true },
		routes: [{ agent: "a", binding: "b", session: "s", wake: "run" }],
	};
	ledger.push(direct);
	batches.direct(direct);
	await vi.advanceTimersByTimeAsync(60000);
	expect(ask).not.toHaveBeenCalled();
	const ended: YEvent = {
		id: "3",
		ts: new Date().toISOString(),
		type: "run.end",
		data: { session: "s", status: "done", inputs: ["2"] },
	};
	ledger.push(ended);
	await batches.finished(ended);
	await vi.runAllTimersAsync();
	expect(ask).not.toHaveBeenCalled();
	expect(ledger.find((event) => event.type === "social.batch-read")?.data).toMatchObject({ agent: "a", through: "1" });
	await batches.stop();
	vi.useRealTimers();
});
