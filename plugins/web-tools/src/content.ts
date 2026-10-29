import { resolve, sep } from "node:path";
import { executionContext, type ToolContext } from "@yonder/sdk";
import { MAX_OUTPUT, object, output, schema, string } from "./shared.js";

export const FIND_MODES = ["exact", "case-insensitive", "fuzzy"] as const;
export type FindMode = (typeof FIND_MODES)[number];
const CONTEXT_CHARS = 400;

export const contentParameters = schema(
	{
		responseId: string,
		query: { type: "string" },
		queryIndex: { type: "integer", minimum: 0 },
		url: { type: "string" },
		urlIndex: { type: "integer", minimum: 0 },
		offset: { type: "integer", minimum: 0 },
		limit: { type: "integer", minimum: 1, maximum: MAX_OUTPUT, description: "Characters, default the maximum" },
		findText: {
			anyOf: [
				{ type: "string", minLength: 1, maxLength: 500 },
				{ type: "array", items: { type: "string", minLength: 1, maxLength: 500 }, minItems: 1, maxItems: 10 },
			],
			description: "Find passages instead of paging",
		},
		findMode: { type: "string", enum: FIND_MODES },
	},
	["responseId"],
);

/** The only readable responseId is a tool-output cache path of this session; anything else is refused. */
export function cachePath(responseId: string, session: string) {
	const value = responseId.trim();
	if (!value) throw new Error("responseId required");
	const normalized = resolve(value);
	const match = /(?:^|\/)cache\/tool-output\/([0-9]+)\/([^/]+)$/.exec(normalized.split(sep).join("/"));
	if (!match) throw new Error(`UNKNOWN_RESPONSE_ID: ${value} is not a stored tool-output path`);
	if (match[1] !== session) throw new Error(`UNKNOWN_RESPONSE_ID: ${value} belongs to another session`);
	return normalized;
}

type Range = { start: number; end: number };
type Match = { start: number; end: number };

function normalizeText(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}
function editDistanceWithin(left: string, right: string, maximum: number) {
	if (Math.abs(left.length - right.length) > maximum) return false;
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		const current = [i];
		let rowMinimum = i;
		for (let j = 1; j <= right.length; j++) {
			const value = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
			current[j] = value;
			rowMinimum = Math.min(rowMinimum, value);
		}
		if (rowMinimum > maximum) return false;
		previous = current;
	}
	return (previous[right.length] ?? Infinity) <= maximum;
}
function literalMatches(text: string, query: string, caseInsensitive: boolean): Match[] {
	const haystack = caseInsensitive ? text.toLocaleLowerCase() : text;
	const needle = caseInsensitive ? query.toLocaleLowerCase() : query;
	const matches: Match[] = [];
	for (
		let start = haystack.indexOf(needle);
		start >= 0;
		start = haystack.indexOf(needle, start + Math.max(needle.length, 1))
	)
		matches.push({ start, end: start + query.length });
	return matches;
}
function tolerance(token: string) {
	return token.length >= 9 ? 2 : token.length >= 5 ? 1 : 0;
}
function fuzzyMatches(text: string, query: string): Match[] {
	const queryTokens = normalizeText(query).match(/[\p{L}\p{N}]+/gu) ?? [];
	if (queryTokens.length === 0) return [];
	const matches: Match[] = [];
	for (const paragraph of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
		const paragraphText = paragraph[0];
		if (paragraphText.trim().length === 0 || paragraph.index === undefined) continue;
		const tokens = [...paragraphText.matchAll(/[\p{L}\p{N}]+/gu)];
		const hit = (token: string) =>
			queryTokens.some((queryToken) => editDistanceWithin(queryToken, normalizeText(token), tolerance(queryToken)));
		const matched = queryTokens.filter((queryToken) =>
			tokens.some((token) => editDistanceWithin(queryToken, normalizeText(token[0]), tolerance(queryToken))),
		);
		if (matched.length < (queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length * 0.6))) continue;
		const first = tokens.find((token) => hit(token[0]));
		if (!first) continue;
		matches.push({
			start: paragraph.index + (first.index ?? 0),
			end: paragraph.index + (first.index ?? 0) + first[0].length,
		});
	}
	return matches;
}
function mergeRanges(ranges: Range[]): Range[] {
	const merged: Range[] = [];
	for (const range of [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

/** Passage search with pi's three modes; excerpts are bounded, counts stay exact. */
export function findPassages(text: string, queries: string[], mode: FindMode) {
	const unique = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
	const found = unique.map((query) => ({
		query,
		matches: mode === "fuzzy" ? fuzzyMatches(text, query) : literalMatches(text, query, mode === "case-insensitive"),
	}));
	const total = found.reduce((sum, item) => sum + item.matches.length, 0);
	const ranges = mergeRanges(
		found.flatMap((item) =>
			item.matches.map((match) => ({
				start: Math.max(0, match.start - CONTEXT_CHARS),
				end: Math.min(text.length, match.end + CONTEXT_CHARS),
			})),
		),
	);
	const heading = total > 0 ? `Text matches (${mode})` : `Text matches (${mode}): no matches`;
	const sections = [heading];
	let returned = 0;
	let length = heading.length;
	for (const [index, range] of ranges.entries()) {
		const counts = found
			.map((item) => ({
				query: item.query,
				count: item.matches.filter((match) => match.start >= range.start && match.start < range.end).length,
			}))
			.filter((item) => item.count > 0);
		if (!counts.length) continue;
		const snippet = `${range.start > 0 ? "…" : ""}${text
			.slice(range.start, range.end)
			.replace(/[\uD800-\uDFFF]/gu, "\uFFFD")
			.replace(/\s+/g, " ")
			.trim()}${range.end < text.length ? "…" : ""}`;
		const section = `${index + 1}. ${counts.map((item) => `"${item.query}" ×${item.count}`).join(", ")}\n${snippet}`;
		if (length + section.length + 2 > MAX_OUTPUT) break;
		sections.push(section);
		length += section.length + 2;
		returned += counts.reduce((sum, item) => sum + item.count, 0);
	}
	const missing = found.filter((item) => item.matches.length === 0).map((item) => `"${item.query}"`);
	if (missing.length) sections.push(`No matches: ${missing.join(", ")}`);
	if (returned < total) sections.push(`Showing ${returned} of ${total} matches.`);
	return {
		text: sections.join("\n\n"),
		matchCount: total,
		returnedMatches: returned,
		queryResults: found.map((item) => ({ query: item.query, matchCount: item.matches.length })),
	};
}

function hits(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(object) : [];
}

function select(data: Record<string, unknown>, raw: string, args: Record<string, unknown>) {
	const blocks = hits(data.queries);
	const wantsQuery = args.queryIndex !== undefined || args.query !== undefined;
	const wantsUrl = args.urlIndex !== undefined || args.url !== undefined;
	const queryIndex = wantsQuery
		? args.queryIndex === undefined
			? blocks.findIndex((block) => block.query === args.query)
			: Number(args.queryIndex)
		: undefined;
	if (queryIndex !== undefined && !blocks[queryIndex])
		throw new Error(`QUERY_NOT_FOUND: ${String(args.queryIndex ?? args.query)}`);
	const candidates =
		queryIndex === undefined
			? blocks.flatMap((block, index) => hits(block.results).map((hit) => ({ hit, index })))
			: hits(blocks[queryIndex]?.results).map((hit) => ({ hit, index: queryIndex }));
	if (!wantsUrl) {
		if (queryIndex === undefined) return { text: raw, label: {} };
		return { text: JSON.stringify(blocks[queryIndex], null, 2), label: { queryIndex } };
	}
	const urlIndex =
		args.urlIndex === undefined ? candidates.findIndex((item) => item.hit.url === args.url) : Number(args.urlIndex);
	const found = candidates[urlIndex];
	if (!found) throw new Error(`URL_NOT_FOUND: ${String(args.urlIndex ?? args.url)}`);
	const body = typeof found.hit.content === "string" ? found.hit.content : "";
	if (!body) throw new Error("URL_HAS_NO_STORED_CONTENT: re-run web-tools_search with includeContent");
	return { text: body, label: { queryIndex: found.index, urlIndex, url: found.hit.url } };
}

export async function readStored(args: Record<string, unknown>, ctx: ToolContext) {
	const input = object(args);
	const path = cachePath(String(input.responseId ?? ""), ctx.session);
	const file = await ctx.env.readTextFile(path, executionContext(ctx.signal));
	if (!file.ok) throw new Error(`UNKNOWN_RESPONSE_ID: ${path} could not be read (${file.error.message})`);
	let data: Record<string, unknown>;
	try {
		data = object(JSON.parse(file.value));
	} catch {
		throw new Error(`STORED_CONTENT_INVALID: ${path} is not web-tools search JSON`);
	}
	const selected = select(data, file.value, input);
	const findText =
		input.findText === undefined ? [] : Array.isArray(input.findText) ? input.findText : [input.findText];
	const queries = findText.filter((value): value is string => typeof value === "string");
	if (queries.length) {
		const mode = (input.findMode ?? "case-insensitive") as FindMode;
		const found = findPassages(selected.text, queries, mode);
		return output({ responseId: path, ...selected.label, findMode: mode, ...found }, ctx);
	}
	const offset = input.offset === undefined ? 0 : Number(input.offset);
	const limit = input.limit === undefined ? MAX_OUTPUT : Number(input.limit);
	if (offset > selected.text.length)
		throw new Error(`INVALID_OFFSET: ${offset} exceeds ${selected.text.length} characters`);
	const end = Math.min(selected.text.length, offset + limit);
	return output(
		{
			responseId: path,
			...selected.label,
			offset,
			limit,
			totalChars: selected.text.length,
			truncated: end < selected.text.length,
			text: selected.text.slice(offset, end),
		},
		ctx,
	);
}
