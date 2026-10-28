import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { Batches } from "../src/batches.js";

const golden = new URL("./folded-events.golden.json", import.meta.url);
function shape(value: unknown): unknown {
	if (Array.isArray(value)) return [shape(value[0])];
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
	return typeof value;
}

test("folded batches are timed, bounded and not duplicated after restart", async () => {
	vi.useFakeTimers();
	try {
		const ledger: YEvent[] = [];
		const timestamp = new Date().toISOString();
		for (const id of ["1", "2"]) {
			ledger.push({
				id,
				ts: timestamp,
				type: "message.in",
				conv: "conv:chat:group",
				data: { text: id },
				routes: [{ agent: "a", binding: "b", session: "s", wake: "write" }],
			});
			ledger.push({
				id: `d${id}`,
				ts: timestamp,
				type: "routing.social-decision",
				parent: id,
				data: {
					agent: "a",
					reason: "folded",
					revision: "r",
					policy: { mode: "folded", foldedEverySeconds: 300, batch: { maxMessages: 1 } },
				},
			});
		}
		const ask = vi.fn();
		const api = {
			events: {
				query: async (query: { type?: string; id?: string }) => ({
					events: ledger.filter(
						(event) => (!query.type || query.type === event.type) && (!query.id || query.id === event.id),
					),
				}),
				ask,
				emit: async (input: EventInput) => {
					const event = { ...input, id: `f${ledger.length}`, ts: new Date().toISOString() };
					ledger.push(event);
					return event;
				},
			},
			log: { warn: vi.fn() },
		} as unknown as PluginAPI;
		const first = new Batches(api);
		await first.start();
		await vi.advanceTimersByTimeAsync(299999);
		expect(ledger.filter((event) => event.type === "social.folded-ready")).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(ledger.filter((event) => event.type === "social.folded-ready").map((event) => event.data)).toMatchObject([
			{ through: "1", sourceEvents: ["1"], summary: "1 条消息：1" },
		]);
		const current = {
			"social.folded-ready": shape(ledger.find((event) => event.type === "social.folded-ready")?.data),
		};
		if (process.env.UPDATE_GOLDEN === "1") {
			await writeFile(golden, `${JSON.stringify(current, null, "\t")}\n`);
			execFileSync("npx", ["biome", "format", "--write", fileURLToPath(golden)]);
		}
		expect(current).toEqual(JSON.parse(await readFile(golden, "utf8")));
		await first.stop();
		const restored = new Batches(api);
		await restored.start();
		await vi.advanceTimersByTimeAsync(300000);
		expect(ledger.filter((event) => event.type === "social.folded-ready").map((event) => event.data)).toMatchObject([
			{ through: "1" },
			{ through: "2", sourceEvents: ["2"] },
		]);
		await vi.advanceTimersByTimeAsync(600000);
		expect(ledger.filter((event) => event.type === "social.folded-ready")).toHaveLength(2);
		expect(ledger.some((event) => event.type === "social.batch-read")).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		await restored.stop();
	} finally {
		vi.useRealTimers();
	}
});
