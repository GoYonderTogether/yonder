import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { ModelHealth } from "./model-health.js";
import type { ModelWatchOptions } from "./model-watch.js";
import { ModelWatch } from "./model-watch.js";
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
