import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { Batches } from "../src/batches.js";

const golden = new URL("./judge-events.golden.json", import.meta.url);
function shape(value: unknown): unknown {
	if (Array.isArray(value)) return [shape(value[0])];
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
	return typeof value;
}

afterEach(() => vi.useRealTimers());

function setup(result: unknown) {
	vi.useFakeTimers();
	const ts = new Date().toISOString();
	const conv = "conv:test:group";
	const ledger: YEvent[] = [
		{
			id: "001",
			ts,
			type: "message.in",
			conv,
			data: { text: "hello" },
			routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
		},
		{
			id: "002",
			ts,
			type: "routing.social-decision",
			parent: "001",
			data: { agent: "a", reason: "batch", revision: "r", policy: { batch: { count: 1 }, judge: { preset: "cheap" } } },
		},
	];
	const emit = vi.fn(async (input: EventInput) => {
		const item = { ...input, id: String(ledger.length + 1).padStart(3, "0"), ts };
		ledger.push(item);
		return item;
	});
	const ask = vi.fn(async (input: EventInput) => {
		const existing = ledger.find(
			(e) => e.type === input.type && (e.data as { msgId?: string }).msgId === (input.data as { msgId?: string }).msgId,
		);
		return { event: existing ?? (await emit(input)), results: [{ status: "done" }] };
	});
	const open = vi.fn(async () => ({ id: "judge-session" }));
	const submit = vi.fn(async () => {
		if (result instanceof Error) throw result;
		return result;
	});
	const close = vi.fn(async () => {});
	const api = {
		social: { admitBatch: async () => ({ session: "s" }) },
		sessions: { open, submit, close },
		events: {
			query: async (q: { type?: string; id?: string; conv?: string; since?: string }) => ({
				events: ledger.filter(
					(e) =>
						(!q.type || e.type === q.type) &&
						(!q.id || e.id === q.id) &&
						(!q.conv || e.conv === q.conv) &&
						(!q.since || e.ts >= q.since),
				),
			}),
			emit,
			ask,
		},
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	return { ledger, api, ask, open, submit, close };
}

async function run(api: PluginAPI) {
	const batches = new Batches(api);
	await batches.start();
	await vi.runAllTimersAsync();
	await batches.stop();
}

const response = (action: string) => ({
	status: "done",
	text: JSON.stringify({ action, sourceEvents: ["001"], reason: "relevant" }),
});

test.each(["participate", "ignore"])("judge %s records its decision and applies it", async (action) => {
	const { api, ledger, ask, open, submit, close } = setup(response(action));
	await run(api);
	expect(open).toHaveBeenCalledWith({ preset: "cheap", modelSource: { session: "s" }, judgment: true });
	expect(submit).toHaveBeenCalledTimes(1);
	expect(close).toHaveBeenCalledWith("judge-session");
	expect(ledger.find((e) => e.type === "social.judge-result")?.data).toMatchObject({
		action,
		through: "001",
		sourceEvents: ["001"],
	});
	expect(ask).toHaveBeenCalledTimes(action === "participate" ? 1 : 0);
	expect(ledger.filter((e) => e.type === "social.batch-read")).toHaveLength(1);
	if (action === "participate") {
		const start = ledger.find((event) => event.type === "social.judge-start");
		const result = ledger.find((event) => event.type === "social.judge-result");
		expect(start).toBeDefined();
		expect(result).toBeDefined();
		const current = {
			"social.judge-start": shape(start?.data),
			"social.judge-result": shape(result?.data),
		};
		if (process.env.UPDATE_GOLDEN === "1") {
			await writeFile(golden, `${JSON.stringify(current, null, "\t")}\n`);
			execFileSync("npx", ["biome", "format", "--write", fileURLToPath(golden)]);
		}
		expect(current).toEqual(JSON.parse(await readFile(golden, "utf8")));
	}
});

test.each([
	{ status: "done", text: "not JSON" },
	{ status: "done", text: JSON.stringify({ action: "participate", sourceEvents: ["other"], reason: "x" }) },
	{ status: "failed", text: JSON.stringify({ action: "participate", sourceEvents: ["001"], reason: "x" }) },
	new Error("session failed"),
])("invalid or failed judgment does not promote the batch: %o", async (result) => {
	const { api, ledger, ask, open } = setup(result);
	await run(api);
	await run(api);
	expect(open).toHaveBeenCalledTimes(1);
	expect(ask).not.toHaveBeenCalled();
	expect(ledger.some((e) => e.type === "social.judge-result" || e.type === "social.batch-read")).toBe(false);
	expect(ledger.filter((e) => e.type === "social.batch-failed")).toHaveLength(1);
});

test("recovery reuses a persisted participate result and deduplicates the batch", async () => {
	const { api, ledger, ask, open } = setup(response("participate"));
	await run(api);
	const read = ledger.findIndex((e) => e.type === "social.batch-read");
	expect(read).toBeGreaterThan(-1);
	ledger.splice(read, 1);
	await run(api);
	expect(open).toHaveBeenCalledTimes(1);
	expect(ask).toHaveBeenCalledTimes(2);
	expect(ledger.filter((e) => e.type === "social.judge-result")).toHaveLength(1);
	expect(ledger.filter((e) => e.type === "social.batch-ready")).toHaveLength(1);
	expect(ledger.filter((e) => e.type === "social.batch-read")).toHaveLength(1);
});

test("recovery leaves an unfinished judgment pending without a second call", async () => {
	const { api, ledger, open, ask } = setup(response("participate"));
	ledger.push({
		id: "003",
		ts: new Date().toISOString(),
		type: "social.judge-start",
		conv: "conv:test:group",
		data: { agent: "a", through: "001" },
	});
	await run(api);
	expect(open).not.toHaveBeenCalled();
	expect(ask).not.toHaveBeenCalled();
	expect(ledger.some((e) => e.type === "social.batch-read")).toBe(false);
});

test("a durable judge completed after interruption is recovered without a second call", async () => {
	const { api, ledger, open, ask } = setup(response("participate"));
	(api.sessions as unknown as { transcript: () => Promise<unknown> }).transcript = async () => [
		{ kind: "pi.assistant", text: response("participate").text },
	];
	ledger.push({
		id: "003",
		ts: new Date().toISOString(),
		type: "social.judge-start",
		conv: "conv:test:group",
		data: { agent: "a", through: "001", session: "judge-session" },
	});
	ledger.push({
		id: "004",
		ts: new Date().toISOString(),
		type: "run.end",
		data: { session: "judge-session", status: "done" },
	});
	await run(api);
	await run(api);
	expect(open).not.toHaveBeenCalled();
	expect(ask).toHaveBeenCalledTimes(1);
	expect(ledger.filter((event) => event.type === "social.judge-result")).toHaveLength(1);
	expect(ledger.filter((event) => event.type === "social.batch-read")).toHaveLength(1);
});
