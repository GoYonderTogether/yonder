import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { object, output, readBody, redact } from "./shared.js";

export const SUPPLIERS = ["tavily", "brave", "serper"] as const;
export type SupplierName = (typeof SUPPLIERS)[number];
export interface SupplierConfig {
	name: SupplierName;
	credential: string;
}
export interface SearchInput {
	query: string;
	numResults: number;
	topic: "general" | "news";
	depth: "basic" | "advanced";
	recency?: "day" | "week" | "month" | "year" | undefined;
	include: string[];
	exclude: string[];
}
/** Only fields a supplier actually returned; nothing here is inferred. */
export interface Hit {
	title?: string | undefined;
	url?: string | undefined;
	content?: string | undefined;
	published?: string | undefined;
	score?: number | undefined;
}

const TIMEOUT_MS = 30000;

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

const ALLOWED_HOSTS = new Set(["api.tavily.com", "api.search.brave.com", "google.serper.dev"]);

/** Every outbound call goes through this allowlist; no supplier name can reach another host. */
function endpoint(input: string): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error("UNSUPPORTED_ENDPOINT");
	}
	if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname))
		throw new Error(`UNSUPPORTED_ENDPOINT: ${url.hostname}`);
	return url;
}

async function request(
	input: string,
	init: RequestInit,
	code: string,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	const url = endpoint(input);
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
	} catch (error) {
		if (signal.aborted) throw new Error(`${code}_CANCELLED`);
		throw new Error(`${code}_REQUEST_FAILED: ${message(error)}`);
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`${code}_HTTP_${response.status}`);
	}
	const body = await readBody(response);
	if (body.truncated) throw new Error(`${code}_RESPONSE_TOO_LARGE`);
	try {
		return object(JSON.parse(body.text));
	} catch {
		throw new Error(`${code}_INVALID_JSON`);
	}
}

/** Supplier-native scoping syntax: both Brave and Serper accept site: / -site: inside the query. */
function scoped(input: SearchInput) {
	const parts = [input.query];
	if (input.include.length) parts.push(`(${input.include.map((domain) => `site:${domain}`).join(" OR ")})`);
	for (const domain of input.exclude) parts.push(`-site:${domain}`);
	return parts.join(" ");
}

async function tavily(key: string, input: SearchInput, signal: AbortSignal): Promise<Hit[]> {
	const body: Record<string, unknown> = {
		query: input.query,
		max_results: input.numResults,
		topic: input.topic,
		search_depth: input.depth,
	};
	if (input.recency) body.time_range = input.recency;
	if (input.include.length) body.include_domains = input.include;
	if (input.exclude.length) body.exclude_domains = input.exclude;
	const data = await request(
		"https://api.tavily.com/search",
		{
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		"TAVILY",
		signal,
	);
	if (!Array.isArray(data.results)) throw new Error("TAVILY_INVALID_RESPONSE");
	return list(data.results).map((item) => {
		const hit = record(item);
		return {
			...(text(hit.title) === undefined ? {} : { title: text(hit.title) }),
			...(text(hit.url) === undefined ? {} : { url: text(hit.url) }),
			...(text(hit.content) === undefined ? {} : { content: text(hit.content) }),
			...(text(hit.published_date) === undefined ? {} : { published: text(hit.published_date) }),
			...(number(hit.score) === undefined ? {} : { score: number(hit.score) }),
		};
	});
}

const FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" } as const;

async function brave(key: string, input: SearchInput, signal: AbortSignal): Promise<Hit[]> {
	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", scoped(input));
	url.searchParams.set("count", String(input.numResults));
	if (input.recency) url.searchParams.set("freshness", FRESHNESS[input.recency]);
	const data = await request(
		url.href,
		{ method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": key } },
		"BRAVE",
		signal,
	);
	return list(record(data.web).results).map((item) => {
		const hit = record(item);
		return {
			...(text(hit.title) === undefined ? {} : { title: text(hit.title) }),
			...(text(hit.url) === undefined ? {} : { url: text(hit.url) }),
			...(text(hit.description) === undefined ? {} : { content: text(hit.description) }),
			...(text(hit.page_age) === undefined ? {} : { published: text(hit.page_age) }),
		};
	});
}

const SERPER_RANGE = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" } as const;

async function serper(key: string, input: SearchInput, signal: AbortSignal): Promise<Hit[]> {
	const body: Record<string, unknown> = { q: scoped(input), num: input.numResults };
	if (input.recency) body.tbs = SERPER_RANGE[input.recency];
	const data = await request(
		"https://google.serper.dev/search",
		{ method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify(body) },
		"SERPER",
		signal,
	);
	if (!Array.isArray(data.organic)) throw new Error("SERPER_INVALID_RESPONSE");
	return list(data.organic).map((item) => {
		const hit = record(item);
		return {
			...(text(hit.title) === undefined ? {} : { title: text(hit.title) }),
			...(text(hit.link) === undefined ? {} : { url: text(hit.link) }),
			...(text(hit.snippet) === undefined ? {} : { content: text(hit.snippet) }),
			...(text(hit.date) === undefined ? {} : { published: text(hit.date) }),
		};
	});
}

/** One supplier attempt; the caller decides whether to fall through to the next one. */
export async function supplierSearch(
	api: PluginAPI,
	supplier: SupplierConfig,
	input: SearchInput,
	signal: AbortSignal,
): Promise<Hit[]> {
	const code = supplier.name.toUpperCase();
	const auth = await api.credentials.get(supplier.credential);
	if (auth?.type !== "api_key" || !auth.key) throw new Error(`${code}_CREDENTIAL_MISSING: ${supplier.credential}`);
	const key = auth.key;
	try {
		if (supplier.name === "tavily") return await tavily(key, input, signal);
		if (supplier.name === "brave") return await brave(key, input, signal);
		return await serper(key, input, signal);
	} catch (error) {
		throw new Error(redact(message(error), key));
	}
}

export async function tavilyExtract(
	api: PluginAPI,
	credential: string,
	body: Record<string, unknown>,
	ctx: ToolContext,
): Promise<{ text: string; isError?: boolean }> {
	const signal = ctx.signal;
	const auth = await api.credentials.get(credential);
	if (auth?.type !== "api_key" || !auth.key) throw new Error(`TAVILY_CREDENTIAL_MISSING: ${credential}`);
	const key = auth.key;
	try {
		const data = await request(
			"https://api.tavily.com/extract",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"TAVILY",
			signal,
		);
		if (!Array.isArray(data.results)) throw new Error("TAVILY_INVALID_RESPONSE");
		const empty = !data.results.some(
			(item) => typeof record(item).raw_content === "string" && String(record(item).raw_content).trim(),
		);
		return { ...(await output({ supplier: "tavily", ...data }, ctx, key)), ...(empty ? { isError: true } : {}) };
	} catch (error) {
		throw new Error(redact(message(error), key));
	}
}
