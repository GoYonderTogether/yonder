import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { ModelHealth } from "./model-health.js";
import type { ModelWatchOptions } from "./model-watch.js";
import { ModelWatch, rateLimitReset } from "./model-watch.js";
import type { RuntimeRun, RuntimeSessionConfig } from "./types.js";

test("records only failed candidates and clears the candidate that answered", async () => {
	const home = await mkdtemp("/tmp/yonder-watch-");
	try {
		const health = new ModelHealth(join(home, "health.json"));
		const watch = new ModelWatch({ health } as ModelWatchOptions);
		const config = {
			resolved: resolveProfile({ model: "a/one", fallback: { models: ["b/two", "c/three"] } }),
		} as RuntimeSessionConfig;
		const run = { status: "done", model: "c/three" } as RuntimeRun;
		await health.hold(["c/three@default"], "old", 600, 60);
		await watch.record(config, run, [
			{ model: { provider: "b", modelId: "two" }, action: "fallback", error: "401 unauthorized" },
			{ model: { provider: "a", modelId: "one" }, action: "stop", error: "400 bad request" },
		]);
		expect(health.held("b/two@default")).toBe(true);
		expect(health.snapshot()["b/two@default"]!.until - Date.now()).toBeGreaterThan(86_000_000);
		expect(health.held("a/one@default")).toBe(false);
		expect(health.held("c/three@default")).toBe(false);
		await health.hold(["a/one@default"], "temporary", 600, 60);
		await watch.record(config, run, [
			{
				model: { provider: "a", modelId: "one" },
				action: "fallback",
				error: '429 rate_limit_headers: {"retry-after":"120"}',
			},
		]);
		expect(health.snapshot()["a/one@default"]?.resetUntil).toBeGreaterThan(Date.now() + 119000);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("transport failures hold no candidate while provider answers still do", async () => {
	const home = await mkdtemp("/tmp/yonder-watch-offline-");
	try {
		const health = new ModelHealth(join(home, "health.json"));
		const watch = new ModelWatch({ health } as ModelWatchOptions);
		const config = {
			resolved: resolveProfile({ model: "a/one", fallback: { models: ["b/two"] } }),
		} as RuntimeSessionConfig;
		const run = { status: "done", model: "b/two" } as RuntimeRun;
		// A dropped socket, a refused connect, DNS failure and a request that never got a token say nothing
		// about the candidate: after the host sleeps or loses the network the model must stay in the chain.
		const dropped = [
			"terminated",
			"Connection reset by peer (ECONNRESET)",
			"connect ECONNREFUSED 127.0.0.1:8788",
			"getaddrinfo ENOTFOUND api.example.com",
			"fetch failed",
			"Request timed out: no first token within 60000ms",
		];
		for (const error of dropped) {
			await watch.record(config, run, [{ model: { provider: "a", modelId: "one" }, action: "fallback", error }]);
			expect(health.held("a/one@default"), error).toBe(false);
		}
		await watch.record(config, run, [
			{ model: { provider: "a", modelId: "one" }, action: "fallback", error: "503 Service Unavailable" },
		]);
		expect(health.held("a/one@default")).toBe(true);
		// A probe that cannot reach the provider reschedules itself without extending the hold it earned.
		const until = health.snapshot()["a/one@default"]?.until;
		const offline = new ModelWatch({
			health,
			models: () => ({
				getModel: () => ({}),
				streamSimple: () => ({
					result: async () => {
						throw new Error("connect ECONNREFUSED 127.0.0.1:8788");
					},
				}),
			}),
		} as unknown as ModelWatchOptions);
		await (offline as unknown as { probeOne(key: string): Promise<void> }).probeOne("a/one@default");
		expect(health.snapshot()["a/one@default"]?.until).toBe(until);
		expect(health.held("a/one@default")).toBe(true);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("account aliases have separate holds and failed probes preserve the long hold", async () => {
	const home = await mkdtemp("/tmp/yonder-watch-slots-");
	try {
		const health = new ModelHealth(join(home, "health.json"));
		let healthy = false;
		const models = () => ({
			getModel: () => ({}),
			streamSimple: () => ({
				result: async () => ({ stopReason: healthy ? "stop" : "error", errorMessage: "401 unauthorized" }),
			}),
		});
		const watch = new ModelWatch({ health, models } as unknown as ModelWatchOptions);
		const config = {
			resolved: resolveProfile({ model: "a/one", fallback: { models: [], accounts: { a: ["other"] } } }),
		} as RuntimeSessionConfig;
		await watch.record(config, { status: "done", model: "a/one" } as RuntimeRun, [
			{ model: { provider: "a#other", modelId: "one" }, action: "fallback", error: "401 unauthorized" },
		]);
		expect(health.held("a/one@other")).toBe(true);
		expect(health.held("a/one@default")).toBe(false);
		const before = health.snapshot()["a/one@other"]?.until;
		await (watch as unknown as { probeOne(key: string): Promise<void> }).probeOne("a/one@other");
		expect(health.snapshot()["a/one@other"]?.until).toBe(before);
		healthy = true;
		await (watch as unknown as { probeOne(key: string): Promise<void> }).probeOne("a/one@other");
		expect(health.held("a/one@other")).toBe(false);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("honors reset response metadata and delays probing until reset", async () => {
	const home = await mkdtemp("/tmp/yonder-reset-");
	try {
		const now = Date.now();
		expect(rateLimitReset('429 rate_limit_headers: {"retry-after":"120"}', now)).toBe(now + 120000);
		expect(rateLimitReset('429 {"reset_at":1800000000}', now)).toBe(1800000000000);
		expect(rateLimitReset('429 {"retry_after":30}', now)).toBe(now + 30000);
		expect(rateLimitReset('429 {"retry_after_ms":300}', now)).toBe(now + 300);
		let clock = now;
		const health = new ModelHealth(join(home, "health.json"), () => clock);
		await health.hold(["a"], "429", 120, 15, 1, now + 120000);
		clock += 60000;
		expect(health.due()).toEqual([]);
		expect(health.held("a")).toBe(true);
		clock += 60000;
		expect(health.held("a")).toBe(false);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
