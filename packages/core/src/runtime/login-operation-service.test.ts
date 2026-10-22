import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "./db.js";
import { createLoginOperationService } from "./login-operation-service.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function fixture(
	delivery: (entry: { operationId: string }, key: string) => Promise<"delivered" | "unknown"> = async () => "delivered",
) {
	const dir = await mkdtemp(join(tmpdir(), "login-service-"));
	dirs.push(dir);
	const db = await openDatabase(join(dir, "db.sqlite"));
	const ctx = {
		session: "s",
		agent: "a",
		event: { id: "e" },
		capabilities: [],
		signal: new AbortController().signal,
	} as unknown as ToolContext;
	const runner = {
		start: vi.fn(async (input: { capability: string; finish: (o: "succeeded", c: number) => Promise<boolean> }) => {
			await input.finish("succeeded", 0);
		}),
	};
	const service = createLoginOperationService({
		db,
		runner,
		deliver: delivery as never,
		now: () => 100,
		ttlMs: 50,
		deliveryTimeoutMs: 5,
	});
	await service.initialize();
	return { db, ctx, runner, service, dir };
}
it("register-bound handler invokes runner with internal capability but exposes only safe result", async () => {
	const f = await fixture();
	const output = await f.service.tool.execute({ provider: "example" }, f.ctx);
	expect(f.runner.start).toHaveBeenCalledTimes(1);
	const call = f.runner.start.mock.calls[0]?.[0];
	expect(call).toBeDefined();
	if (!call) throw new Error("runner not called");
	expect(call.capability).toBeTruthy();
	expect(JSON.stringify(output)).not.toContain(call.capability);
	expect(JSON.stringify(await f.service.operations.readUnacknowledged())).not.toContain(call.capability);
	expect(JSON.parse(output.text)).toMatchObject({ status: "pending" });
	await expect(f.service.handler({ provider: "x", session: "forged" } as never, f.ctx)).rejects.toThrow();
	await f.db.close();
});
it("recovers unacknowledged entries after restart and acknowledges confirmed delivery", async () => {
	const f = await fixture();
	await f.service.tool.execute({ provider: "p" }, f.ctx);
	await f.db.close();
	const db = await openDatabase(join(f.dir, "db.sqlite"));
	const deliver = vi.fn(async (_entry: { operationId: string }, _key: string) => "delivered" as const);
	const recovered = createLoginOperationService({ db, runner: { start: vi.fn() }, deliver });
	await recovered.initialize();
	expect(await recovered.drainOutbox()).toBe(1);
	const deliveredCall = deliver.mock.calls[0];
	expect(deliveredCall?.[1]).toBe(deliveredCall?.[0].operationId);
	await db.close();
});
it("unknown delivery remains durably claimed across service restart", async () => {
	const deliver = vi.fn(async () => "unknown" as const);
	const f = await fixture(deliver);
	await f.service.tool.execute({ provider: "p" }, f.ctx);
	expect(await f.service.drainOutbox()).toBe(0);
	await f.db.close();
	const db = await openDatabase(join(f.dir, "db.sqlite"));
	const redeliver = vi.fn(async () => "delivered" as const);
	const restarted = createLoginOperationService({ db, runner: { start: vi.fn() }, deliver: redeliver });
	await restarted.initialize();
	expect(await restarted.drainOutbox()).toBe(0);
	expect(deliver).toHaveBeenCalledTimes(1);
	expect(redeliver).not.toHaveBeenCalled();
	await db.close();
});
it("durable claim prevents two workers from delivering the same entry", async () => {
	const f = await fixture();
	await f.service.tool.execute({ provider: "p" }, f.ctx);
	const db2 = await openDatabase(join(f.dir, "db.sqlite"));
	let release!: (state: "delivered") => void;
	const deliver1 = vi.fn(
		() =>
			new Promise<"delivered">((resolve) => {
				release = resolve;
			}),
	);
	const deliver2 = vi.fn(async () => "delivered" as const);
	const worker1 = createLoginOperationService({ db: f.db, runner: { start: vi.fn() }, deliver: deliver1 });
	const worker2 = createLoginOperationService({ db: db2, runner: { start: vi.fn() }, deliver: deliver2 });
	await Promise.all([worker1.initialize(), worker2.initialize()]);
	const draining = worker1.drainOutbox();
	await vi.waitFor(() => expect(deliver1).toHaveBeenCalledTimes(1));
	expect(await worker2.drainOutbox()).toBe(0);
	expect(deliver2).not.toHaveBeenCalled();
	release("delivered");
	expect(await draining).toBe(1);
	await db2.close();
});
it("delivery timeout remains unacknowledged", async () => {
	const f = await fixture(async () => new Promise(() => {}));
	await f.service.tool.execute({ provider: "p" }, f.ctx);
	expect(await f.service.drainOutbox()).toBe(0);
	expect(await f.service.operations.readUnacknowledged()).toHaveLength(0);
	await f.db.close();
});
it("runner errors are replaced with a static safe error", async () => {
	const f = await fixture();
	const secret = "provider-token-DO-NOT-LEAK";
	f.runner.start.mockRejectedValueOnce(new Error(secret));
	await expect(f.service.tool.execute({ provider: "p" }, f.ctx)).rejects.toThrow(
		"Login operation could not be started",
	);
	try {
		await f.service.tool.execute({ provider: "p" }, f.ctx);
	} catch (error) {
		expect(String(error)).not.toContain(secret);
	}
	await f.db.close();
});
