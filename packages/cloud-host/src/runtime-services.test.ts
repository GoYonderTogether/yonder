import { createPostgresRuntimeServices } from "@yonder/runtime-adapter/postgres";
import { executionContext, type ToolContext } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
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
		expect(a.models.getProviders().map((provider) => provider.id)).toEqual(["rightapi-glm"]);
		expect(a.models.getModels().map((model) => model.id)).toEqual(["glm-5.3-flash"]);
		expect(a.models.getModel("rightapi-glm", "glm-5.3-flash")?.cost.input).toBe(0.15);
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
	await a.health.hold(["rightapi-glm/glm-5.3-flash"], "transport-test health", 60, 30);
	a.quota.recordWindow("rightapi-glm@default", {
		usedPercent: 10,
		windowMinutes: 300,
		resetsAt: Date.now() + 60000,
		updatedAt: Date.now(),
	});
	a.watch.stop();
	a.quotaPoller.stop();
	await b.watch.tick(Date.now());
	expect(b.health.held("rightapi-glm/glm-5.3-flash")).toBe(true);
	await host.close();
	const reopened = await createPostgresRuntimeServices({ pool: database.pool, apiKey: "transport-test-only" });
	try {
		const services = reopened.forBot("tenant-a", "bot-a");
		expect(services.health.held("rightapi-glm/glm-5.3-flash")).toBe(true);
		expect(services.quota.window("rightapi-glm@default")?.usedPercent).toBe(10);
	} finally {
		await reopened.close();
	}
});
