import { DateTime } from "luxon";

export const monthPath = (month: string) => `timeline/${month}/month.md`;
export const yearPath = (year: string | number) => `life/${year}.md`;

export function moment(zone: string, when?: string): DateTime {
	const now = DateTime.now().setZone(zone);
	const date = when === undefined ? now : DateTime.fromISO(when, { zone });
	if (!date.isValid) throw new Error("when: invalid ISO date or datetime");
	if (date.toMillis() > now.toMillis()) throw new Error("when: future dates are not allowed");
	return date;
}
export function weekInfo(date: DateTime) {
	const monday = date.startOf("week"),
		thursday = monday.plus({ days: 3 });
	const week = `${date.weekYear}-W${String(date.weekNumber).padStart(2, "0")}`;
	const month = thursday.toFormat("yyyy-MM");
	return {
		week,
		month,
		path: `timeline/${month}/${week}.md`,
		range: `${monday.toISODate()}..${monday.plus({ days: 6 }).toISODate()}`,
	};
}
export function weekDate(week: string, zone: string): DateTime {
	if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error("week: expected YYYY-Www");
	const date = DateTime.fromISO(`${week}-1`, { zone });
	if (!date.isValid || weekInfo(date).week !== week) throw new Error("week: invalid ISO week");
	return date;
}
export function heading(date: DateTime): string {
	return `### ${date.toFormat("MM-dd")} 周${["一", "二", "三", "四", "五", "六", "日"][date.weekday - 1]}`;
}
export const weekSections = ["本周计划", "提议", "决定", "产出", "复盘", "记录流"];
export const monthSections = ["月目标", "提议", "月复盘", "阶段变化", "历史"];
export function weekTemplate(date: DateTime): string {
	const info = weekInfo(date);
	return `---\nweek: ${info.week}\nrange: ${info.range}\nstatus: open\n---\n${weekSections.map((s) => `## ${s}\n`).join("")}`;
}
export function monthTemplate(): string {
	return monthSections.map((s) => `## ${s}\n`).join("");
}
