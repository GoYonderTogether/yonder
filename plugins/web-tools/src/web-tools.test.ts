import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";

const source = "./index.ts";
const { default: plugin } = await import(source);

// HTTP response/argument boundary checks only; no model, provider or external request.
function tools(credential?: string, cacheToolOutput?: ToolContext["cacheToolOutput"]) {
	const { api, registrations } = createRegistrationCollector();
	plugin.setup({
		...api,
		id: "web-tools",
		credentials: { get: async () => (credential ? { type: "api_key", key: credential } : undefined) },
	} as unknown as PluginAPI);
	return (name: string, args: unknown, signal = new AbortController().signal) => {
		const tool = registrations.tools.find((tool) => tool.name === `web-tools_${name}`);
		if (!tool) throw new Error(`Missing tool ${name}`);
		return Promise.resolve().then(() => tool.execute(args, { signal, cacheToolOutput } as ToolContext));
	};
}
afterEach(() => vi.unstubAllGlobals());

test("caches redacted output and rejects oversized bodies and cache failures", async () => {
	const cache = vi.fn().mockResolvedValue("/tmp/tool-output.json");
	const http = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify({ results: [{ raw_content: `${"x".repeat(70000)} secret` }] })));
	vi.stubGlobal("fetch", http);
	const result = await tools("secret", cache)("extract", { urls: ["https://example.org"] });
	expect(result.text).toContain("/tmp/tool-output.json; use read to paginate or grep to search");
	expect(cache.mock.calls[0]?.[0]).toContain("[REDACTED]");
	expect(cache.mock.calls[0]?.[0]).not.toContain("secret");
	expect(cache.mock.calls[0]?.[1]).toEqual({ extension: "json" });
	http.mockResolvedValueOnce(
		new Response(`${"x".repeat(2 * 1024 * 1024 + 1)} END_MARKER`, { headers: { "content-type": "text/plain" } }),
	);
	await expect(tools(undefined, cache)("fetch", { url: "https://example.org" })).rejects.toThrow("HTTP_BODY_TOO_LARGE");
	expect(cache).toHaveBeenCalledTimes(1);
	cache.mockRejectedValueOnce(new Error("cache failed"));
	http.mockResolvedValueOnce(new Response("x".repeat(70000), { headers: { "content-type": "text/plain" } }));
	await expect(tools(undefined, cache)("fetch", { url: "https://example.org" })).rejects.toThrow("cache failed");
});

test("direct execute validates the declared schema before credentials or HTTP", async () => {
	const http = vi.fn();
	vi.stubGlobal("fetch", http);
	const run = tools();
	for (const args of [
		null,
		{ query: " " },
		{ query: "x", count: 1.5 },
		{ query: "x", topic: "other" },
		{ query: "x", include_domains: [" "] },
		{ query: "x", extra: true },
	])
		await expect(run("search", args)).rejects.toThrow("Invalid search arguments");
	await expect(run("extract", { urls: [] })).rejects.toThrow("Invalid extract arguments");
	await expect(run("fetch", { url: "https://example.org", format: "pdf" })).rejects.toThrow("Invalid fetch arguments");
	await expect(run("extract", { urls: ["file:///tmp/private"] })).rejects.toThrow("Public HTTP");
	await expect(run("fetch", { url: "https://user:password@example.org" })).rejects.toThrow("without credentials");
	expect(http).not.toHaveBeenCalled();
});

test("Tavily missing credentials is distinct from response errors; supplier and defaults survive", async () => {
	const http = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [], response_time: 0.1 })));
	vi.stubGlobal("fetch", http);
	await expect(tools()("search", { query: "边界" })).rejects.toThrow("TAVILY_CREDENTIAL_MISSING");
	const result = await tools("protocol-secret")("search", {
		query: "边界",
		time_range: "day",
		include_domains: ["example.org"],
	});
	expect(JSON.parse(result.text)).toMatchObject({ supplier: "tavily", results: [], response_time: 0.1 });
	expect(JSON.parse(http.mock.calls[0]?.[1].body)).toEqual({
		query: "边界",
		max_results: 5,
		topic: "general",
		search_depth: "basic",
		time_range: "day",
		include_domains: ["example.org"],
	});
	http.mockResolvedValueOnce(new Response('{"results":null}'));
	await expect(tools("protocol-secret")("search", { query: "x" })).rejects.toThrow("TAVILY_INVALID_RESPONSE");
	http.mockResolvedValueOnce(new Response('{"results":[],"failed_results":[{"url":"https://example.org"}]}'));
	expect((await tools("protocol-secret")("extract", { urls: ["https://example.org"] })).isError).toBe(true);
	http.mockRejectedValueOnce(new Error("failure protocol-secret"));
	await expect(tools("protocol-secret")("search", { query: "x" })).rejects.toThrow("failure [REDACTED]");
});

test("fetch preserves redirect URL, bounded content, binary and login/JS errors", async () => {
	const http = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/article" } }))
		.mockResolvedValueOnce(new Response("正文", { headers: { "content-type": "text/plain" } }));
	vi.stubGlobal("fetch", http);
	const run = tools();
	expect(JSON.parse((await run("fetch", { url: "https://example.org" })).text)).toMatchObject({
		url: "https://example.org/article",
		source: "http-get",
		content: "正文",
	});
	http.mockResolvedValueOnce(
		new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "content-type": "text/plain" } }),
	);
	await expect(run("fetch", { url: "https://example.org" })).rejects.toThrow("HTTP_BODY_TOO_LARGE");
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
	await expect(tools()("search", { query: "x" }, AbortSignal.abort(new Error("cancelled")))).rejects.toThrow(
		"cancelled",
	);
	expect(http).not.toHaveBeenCalled();
});
