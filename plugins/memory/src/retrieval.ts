import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { promisify } from "node:util";
import { DateTime } from "luxon";
import { type Static, Type } from "typebox";
import { weekDate, weekInfo } from "./calendar.js";
import type { Config } from "./config.js";
import { metadata, readText, safePath } from "./files.js";
import { manifest } from "./manifest.js";
import { type Origin, records, sourceOrigins } from "./records.js";

const exec = promisify(execFile);
const optional = Type.Optional;
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const origins = ["human-written", "human-said", "agent", "external", "legacy", "derived"] as const;
export const searchSchema = Type.Object(
	{
		terms: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 }),
		match: optional(Type.Union([Type.Literal("any"), Type.Literal("all")])),
		zones: optional(Type.Array(Type.String())),
		since: optional(date),
		until: optional(date),
		origin: optional(
			Type.Array(
				Type.Union([
					Type.Literal("human-written"),
					Type.Literal("human-said"),
					Type.Literal("agent"),
					Type.Literal("external"),
					Type.Literal("legacy"),
					Type.Literal("derived"),
				]),
			),
		),
		limit: optional(Type.Integer({ minimum: 1, maximum: 100 })),
		includePrivate: optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export const readSchema = Type.Object(
	{
		path: optional(Type.String({ minLength: 1 })),
		week: optional(Type.String({ pattern: "^\\d{4}-W\\d{2}$" })),
		fromLine: optional(Type.Integer({ minimum: 1 })),
		lines: optional(Type.Integer({ minimum: 1, maximum: 400 })),
		includePrivate: optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export type SearchArgs = Static<typeof searchSchema>;
export type ReadArgs = Static<typeof readSchema>;
interface Location {
	root: string;
	path: string;
	registered: boolean;
	origin?: Origin;
	prefix: string;
}
function location(config: Config, path: string): Location {
	if (isAbsolute(path)) throw new Error("path: expected a relative path");
	const colon = path.indexOf(":");
	if (colon < 0) return { root: config.root, path, registered: false, prefix: "" };
	const name = path.slice(0, colon),
		source = config.roots?.find((r) => r.name === name);
	if (!source) throw new Error(`path: unknown registered source ${name}`);
	return {
		root: source.path,
		path: path.slice(colon + 1),
		registered: true,
		prefix: `${name}:`,
		origin: source.origin === "human" ? "human-written" : (source.origin ?? "legacy"),
	};
}
function fileOrigin(loc: Location, meta: Record<string, unknown>): Origin {
	if (loc.registered) return loc.origin ?? "legacy";
	if (loc.path.startsWith("mine/")) return "human-written";
	if ((loc.path.startsWith("raw/") || loc.path.startsWith("archive/")) && origins.includes(meta.origin as Origin))
		return meta.origin as Origin;
	return loc.path.startsWith("raw/") || loc.path.startsWith("archive/") ? "legacy" : "derived";
}
async function document(config: Config, loc: Location, includePrivate: boolean, signal: AbortSignal) {
	signal.throwIfAborted();
	const file = await safePath(loc.root, loc.path),
		info = await stat(file);
	if (!info.isFile()) throw new Error("path: not a regular file");
	const text = await readText(loc.root, loc.path),
		meta = metadata(text);
	if ((loc.path.split("/")[0] === "private" || meta.private === true) && !includePrivate)
		throw new Error("Private content requires includePrivate: true");
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	const original =
		!loc.registered && loc.path.startsWith("raw/") ? (await manifest(config.root)).files[loc.path] : undefined;
	const origin = original?.origin ?? fileOrigin(loc, meta),
		fallback = DateTime.fromMillis(info.mtimeMs, { zone: config.timezone }).toISODate()!;
	const facts = lines.map(() => ({ origin, date: fallback }));
	if (!loc.registered && !original) {
		const range = typeof meta.range === "string" ? meta.range.split("..")[0] : undefined;
		const month = /^private\/(\d{4}-\d{2})\.md$/.exec(loc.path)?.[1];
		const entries = records(text, range ?? (month ? `${month}-01` : undefined));
		for (const entry of entries)
			for (let i = entry.start; i < entry.end; i++)
				facts[i] = { origin: sourceOrigins[entry.source], date: entry.date ?? fallback };
	}
	return { text, lines, facts, origin };
}
export async function read(config: Config, args: ReadArgs, signal: AbortSignal) {
	if ((args.path === undefined) === (args.week === undefined))
		throw new Error("path and week: exactly one is required");
	const path = args.path ?? weekInfo(weekDate(args.week!, config.timezone)).path;
	const doc = await document(config, location(config, path), args.includePrivate === true, signal);
	const fromLine = args.fromLine ?? 1,
		end = Math.min(doc.lines.length, fromLine - 1 + (args.lines ?? 200));
	const text = doc.lines.slice(fromLine - 1, end).join("\n");
	return {
		path,
		origin: doc.origin,
		fromLine,
		toLine: end,
		totalLines: doc.lines.length,
		text: text.slice(0, 12000),
		truncated: end < doc.lines.length || text.length > 12000,
	};
}
interface RgRow {
	type: string;
	data: { path?: { text?: string }; line_number?: number; submatches?: unknown[] };
}
async function grep(root: string, term: string, signal: AbortSignal): Promise<RgRow[]> {
	try {
		const result = await exec(
			"rg",
			[
				"--json",
				"--fixed-strings",
				"--ignore-case",
				"--no-follow",
				"--no-ignore",
				"--iglob",
				"*.{md,markdown,txt}",
				"--glob",
				"!**/.*",
				"--glob",
				"!**/.*/**",
				"--glob",
				"!**/node_modules/**",
				"--",
				term,
				root,
			],
			{ signal, maxBuffer: 64 * 1024 * 1024 },
		);
		return result.stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RgRow)
			.filter((row) => row.type === "match");
	} catch (error) {
		signal.throwIfAborted();
		const failure = error as { code?: number | string; stderr?: string };
		if (failure.code === 1) return [];
		if (failure.code === "ENOENT")
			throw new Error("ripgrep (rg) unavailable in PATH; install rg and expose it to the service");
		throw new Error(`rg search failed: ${failure.stderr || (error as Error).message}`);
	}
}
const defaultZones = ["timeline", "life", "me", "mine", "raw", "projects"];
interface Hit {
	line: number;
	origin: Origin;
	date?: string;
	text: string;
}
export async function search(config: Config, args: SearchArgs, signal: AbortSignal) {
	for (const [field, value] of [
		["since", args.since],
		["until", args.until],
	] as const)
		if (value && !DateTime.fromISO(value, { zone: config.timezone }).isValid) throw new Error(`${field}: invalid date`);
	if (args.since && args.until && args.since > args.until) throw new Error("since must not be after until");
	const zones = args.zones ?? [
		...defaultZones,
		...(config.roots ?? []).map((r) => r.name),
		...(args.includePrivate ? ["private"] : []),
	];
	const known = new Set([...defaultZones, "archive", "private", ...(config.roots ?? []).map((r) => r.name)]);
	for (const zone of zones) if (!known.has(zone)) throw new Error(`zones: unknown zone ${zone}`);
	const locations: Location[] = [];
	for (const zone of new Set(zones)) {
		if (zone === "private" && !args.includePrivate) continue;
		if ([...defaultZones, "archive", "private"].includes(zone)) locations.push(location(config, zone));
		for (const source of config.roots ?? []) if (source.name === zone) locations.push(location(config, `${zone}:`));
	}
	const terms = [...new Set(args.terms)];
	const files = new Map<string, { loc: Location; lines: Map<number, Map<number, number>> }>();
	for (const loc of locations) {
		signal.throwIfAborted();
		let root: string;
		let base: string;
		try {
			base = await safePath(loc.root, "");
			root = await safePath(base, loc.path);
			await stat(root);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		for (const [termIndex, term] of terms.entries())
			for (const variant of new Set([term, term.normalize("NFKC")])) {
				for (const row of await grep(root, variant, signal)) {
					if (!row.data.path?.text || !row.data.line_number) continue;
					const path = relative(base, row.data.path.text).replaceAll("\\", "/");
					if (path.split(/[\\/]/).some((p) => p.startsWith(".") || p === "node_modules")) continue;
					await safePath(base, path);
					const key = loc.prefix + path;
					let entry = files.get(key);
					if (!entry) {
						entry = { loc: { ...loc, root: base, path }, lines: new Map() };
						files.set(key, entry);
					}
					let hits = entry.lines.get(row.data.line_number);
					if (!hits) {
						hits = new Map();
						entry.lines.set(row.data.line_number, hits);
					}
					hits.set(termIndex, Math.max(hits.get(termIndex) ?? 0, row.data.submatches?.length ?? 1));
				}
			}
	}
	const results: Array<{ path: string; hits: Hit[]; terms: number; count: number; newest: string }> = [];
	for (const [path, entry] of files) {
		let doc: Awaited<ReturnType<typeof document>>;
		try {
			doc = await document(config, entry.loc, args.includePrivate === true, signal);
		} catch (error) {
			if ((error as Error).message === "Private content requires includePrivate: true") continue;
			throw error;
		}
		const hits: Hit[] = [],
			matched = new Set<number>();
		let count = 0,
			newest = "";
		for (const [line, termHits] of entry.lines) {
			const fact = doc.facts[line - 1];
			if (
				!fact ||
				(args.origin && !args.origin.includes(fact.origin)) ||
				(args.since && fact.date < args.since) ||
				(args.until && fact.date > args.until)
			)
				continue;
			for (const [term, n] of termHits) {
				matched.add(term);
				count += n;
			}
			newest = newest > fact.date ? newest : fact.date;
			hits.push({ line, ...fact, text: doc.lines.slice(Math.max(0, line - 2), line + 1).join("\n") });
		}
		if (hits.length && (args.match !== "all" || matched.size === terms.length))
			results.push({ path, hits: hits.sort((a, b) => a.line - b.line), terms: matched.size, count, newest });
	}
	results.sort(
		(a, b) =>
			b.terms - a.terms || b.count - a.count || b.newest.localeCompare(a.newest) || a.path.localeCompare(b.path),
	);
	const limit = args.limit ?? 20;
	return {
		files: results.slice(0, limit).map(({ path, hits }) => ({ path, hits })),
		total: results.length,
		truncated: results.length > limit,
	};
}
