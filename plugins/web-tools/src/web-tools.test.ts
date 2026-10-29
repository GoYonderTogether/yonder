import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";

const source = "./index.ts";
const { default: plugin } = await import(source);

// HTTP response/argument boundary checks only; no model, provider or external request.
function context(overrides: Partial<ToolContext> = {}) {
	return {
		signal: new AbortController().signal,
		session: "7",
		cacheToolOutput: undefined,
		cacheToolOutputStream: undefined,
		env: { readTextFile: async () => ({ ok: false, error: { message: "not_found" } }) },
		...overrides,
	} as unknown as ToolContext;
}
function tools(config?: unknown, credential?: string) {
	const { api, registrations } = createRegistrationCollector();
	plugin.setup({
		...api,
		id: "web-tools",
		config,
		credentials: { get: async () => (credential ? { type: "api_key", key: credential } : undefined) },
	} as unknown as PluginAPI);
	return {
		registrations,
		run: (name: string, args: unknown, ctx: ToolContext = context()) => {
			const tool = registrations.tools.find((tool) => tool.name === `web-tools_${name}`);
			if (!tool) throw new Error(`Missing tool ${name}`);
			return Promise.resolve().then(() => tool.execute(args, ctx));
		},
	};
}
afterEach(() => vi.unstubAllGlobals());

test("caches redacted output and oversized original bodies and reports cache failures", async () => {
	const cache = vi.fn(async (value: string | AsyncIterable<Uint8Array>, _options?: { extension?: string }) => {
		if (typeof value !== "string") {
			let bytes = 0;
			for await (const chunk of value) bytes += chunk.byteLength;
			expect(bytes).toBe(2 * 1024 * 1024 + 12);
		}
		return "/tmp/tool-output.json";
	});
	const http = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify({ results: [{ raw_content: `${"x".repeat(70000)} secret` }] })));
	vi.stubGlobal("fetch", http);
	const result = await tools(undefined, "secret").run(
		"extract",
		{ urls: ["https://example.org"] },
		context({ cacheToolOutput: cache, cacheToolOutputStream: cache } as Partial<ToolContext>),
	);
	expect(result.text).toContain("/tmp/tool-output.json; use read to paginate or grep to search");
	expect(cache.mock.calls[0]?.[0]).toContain("[REDACTED]");
	expect(cache.mock.calls[0]?.[0]).not.toContain("secret");
	expect(cache.mock.calls[0]?.[1]).toEqual({ extension: "json" });
	http.mockResolvedValueOnce(
		new Response(`${"x".repeat(2 * 1024 * 1024 + 1)} END_MARKER`, { headers: { "content-type": "text/plain" } }),
	);
	const oversized = await tools().run(
		"fetch",
		{ url: "https://example.org" },
		context({ cacheToolOutput: cache, cacheToolOutputStream: cache } as Partial<ToolContext>),
	);
	expect(oversized.text).toContain("cached at /tmp/tool-output.json");
	expect(typeof cache.mock.calls[1]?.[0]).toBe("object");
	expect(cache.mock.calls[1]?.[1]).toEqual({ extension: "txt" });
	cache.mockRejectedValueOnce(new Error("cache failed"));
	http.mockResolvedValueOnce(new Response("x".repeat(70000), { headers: { "content-type": "text/plain" } }));
	await expect(
		tools().run(
			"fetch",
			{ url: "https://example.org" },
			context({ cacheToolOutput: cache, cacheToolOutputStream: cache } as Partial<ToolContext>),
		),
	).rejects.toThrow("cache failed");
});

test("direct execute validates the declared schema before credentials or HTTP", async () => {
	const http = vi.fn();
	vi.stubGlobal("fetch", http);
	const { run } = tools();
	for (const args of [
		null,
		{ query: " " },
		{ query: "x", count: 1.5 },
		{ query: "x", numResults: 21 },
		{ query: "x", topic: "other" },
		{ query: "x", recencyFilter: "hour" },
		{ query: "x", include_domains: [" "] },
		{ query: "x", extra: true },
	])
		await expect(run("search", args)).rejects.toThrow("Invalid search arguments");
	await expect(run("search", {})).rejects.toThrow("query or queries required");
	await expect(run("extract", { urls: [] })).rejects.toThrow("Invalid extract arguments");
	await expect(run("fetch", { url: "https://example.org", format: "pdf" })).rejects.toThrow("Invalid fetch arguments");
	await expect(run("get_search_content", {})).rejects.toThrow("Invalid get_search_content arguments");
	await expect(run("get_search_content", { responseId: "x", findMode: "regex" })).rejects.toThrow(
		"Invalid get_search_content arguments",
	);
	await expect(run("extract", { urls: ["file:///tmp/private"] })).rejects.toThrow("Public HTTP");
	await expect(run("fetch", { url: "https://user:password@example.org" })).rejects.toThrow("without credentials");
	expect(http).not.toHaveBeenCalled();
});

test("search parameters follow pi-web-access names and keep the Tavily aliases", () => {
	const { registrations } = tools();
	const search = registrations.tools.find((tool) => tool.name === "web-tools_search");
	const properties = ((search?.parameters ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
	for (const name of ["queries", "numResults", "includeContent", "domainFilter", "recencyFilter"])
		expect(properties[name]).toBeDefined();
	for (const name of ["query", "count", "topic", "time_range", "include_domains", "exclude_domains", "depth"])
		expect(properties[name]).toBeDefined();
	const content = registrations.tools.find((tool) => tool.name === "web-tools_get_search_content");
	const contentProperties = ((content?.parameters ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
	for (const name of [
		"responseId",
		"query",
		"queryIndex",
		"url",
		"urlIndex",
		"offset",
		"limit",
		"findText",
		"findMode",
	])
		expect(contentProperties[name]).toBeDefined();
	expect(content?.guidelines).toEqual([
		"Use after web-tools_search to read stored results; findText finds passages without paging.",
	]);
});

test("Tavily missing credentials is distinct from response errors; supplier and defaults survive", async () => {
	const http = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [], response_time: 0.1 })));
	vi.stubGlobal("fetch", http);
	await expect(tools().run("search", { query: "边界" })).rejects.toThrow("TAVILY_CREDENTIAL_MISSING");
	const result = await tools(undefined, "protocol-secret").run("search", {
		query: "边界",
		time_range: "day",
		include_domains: ["example.org"],
	});
	expect(JSON.parse(result.text)).toMatchObject({
		suppliers: ["tavily"],
		queries: [{ query: "边界", supplier: "tavily", results: [] }],
	});
	expect(JSON.parse(http.mock.calls[0]?.[1].body)).toEqual({
		query: "边界",
		max_results: 5,
		topic: "general",
		search_depth: "basic",
		time_range: "day",
		include_domains: ["example.org"],
	});
	http.mockResolvedValueOnce(new Response('{"results":null}'));
	await expect(tools(undefined, "protocol-secret").run("search", { query: "x" })).rejects.toThrow(
		"TAVILY_INVALID_RESPONSE",
	);
	http.mockResolvedValueOnce(new Response('{"results":[],"failed_results":[{"url":"https://example.org"}]}'));
	expect((await tools(undefined, "protocol-secret").run("extract", { urls: ["https://example.org"] })).isError).toBe(
		true,
	);
	http.mockRejectedValueOnce(new Error("failure protocol-secret"));
	await expect(tools(undefined, "protocol-secret").run("search", { query: "x" })).rejects.toThrow("failure [REDACTED]");
});

test("query aliases, numbering and supplier fallback stay visible", async () => {
	const http = vi
		.fn()
		.mockResolvedValueOnce(new Response("denied", { status: 401 }))
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.example", content: "alpha" }] })),
		)
		.mockResolvedValueOnce(new Response("denied", { status: 401 }))
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ results: [{ title: "B", url: "https://b.example", content: "beta" }] })),
		);
	vi.stubGlobal("fetch", http);
	const { run } = tools(
		{
			providers: [
				{ name: "brave", credential: "brave" },
				{ name: "tavily", credential: "tavily" },
			],
		},
		"fallback-secret",
	);
	const payload = JSON.parse(
		(await run("search", { queries: ["one", "two"], numResults: 3, domainFilter: ["a.example", "-b.example"] })).text,
	);
	expect(payload.suppliers).toEqual(["brave", "tavily"]);
	expect(payload.queries.map((block: { supplier: string }) => block.supplier)).toEqual(["tavily", "tavily"]);
	expect(payload.queries[0].failed).toEqual([{ supplier: "brave", error: "BRAVE_HTTP_401" }]);
	expect(payload.queries[0].results[0]).toMatchObject({ n: 1, title: "A" });
	expect(payload.queries[1].results[0]).toMatchObject({ n: 2, title: "B" });
	const brave = String(http.mock.calls[0]?.[0]);
	expect(brave).toContain("api.search.brave.com");
	expect(brave).toContain("site%3Aa.example");
	expect(brave).toContain("-site%3Ab.example");
	expect(JSON.parse(http.mock.calls[1]?.[1].body)).toEqual({
		query: "one",
		max_results: 3,
		topic: "general",
		search_depth: "basic",
		include_domains: ["a.example"],
		exclude_domains: ["b.example"],
	});
	expect(JSON.stringify(payload)).not.toContain("fallback-secret");
	http.mockResolvedValue(new Response("denied", { status: 401 }));
	await expect(run("search", { query: "x" })).rejects.toThrow(
		"SEARCH_FAILED: x: brave: BRAVE_HTTP_401; tavily: TAVILY_HTTP_401",
	);
});

test("provider config rejects unknown and duplicate suppliers", () => {
	expect(() => tools({ providers: [{ name: "google" }] })).toThrow("providers.name must be one of");
	expect(() => tools({ providers: [] })).toThrow("providers must be a non-empty array");
	expect(() => tools({ providers: [{ name: "tavily" }, { name: "tavily" }] })).toThrow("duplicate supplier");
	expect(() => tools({ providers: [{ name: "tavily", credential: " " }] })).toThrow("must be a credential reference");
});

test("search stores results and get_search_content reads the same content back", async () => {
	const root = await mkdtemp(join(tmpdir(), "web-tools-"));
	const directory = join(root, "cache", "tool-output", "7");
	await mkdir(directory, { recursive: true });
	const path = join(directory, "1.json");
	const cache = async (value: string | AsyncIterable<Uint8Array>) => {
		if (typeof value !== "string") throw new Error("unexpected stream");
		await writeFile(path, value);
		return path;
	};
	const env = { readTextFile: async (target: string) => ({ ok: true, value: await readFile(target, "utf8") }) };
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [{ title: "One", url: "https://example.org/a", content: "Alpha passage about boundaries." }],
				}),
			),
		),
	);
	const ctx = context({ cacheToolOutput: cache, env: env as unknown as ToolContext["env"] });
	const { run } = tools(undefined, "secret");
	const payload = JSON.parse((await run("search", { query: "边界" }, ctx)).text);
	expect(payload.responseId).toBe(path);
	expect(payload.queries[0].results[0]).toMatchObject({ n: 1, title: "One", url: "https://example.org/a" });
	const found = JSON.parse(
		(await run("get_search_content", { responseId: payload.responseId, findText: "boundaries" }, ctx)).text,
	);
	expect(found.matchCount).toBe(1);
	expect(found.returnedMatches).toBe(1);
	expect(found.text).toContain("Alpha passage");
	const paged = JSON.parse((await run("get_search_content", { responseId: payload.responseId, limit: 10 }, ctx)).text);
	expect(paged.totalChars).toBeGreaterThan(10);
	expect(paged.truncated).toBe(true);
	expect(paged.text).toHaveLength(10);
	await expect(
		run("get_search_content", { responseId: join(root, "cache", "tool-output", "8", "1.json") }, ctx),
	).rejects.toThrow("belongs to another session");
	await expect(run("get_search_content", { responseId: "/etc/passwd" }, ctx)).rejects.toThrow(
		"is not a stored tool-output path",
	);
	await expect(run("get_search_content", { responseId: path, offset: 100000 }, ctx)).rejects.toThrow("INVALID_OFFSET");
	await rm(root, { recursive: true, force: true });
});

test("fetch preserves redirect URL, bounded content, binary and login/JS errors", async () => {
	const http = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/article" } }))
		.mockResolvedValueOnce(new Response("正文", { headers: { "content-type": "text/plain" } }));
	vi.stubGlobal("fetch", http);
	const { run } = tools();
	expect(JSON.parse((await run("fetch", { url: "https://example.org" })).text)).toMatchObject({
		url: "https://example.org/article",
		source: "http-get",
		content: "正文",
	});
	http.mockResolvedValueOnce(
		new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "content-type": "text/plain" } }),
	);
	expect((await run("fetch", { url: "https://example.org" })).text).toContain("cache unavailable");
	http.mockResolvedValueOnce(new Response("binary", { headers: { "content-type": "image/png" } }));
	expect(JSON.parse((await run("fetch", { url: "https://example.org" })).text).status).toBe("unsupported_binary");
	http.mockResolvedValueOnce(new Response("", { status: 403 }));
	await expect(run("fetch", { url: "https://example.org" })).rejects.toThrow("authorized login");
	http.mockResolvedValueOnce(
		new Response('<html><body><input type="password"></body></html>', { headers: { "content-type": "text/html" } }),
	);
	await expect(run("fetch", { url: "https://example.org" })).rejects.toThrow("LOGIN_REQUIRED");
	http.mockResolvedValueOnce(
		new Response("<html><body>JavaScript required</body></html>", { headers: { "content-type": "text/html" } }),
	);
	await expect(run("fetch", { url: "https://example.org" })).rejects.toThrow("JS_CONTENT_UNAVAILABLE");
	http.mockResolvedValue(new Response(null, { status: 302, headers: { location: "/again" } }));
	await expect(run("fetch", { url: "https://example.org" })).rejects.toThrow("Too many redirects");
});

test("pre-cancelled direct execution never reads credentials or makes a request", async () => {
	const http = vi.fn();
	vi.stubGlobal("fetch", http);
	await expect(
		tools().run("search", { query: "x" }, context({ signal: AbortSignal.abort(new Error("cancelled")) })),
	).rejects.toThrow("cancelled");
	expect(http).not.toHaveBeenCalled();
});
