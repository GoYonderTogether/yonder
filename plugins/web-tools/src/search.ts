import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { fetchPage } from "./article.js";
import { type Hit, type SearchInput, type SupplierConfig, supplierSearch } from "./providers.js";
import { choice, object, output, schema, string } from "./shared.js";

const RECENCY = ["day", "week", "month", "year"] as const;
type Recency = (typeof RECENCY)[number];

export const searchParameters = schema(
	{
		query: { ...string, maxLength: 400 },
		queries: { type: "array", items: { ...string, maxLength: 400 }, maxItems: 10 },
		numResults: { type: "integer", minimum: 1, maximum: 20, description: "Default 5" },
		includeContent: { type: "boolean", description: "Also fetch full page content" },
		recencyFilter: choice(...RECENCY),
		domainFilter: {
			type: "array",
			items: { type: "string", minLength: 1 },
			maxItems: 300,
			description: "Prefix - to exclude",
		},
		count: { type: "integer", minimum: 1, maximum: 20 },
		topic: choice("general", "news"),
		time_range: choice(...RECENCY),
		include_domains: { type: "array", items: string, maxItems: 300 },
		exclude_domains: { type: "array", items: string, maxItems: 150 },
		depth: choice("basic", "advanced"),
	},
	[],
);

export interface SearchDeps {
	api: PluginAPI;
	suppliers: SupplierConfig[];
}

interface QueryBlock {
	query: string;
	supplier: string;
	results: Hit[];
	failed?: Array<{ supplier: string; error: string }>;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(args: Record<string, unknown>) {
	const queries: string[] = [];
	for (const value of [args.query, ...strings(args.queries)]) {
		if (typeof value !== "string") continue;
		const query = value.trim();
		if (query && !queries.includes(query)) queries.push(query);
	}
	if (!queries.length) throw new Error("query or queries required");
	const include: string[] = [];
	const exclude: string[] = [];
	for (const domain of [...strings(args.include_domains), ...strings(args.domainFilter)]) {
		const name = domain.trim();
		if (!name) continue;
		if (name.startsWith("-")) exclude.push(name.slice(1));
		else include.push(name);
	}
	for (const domain of strings(args.exclude_domains)) {
		const name = domain.trim();
		if (name) exclude.push(name);
	}
	const numResults = Number(args.numResults ?? args.count ?? 5);
	const recency = (args.recencyFilter ?? args.time_range) as Recency | undefined;
	return {
		queries,
		numResults,
		recency,
		include,
		exclude,
		topic: (args.topic ?? "general") as "general" | "news",
		depth: (args.depth ?? "basic") as "basic" | "advanced",
		includeContent: args.includeContent === true,
	};
}

/** Suppliers are tried in configured order; the first answer wins and the failures stay visible. */
async function ask(deps: SearchDeps, input: SearchInput, ctx: ToolContext): Promise<QueryBlock> {
	const failed: Array<{ supplier: string; error: string }> = [];
	for (const supplier of deps.suppliers) {
		ctx.signal.throwIfAborted();
		try {
			const results = await supplierSearch(deps.api, supplier, input, ctx.signal);
			return { query: input.query, supplier: supplier.name, results, ...(failed.length ? { failed } : {}) };
		} catch (error) {
			if (ctx.signal.aborted) throw error;
			failed.push({ supplier: supplier.name, error: error instanceof Error ? error.message : String(error) });
		}
	}
	throw new Error(
		`SEARCH_FAILED: ${input.query}: ${failed.map((item) => `${item.supplier}: ${item.error}`).join("; ")}`,
	);
}

export async function runSearch(deps: SearchDeps, args: Record<string, unknown>, ctx: ToolContext) {
	const request = normalize(object(args));
	const blocks: QueryBlock[] = [];
	for (const query of request.queries) {
		blocks.push(
			await ask(
				deps,
				{
					query,
					numResults: request.numResults,
					topic: request.topic,
					depth: request.depth,
					recency: request.recency,
					include: request.include,
					exclude: request.exclude,
				},
				ctx,
			),
		);
	}
	let n = 0;
	for (const block of blocks) {
		block.results = block.results.map((hit) => ({ n: ++n, ...hit }));
	}
	if (request.includeContent) {
		for (const block of blocks) {
			for (const hit of block.results) {
				if (!hit.url) continue;
				try {
					const page = await fetchPage(hit.url, "text", ctx);
					if (page.kind === "page") hit.content = page.content;
				} catch (error) {
					hit.content = `CONTENT_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
				}
			}
		}
	}
	const stored = await ctx.cacheToolOutput?.(JSON.stringify({ queries: blocks }, null, 2), { extension: "json" });
	return output(
		{
			...(stored
				? { responseId: stored }
				: { responseId: null, storage: "cache unavailable; results are only in this reply" }),
			suppliers: deps.suppliers.map((supplier) => supplier.name),
			queries: blocks,
		},
		ctx,
	);
}
