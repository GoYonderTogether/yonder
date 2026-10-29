import { expect, test } from "vitest";
import { evaluateBotGate } from "../src/bot-gate.js";

const minute = 60_000;
const now = Date.parse("2026-10-28T12:00:00.000Z");
const ago = (minutes: number) => now - minutes * minute;
const bots = (...minutes: number[]) => minutes.map((m) => ({ at: ago(m), bot: true }));

test("three bot messages inside 15 minutes stay quiet", () => {
	const result = evaluateBotGate({ events: bots(14, 8, 1), now });
	expect(result.inject).toBe(false);
	expect(result.hint).toBeUndefined();
	expect(result.frequencies).toEqual([0, 0, 0]);
});

test("the fourth bot message in the window injects the hint", () => {
	const result = evaluateBotGate({ events: bots(14, 9, 4, 1), now });
	expect(result.inject).toBe(true);
	expect(result.hint).toEqual({ windowMin: 15, threshold: 3, count: 4, frequencies: [0, 0, 0] });
});

test("bot messages outside the window and human messages do not count", () => {
	const result = evaluateBotGate({
		events: [...bots(16, 20, 40), ...bots(3, 2, 1).map((event) => ({ ...event, bot: false }))],
		now,
	});
	expect(result.inject).toBe(false);
	expect(result.frequencies).toEqual([0, 1, 2]);
});

test("frequencies list the preceding windows oldest first", () => {
	const result = evaluateBotGate({ events: bots(17, 18, 32, 33, 34, 47, 2), now });
	expect(result.frequencies).toEqual([1, 3, 2]);
	expect(result.inject).toBe(false);
});

test("config overrides window, threshold and history", () => {
	const events = bots(1, 2, 3, 4, 5, 50, 60);
	const result = evaluateBotGate({ events, now, cfg: { windowMin: 30, threshold: 4, history: 1 } });
	expect(result.inject).toBe(true);
	expect(result.hint).toEqual({ windowMin: 30, threshold: 4, count: 5, frequencies: [1] });
	const lenient = evaluateBotGate({ events, now, cfg: { threshold: 5, history: 2 } });
	expect(lenient.inject).toBe(false);
	expect(lenient.frequencies).toEqual([0, 0]);
});

test("ISO timestamps and future or unparsable times are handled", () => {
	const result = evaluateBotGate({
		events: [
			{ at: "2026-10-28T11:59:00.000Z", bot: true },
			{ at: "2026-10-28T11:58:00.000Z", bot: true },
			{ at: "2026-10-28T11:57:00.000Z", bot: true },
			{ at: "2026-10-28T12:05:00.000Z", bot: true },
			{ at: "not-a-time", bot: true },
		],
		now: "2026-10-28T12:00:00.000Z",
	});
	expect(result.inject).toBe(false);
	expect(result.frequencies).toEqual([0, 0, 0]);
});
