import { CronExpressionParser } from "cron-parser";

export type Schedule =
	| { kind: "at"; at: string; timezone: string }
	| { kind: "every"; milliseconds: number; timezone: string; anchor: string }
	| { kind: "cron"; expression: string; timezone: string };
export function instant(value: unknown): number {
	if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
		throw new Error("Timestamp must be ISO8601 with an explicit UTC offset");
	return Date.parse(value);
}
export function validateSchedule(schedule: Schedule): void {
	if (!schedule || typeof schedule.timezone !== "string" || !schedule.timezone)
		throw new Error("Explicit IANA timezone required");
	new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format();
	if (schedule.kind === "at") instant(schedule.at);
	else if (schedule.kind === "every") {
		if (!Number.isSafeInteger(schedule.milliseconds) || schedule.milliseconds < 1000)
			throw new Error("every milliseconds must be an integer >=1000");
		instant(schedule.anchor);
	} else if (schedule.kind === "cron") {
		if (typeof schedule.expression !== "string" || ![5, 6].includes(schedule.expression.trim().split(/\s+/).length))
			throw new Error("5 or 6 cron fields required");
		CronExpressionParser.parse(schedule.expression, { tz: schedule.timezone });
	} else throw new Error("Unknown schedule kind");
}
/** First occurrence strictly after after; no occurrence is represented by null. */
export function next(schedule: Schedule, after: number, start?: string, end?: string): number | null {
	const floor = Math.max(after, start === undefined ? -Infinity : instant(start) - 1);
	let value: number;
	if (schedule.kind === "at") value = instant(schedule.at) > floor ? instant(schedule.at) : Infinity;
	else if (schedule.kind === "every") {
		const anchor = instant(schedule.anchor);
		value = anchor + Math.max(0, Math.floor((floor - anchor) / schedule.milliseconds) + 1) * schedule.milliseconds;
	} else {
		const expression = CronExpressionParser.parse(schedule.expression, {
			currentDate: new Date(floor),
			tz: schedule.timezone,
		});
		if (!expression.hasNext()) return null;
		value = expression.next().getTime();
	}
	return Number.isFinite(value) && (end === undefined || value <= instant(end)) ? value : null;
}
