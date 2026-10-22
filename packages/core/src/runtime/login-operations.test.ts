import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { LoginOperations } from "./login-operations.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "login-op-"));
	dirs.push(dir);
	const db = await openDatabase(join(dir, "state.db"));
	const api = new LoginOperations(db, () => 1000, 100);
	await api.initialize();
	const ctx = {
		session: "trusted-session",
		agent: "trusted-agent",
		event: { id: "trusted-event" },
		profile: "default",
		capabilities: [],
		env: {} as never,
		signal: new AbortController().signal,
	} as unknown as ToolContext;
	return { db, api, ctx };
}
it("binds begin to trusted ToolContext and survives reopening with capability only stored hashed", async () => {
	const { db, api, ctx } = await fixture();
	const op = await api.begin(ctx);
	const row = await db.get<{ session: string; agent: string; event: string; capability_hash: string }>(
		"SELECT * FROM login_operations WHERE id=?",
		op.id,
	);
	expect(row).toMatchObject({ session: "trusted-session", agent: "trusted-agent", event: "trusted-event" });
	expect(row?.capability_hash).not.toBe(op.capability);
	await db.close();
	const dir = dirs[0];
	expect(dir).toBeDefined();
	const reopened = await openDatabase(join(dir as string, "state.db"));
	const recovered = new LoginOperations(reopened, () => 1000, 100);
	await recovered.initialize();
	expect(await recovered.finish(op.capability, "succeeded", 0)).toBe(true);
	expect(await recovered.finish(op.capability, "failed", 2)).toBe(false);
	await reopened.close();
});
it("rejects malformed inputs, wrong capability, expired and repeated completion", async () => {
	const { api, ctx, db } = await fixture();
	const op = await api.begin(ctx);
	await expect(api.finish(op.capability, "succeeded", 256)).rejects.toThrow();
	await expect(api.finish(op.capability, "succeeded\nsecret" as never, 0)).rejects.toThrow();
	expect(await api.finish("x".repeat(44), "failed", 1)).toBe(false);
	expect(await api.finish(op.capability, "cancelled", 0)).toBe(true);
	expect(await api.finish(op.capability, "failed", 1)).toBe(false);
	await db.close();
});
it("expires operations deterministically", async () => {
	let now = 10;
	const dir = await mkdtemp(join(tmpdir(), "login-op-"));
	dirs.push(dir);
	const db = await openDatabase(join(dir, "state.db"));
	const api = new LoginOperations(db, () => now, 5);
	await api.initialize();
	const ctx = {
		session: "s",
		agent: "a",
		profile: "p",
		capabilities: [],
		env: {} as never,
		signal: new AbortController().signal,
	} as unknown as ToolContext;
	const op = await api.begin(ctx);
	now = 15;
	expect(await api.finish(op.capability, "interrupted", 1)).toBe(false);
	expect(await api.expirePending()).toBe(1);
	expect(await api.expirePending()).toBe(0);
	expect(await api.readUnacknowledged()).toMatchObject([{ outcome: "expired", session: "s", event: null }]);
	await db.close();
});

it("writes result and outbox atomically, persists across reopen, and acknowledges idempotently", async () => {
	const { db, api, ctx } = await fixture();
	const op = await api.begin(ctx);
	expect(await api.finish(op.capability, "succeeded", 0)).toBe(true);
	expect(await api.finish(op.capability, "failed", 1)).toBe(false);
	const items = await api.readUnacknowledged();
	expect(items).toHaveLength(1);
	expect(items[0]).toMatchObject({
		id: op.id,
		operationId: op.id,
		session: "trusted-session",
		event: "trusted-event",
		outcome: "succeeded",
		code: 0,
	});
	expect(JSON.stringify(items)).not.toContain(op.capability);
	await db.close();
	const reopened = await openDatabase(join(dirs[0] as string, "state.db"));
	const recovered = new LoginOperations(reopened, () => 1000, 100);
	await recovered.initialize();
	expect(await recovered.readUnacknowledged()).toHaveLength(1);
	expect(await recovered.acknowledge(op.id)).toBe(true);
	expect(await recovered.acknowledge(op.id)).toBe(false);
	expect(await recovered.readUnacknowledged()).toHaveLength(0);
	await reopened.close();
});

it("rolls back completion if outbox insertion fails", async () => {
	const { db, api, ctx } = await fixture();
	const op = await api.begin(ctx);
	await db.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON login_outbox BEGIN SELECT RAISE(ABORT, 'forced'); END");
	await expect(api.finish(op.capability, "succeeded", 0)).rejects.toThrow("forced");
	expect(await db.get<{ state: string }>("SELECT state FROM login_operations WHERE id=?", op.id)).toMatchObject({
		state: "pending",
	});
	expect(await db.all("SELECT id FROM login_outbox")).toHaveLength(0);
	await db.close();
});

it("CAS allows exactly one concurrent terminal writer", async () => {
	const { api, ctx, db } = await fixture();
	const op = await api.begin(ctx);
	const secondDb = await openDatabase(join(dirs[0] as string, "state.db"));
	const secondApi = new LoginOperations(secondDb, () => 1000, 100);
	await secondApi.initialize();
	const results = await Promise.all([
		api.finish(op.capability, "succeeded", 0),
		secondApi.finish(op.capability, "failed", 1),
	]);
	expect(results.filter(Boolean)).toHaveLength(1);
	expect(await api.readUnacknowledged()).toHaveLength(1);
	await secondDb.close();
	await db.close();
});
