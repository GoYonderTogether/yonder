import { createPostgresRuntimeServices } from "@yonder/runtime-adapter/postgres";
import type { RuntimeInternals } from "@yonder/runtime-adapter/runtime/instance";
import * as modelConstruction from "@yonder/runtime-adapter/runtime/models";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import { executionContext, type ToolContext } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { testPostgres } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
beforeAll(async () => {
	database = await testPostgres();
}, 60000);
afterAll(async () => {
	await database?.close();
});

test("PG runtime exposes only the platform model and isolated readable output caches without an environment", async () => {
	const host = await createPostgresRuntimeServices({ pool: database.pool, apiKey: "transport-test-only" });
	try {
		const a = host.forBot("tenant-a", "bot-a");
		const b = host.forBot("tenant-b", "bot-b");
		expect(a.models.getProviders().map((provider) => provider.id)).toEqual(["deepseek"]);
		expect(a.models.getModels().map((model) => model.id)).toEqual(["deepseek-flash"]);
		// Cost/context facts come from the installed pi-ai catalog, not from a guessed number.
		expect(a.models.getModel("deepseek", "deepseek-flash")?.cost.input).toBeGreaterThan(0);
		expect(a.models.getModel("deepseek", "deepseek-flash")?.contextWindow).toBeGreaterThan(100000);
		const env = a.environment({ cwd: "/bots/bot-a", resolved: { env: "local" } });
		const signal = new AbortController().signal;
		const context = executionContext(signal);
		expect(env.id).toBe("none");
		expect(await env.readTextFile("/etc/passwd", context)).toMatchObject({
			ok: false,
			error: { code: "not_supported" },
		});
		expect(await env.exec("echo forbidden", {}, context)).toMatchObject({
			ok: false,
			error: { code: "shell_unavailable" },
		});
		const ctx: ToolContext = { agent: "bot-a", profile: "default", session: "2", capabilities: ["read"], env, signal };
		const path = await a.toolHost.toolOutputWriter(ctx, "test-output", {}, "/unused")("first\nneedle\nlast");
		expect(await a.toolHost.readCachedOutput!(path, 2, 1)).toMatchObject({
			output: [{ type: "text", text: "2-2 of 3 lines in cached output\nneedle" }],
		});
		expect(await a.toolHost.grepCachedOutput!({ path, pattern: "needle", literal: true })).toMatchObject({
			text: expect.stringContaining("needle"),
		});
		expect(await b.toolHost.readCachedOutput!(path)).toBeUndefined();
		expect(await b.toolHost.grepCachedOutput!({ path, pattern: "needle" })).toBeUndefined();
	} finally {
		await host.close();
	}
});

test("shared platform health and usage persist across reopening, while closing a Bot view leaves other views live", async () => {
	const host = await createPostgresRuntimeServices({ pool: database.pool, apiKey: "transport-test-only" });
	const a = host.forBot("tenant-a", "bot-a");
	const b = host.forBot("tenant-b", "bot-b");
	await a.health.hold(["deepseek/deepseek-flash"], "transport-test health", 60, 30);
	a.quota.recordWindow("deepseek@default", {
		usedPercent: 10,
		windowMinutes: 300,
		resetsAt: Date.now() + 60000,
		updatedAt: Date.now(),
	});
	a.watch.stop();
	expect(a.quotaPoller).toBeUndefined();
	await b.watch.tick(Date.now());
	expect(b.health.held("deepseek/deepseek-flash")).toBe(true);
	await host.close();
	const reopened = await createPostgresRuntimeServices({ pool: database.pool, apiKey: "transport-test-only" });
	try {
		const services = reopened.forBot("tenant-a", "bot-a");
		expect(services.health.held("deepseek/deepseek-flash")).toBe(true);
		expect(services.quota.window("deepseek@default")?.usedPercent).toBe(10);
	} finally {
		await reopened.close();
	}
});

test("PG model binding reuses each runtime config and keeps attached Bot timeouts isolated", async () => {
	const build = vi.spyOn(modelConstruction, "buildModels");
	const host = await createPostgresRuntimeServices({ pool: database.pool, apiKey: "transport-test-only" });
	try {
		const a = host.forBot("tenant-a", "bot-a");
		const b = host.forBot("tenant-b", "bot-b");
		const runtime = (firstTokenMs: number) =>
			({
				options: { config: { timeouts: { firstTokenMs, totalMs: 1000 } } },
				boundModels: new WeakMap(),
			}) as RuntimeInternals;
		const first = runtime(30),
			second = runtime(120);
		a.attachRuntime!(first);
		b.attachRuntime!(second);
		build.mockClear();
		const config = { resolved: { model: "deepseek/deepseek-flash", credentialSlots: {} } };
		const pending = a.modelsFor(config);
		expect(a.modelsFor(config)).toBe(pending);
		const modelsA = await pending;
		expect(await a.modelsFor(config)).toBe(modelsA);
		expect(first.boundModels.get(config as RuntimeSessionConfig)).toBe(pending);
		expect(await b.modelsFor(config)).not.toBe(modelsA);
		expect(await a.modelsFor(structuredClone(config))).not.toBe(modelsA);
		expect(build.mock.calls.map((call) => call[5])).toEqual([
			{ firstTokenMs: 30, totalMs: 1000 },
			{ firstTokenMs: 120, totalMs: 1000 },
			{ firstTokenMs: 30, totalMs: 1000 },
		]);
		expect(modelsA.getModel("deepseek", "deepseek-flash")?.id).toBe("deepseek-flash");
	} finally {
		build.mockRestore();
		await host.close();
	}
});
