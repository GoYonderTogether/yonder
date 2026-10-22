import { createHash } from "node:crypto";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { DateTime } from "luxon";
import { Type } from "typebox";
import { monthTemplate, weekDate, weekInfo, weekTemplate } from "./calendar.js";
import { recordId } from "./capture.js";
import type { Config } from "./config.js";
import { metadata, readText, textFiles } from "./files.js";
import { owner } from "./ingest.js";
import { organizeText, records, writeSection } from "./records.js";
import { Store, type WriteContext } from "./store.js";

const str = Type.String({ minLength: 1 }),
	opt = Type.Optional;
const en = (values: string[]) => Type.Union(values.map((v) => Type.Literal(v)));
const object = (fields: Record<string, import("typebox").TSchema>) =>
	Type.Object(fields, { additionalProperties: false });
const period = { scope: en(["vision", "year", "month", "week"]), period: opt(str) };
export const planSchema = Type.Union([
	object({ op: Type.Literal("get"), ...period }),
	object({
		op: Type.Literal("propose"),
		scope: en(["year", "month", "week"]),
		period: opt(str),
		items: Type.Array(object({ text: str, due: opt(str) }), { minItems: 1 }),
	}),
	object({ op: Type.Literal("commit"), ...period, ids: Type.Array(str, { minItems: 1 }) }),
	object({
		op: Type.Literal("update"),
		scope: Type.Literal("week"),
		period: opt(str),
		id: str,
		status: en(["done", "postponed", "dropped", "open"]),
	}),
]);
export const reviewSchema = Type.Union([
	object({ op: Type.Literal("pending"), week: opt(str), limit: opt(Type.Integer({ minimum: 1, maximum: 200 })) }),
	object({
		op: Type.Literal("organize"),
		entries: Type.Array(
			object({
				id: str,
				to: Type.String({ pattern: "^(me/(now|profile|mind)|plan|decision|output|none|project:.+)$" }),
			}),
		),
	}),
	object({
		op: Type.Literal("section"),
		scope: en(["week", "month"]),
		period: opt(str),
		name: str,
		mode: en(["append", "replace"]),
		text: Type.String(),
	}),
	object({ op: Type.Literal("close"), week: opt(str) }),
]);
export const meSchema = Type.Union([
	object({ op: Type.Literal("read"), file: opt(en(["now", "profile", "mind"])) }),
	object({
		op: Type.Literal("add"),
		file: en(["now", "profile", "mind"]),
		text: str,
		status: en(["confirmed", "inferred"]),
		evidence: opt(str),
	}),
	object({
		op: Type.Literal("supersede"),
		id: str,
		text: str,
		status: opt(en(["confirmed", "inferred"])),
		evidence: opt(str),
	}),
	object({ op: Type.Literal("confirm"), id: str }),
]);
export interface Args {
	op: string;
	scope?: string;
	period?: string;
	ids?: string[];
	id?: string;
	status?: string;
	items?: Array<{ text: string; due?: string }>;
	week?: string;
	limit?: number;
	entries?: Array<{ id: string; to: string }>;
	name?: string;
	mode?: "append" | "replace";
	text?: string;
	file?: string;
	evidence?: string;
}
interface EntryState {
	createdAt: string;
	hash: string;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function section(text: string, name: string): string {
	const lines = text.split("\n"),
		start = lines.indexOf(`## ${name}`);
	if (start < 0) return "";
	let end = start + 1;
	while (end < lines.length && !lines[end]!.startsWith("## ")) end++;
	return lines.slice(start + 1, end).join("\n");
}
export class Organizer {
	readonly store: Store;
	constructor(
		readonly api: PluginAPI,
		readonly config: Config,
	) {
		this.store = new Store(config.root);
	}
	meta(ctx: ToolContext, op: string, id = "-"): WriteContext {
		return { op, id, by: ctx.agent ? `agent:${ctx.agent}` : "plugin:memory", session: ctx.session, signal: ctx.signal };
	}
	async state(): Promise<Record<string, EntryState>> {
		try {
			return JSON.parse(await readText(this.config.root, ".memory/entries.json"));
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw e;
		}
	}
	async remember(id: string, text: string, ctx: ToolContext, createdAt = new Date().toISOString()) {
		await this.store.edit(
			".memory/entries.json",
			(old) => JSON.stringify({ ...JSON.parse(old ?? "{}"), [id]: { createdAt, hash: hash(text) } }),
			this.meta(ctx, "memory.metadata", id),
		);
	}
	async confirmed(ctx: ToolContext, id: string) {
		if (!(await owner(this.api, this.config, ctx.event)))
			throw new Error("Confirmation requires current owner message.in");
		const created = (await this.state())[id]?.createdAt;
		if (!created || Date.parse(created) >= Date.parse(ctx.event!.ts))
			throw new Error("Proposal must precede the owner event; confirm in a later run");
		return `evt:${ctx.event!.id}`;
	}
	async evidence(evidence: string | undefined, ctx: ToolContext) {
		if (
			evidence?.startsWith("evt:") &&
			evidence === `evt:${ctx.event?.id}` &&
			(await owner(this.api, this.config, ctx.event))
		)
			return evidence;
		if (evidence?.startsWith("^"))
			for (const item of await this.pendingFiles()) {
				const entry = records(await readText(this.config.root, item)).find((e) => `^${e.id}` === evidence);
				if (entry && ["chat", "wechat-self"].includes(entry.source)) return evidence;
			}
		throw new Error("confirmed requires owner evt: evidence or plugin chat/wechat-self record evidence");
	}
	period(args: Args) {
		const now = DateTime.now().setZone(this.config.timezone),
			scope = args.scope ?? "week";
		if (scope === "week") {
			const date = args.period ? weekDate(args.period, this.config.timezone) : now;
			const info = weekInfo(date);
			return { path: info.path, template: weekTemplate(date), target: "本周计划" };
		}
		if (scope === "month") {
			const value = args.period ?? now.toFormat("yyyy-MM");
			if (!/^\d{4}-\d{2}$/.test(value) || !DateTime.fromISO(`${value}-01`).isValid) throw new Error("Invalid month");
			return { path: `timeline/${value}/month.md`, template: monthTemplate(), target: "月目标" };
		}
		if (scope === "year") {
			const value = args.period ?? String(now.year);
			if (!/^\d{4}$/.test(value)) throw new Error("Invalid year");
			return { path: `life/${value}.md`, template: "## 年度目标\n## 提议\n## 历史\n", target: "年度目标" };
		}
		return { path: "life/vision.md", template: "## 愿景\n## 提议\n## 历史\n", target: "愿景" };
	}
	async plan(args: Args, ctx: ToolContext) {
		const doc = this.period(args),
			meta = this.meta(ctx, `memory_plan.${args.op}`);
		if (args.op === "get") {
			let text = doc.template;
			try {
				text = await readText(this.config.root, doc.path);
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			}
			return { path: doc.path, text };
		}
		await this.store.ensure(doc.path, doc.template, meta);
		if (args.op === "propose") {
			const entries = (args.items ?? []).map((item) => {
				if (item.due && (!/^\d{4}-\d{2}-\d{2}$/.test(item.due) || !DateTime.fromISO(item.due).isValid))
					throw new Error("Invalid due date");
				return { id: recordId(), text: item.text, due: item.due };
			});
			const lines = entries
				.map((e) => `- [ ] ${e.text.replace(/\n/g, "\n  ")}${e.due ? ` 📅 ${e.due}` : ""} ^${e.id}`)
				.join("\n");
			await this.store.edit(doc.path, (text) => writeSection(text!, "提议", lines, "append"), meta);
			for (const e of entries) await this.remember(e.id, e.text, ctx);
			return { path: doc.path, ids: entries.map((e) => e.id) };
		}
		if (args.op === "commit") {
			for (const id of args.ids ?? []) await this.confirmed(ctx, id);
			await this.store.edit(
				doc.path,
				(text) => {
					const proposed = section(text!, "提议"),
						blocks = proposed.split(/\n(?=- \[)/),
						selected: string[] = [],
						left: string[] = [];
					for (const b of blocks) ((args.ids ?? []).some((id) => b.includes(`^${id}`)) ? selected : left).push(b);
					for (const id of args.ids ?? [])
						if (!selected.some((b) => b.includes(`^${id}`))) throw new Error(`Proposal not found: ${id}`);
					return writeSection(
						writeSection(text!, "提议", left.join("\n"), "replace"),
						doc.target,
						selected.map((b) => `${b.trimEnd()} (ref: evt:${ctx.event!.id})`).join("\n"),
						"append",
					);
				},
				meta,
			);
			return { path: doc.path, ids: args.ids };
		}
		await this.store.edit(
			doc.path,
			(text) => {
				const body = section(text!, "本周计划"),
					blocks = body.split(/\n(?=- \[)/);
				let found = false;
				const changed = blocks.map((b) => {
					if (!b.includes(`^${args.id}`)) return b;
					found = true;
					const mark = { done: "x", postponed: ">", dropped: "-", open: " " }[args.status!];
					let next = b.replace(/^- \[[ x>-]\]/, `- [${mark}]`);
					if (args.status === "postponed") {
						const n = Number(/⟳(\d+)/.exec(next)?.[1] ?? 0);
						next = next.replace(/\s*⟳\d+/, "").trimEnd() + ` ⟳${n + 1}`;
					}
					return next;
				});
				if (!found) throw new Error("Plan item not found");
				return writeSection(text!, "本周计划", changed.join("\n"), "replace");
			},
			meta,
		);
		return { path: doc.path, ids: [args.id] };
	}
	async pendingFiles() {
		return (await textFiles(this.config.root)).filter((p) => p.startsWith("timeline/") && /W\d{2}\.md$/.test(p));
	}
	async review(args: Args, ctx: ToolContext) {
		if (args.op === "pending") {
			const entries = [];
			for (const path of await this.pendingFiles()) {
				const text = await readText(this.config.root, path);
				if (metadata(text).private === true || (args.week && !path.endsWith(`${args.week}.md`))) continue;
				for (const e of records(text))
					if (!e.done)
						entries.push({ id: e.id, week: metadata(text).week, time: e.time, source: e.source, text: e.text });
			}
			return { entries: entries.slice(0, args.limit ?? 50) };
		}
		if (args.op === "organize") {
			const paths: string[] = [];
			for (const e of args.entries ?? []) {
				let found = false;
				for (const path of await this.pendingFiles())
					if (records(await readText(this.config.root, path)).some((r) => r.id === e.id)) {
						await this.store.edit(
							path,
							(text) => organizeText(text!, e.id, e.to),
							this.meta(ctx, "memory_review.organize", e.id),
						);
						paths.push(path);
						found = true;
						break;
					}
				if (!found) throw new Error(`Record not found: ${e.id}`);
			}
			return { ids: args.entries?.map((e) => e.id), paths };
		}
		const doc = this.period({
			op: "get",
			scope: args.op === "close" ? "week" : (args.scope ?? "week"),
			...((args.week ?? args.period) ? { period: (args.week ?? args.period)! } : {}),
		});
		if (args.op === "section") {
			const names = args.scope === "month" ? ["月复盘", "阶段变化"] : ["决定", "产出", "复盘"];
			if (!names.includes(args.name!)) throw new Error("Invalid writable section");
			await this.store.edit(
				doc.path,
				(text) => writeSection(text ?? doc.template, args.name!, args.text!, args.mode!),
				this.meta(ctx, "memory_review.section"),
			);
		} else {
			await this.store.edit(
				doc.path,
				(text) => {
					if (!text || !section(text, "复盘").trim()) throw new Error("Cannot close a week with an empty review");
					return text.replace(/^status: open\r?$/m, "status: reviewed");
				},
				this.meta(ctx, "memory_review.close"),
			);
		}
		const text = await readText(this.config.root, doc.path);
		return {
			path: doc.path,
			ids: [],
			warnings: args.op === "close" && records(text).some((e) => !e.done) ? ["Unorganized entries remain"] : [],
		};
	}
	async me(args: Args, ctx: ToolContext) {
		const paths = args.file ? [`me/${args.file}.md`] : ["me/now.md", "me/profile.md", "me/mind.md"];
		if (args.op === "read") {
			const state = await this.state();
			return {
				files: await Promise.all(
					paths.map(async (path) => {
						let text = await readText(this.config.root, path);
						text = text.replace(/^- [^\n]*(?:\n {2}[^\n]*)*/gm, (line) => {
							const id = /\^(m\w+)/.exec(line)?.[1];
							return id && (!state[id] || state[id].hash !== hash(line))
								? line.replace("{inferred}", "{confirmed}")
								: line;
						});
						return { path, text };
					}),
				),
			};
		}
		let path = paths[0]!,
			oldLine: string | undefined;
		if (args.op !== "add") {
			path = "";
			for (const p of paths) {
				oldLine = [...(await readText(this.config.root, p)).matchAll(/^- [^\n]*(?:\n {2}[^\n]*)*/gm)]
					.map((m) => m[0])
					.find((l) => l.includes(`^${args.id}`));
				if (oldLine) {
					path = p;
					break;
				}
			}
			if (!path) throw new Error("Me entry not found");
		}
		const status = args.op === "confirm" ? "confirmed" : (args.status ?? "inferred");
		const evidence =
			args.op === "confirm"
				? await this.confirmed(ctx, args.id!)
				: status === "confirmed"
					? await this.evidence(args.evidence, ctx)
					: (args.evidence ?? `agent:${ctx.agent ?? "memory"}`);
		const id = args.op === "confirm" ? args.id! : recordId(),
			today = DateTime.now().setZone(this.config.timezone).toISODate();
		const line =
			args.op === "confirm"
				? oldLine!.replace("{inferred}", "{confirmed}").replace(/\(ref: [^)]*\)/, `(ref: ${evidence})`)
				: `- ${args.text!.replace(/\n/g, "\n  ")} {${status}} [自 ${today}] (ref: ${evidence}) ^${id}`;
		await this.store.edit(
			path,
			(text) => {
				if (args.op === "confirm") return text!.replace(oldLine!, line);
				let next = text ?? "## 当前\n## 历史\n";
				if (args.op === "supersede")
					next = writeSection(next.replace(oldLine! + "\n", ""), "历史", `${oldLine} [至 ${today}]`, "append");
				const offset = next.indexOf("## 历史");
				if (offset < 0) throw new Error("Missing 历史 section");
				return next.slice(0, offset) + line + "\n" + next.slice(offset);
			},
			this.meta(ctx, `memory_me.${args.op}`, id),
		);
		await this.remember(id, line, ctx, args.op === "confirm" ? (await this.state())[id]!.createdAt : undefined);
		return { path, ids: [id] };
	}
}
