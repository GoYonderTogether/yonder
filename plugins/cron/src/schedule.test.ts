import { describe, expect, it } from "vitest";
import { instant, next, validateSchedule } from "./schedule.js";

describe("cron scheduling", () => {
	it("uses the mature parser for five/six fields, ranges, lists and DST", () => {
		const schedule = { kind: "cron", expression: "0 9 * * 1-5", timezone: "America/New_York" } as const;
		validateSchedule(schedule);
		expect(next(schedule, Date.parse("2026-03-06T15:00:00Z"))).toBe(Date.parse("2026-03-09T13:00:00Z"));
		expect(next({ ...schedule, expression: "*/15 1,2 9 * * 1-5" }, Date.parse("2026-03-09T13:01:00Z"))).toBe(
			Date.parse("2026-03-09T13:01:15Z"),
		);
	});
	it("keeps the interval anchor, window, and one shot precise", () => {
		const schedule = { kind: "every", milliseconds: 1000, anchor: "2026-10-19T00:00:00Z", timezone: "UTC" } as const;
		expect(next(schedule, instant(schedule.anchor) + 2500)).toBe(instant(schedule.anchor) + 3000);
		expect(next(schedule, instant(schedule.anchor), "2026-10-19T00:00:05Z", "2026-10-19T00:00:05Z")).toBe(
			instant(schedule.anchor) + 5000,
		);
		expect(next(schedule, instant(schedule.anchor) + 5000, undefined, "2026-10-19T00:00:05Z")).toBeNull();
		expect(next({ kind: "at", at: schedule.anchor, timezone: "UTC" }, instant(schedule.anchor))).toBeNull();
	});
	it("rejects ambiguous timestamps, invalid zones and fields", () => {
		expect(() => instant("2026-10-19T00:00:00")).toThrow();
		expect(() => validateSchedule({ kind: "cron", expression: "* * *", timezone: "UTC" })).toThrow();
		expect(() => validateSchedule({ kind: "at", at: "2026-10-19T00:00:00Z", timezone: "invalid" })).toThrow();
	});
});
