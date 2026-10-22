import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ToolContext } from "@yonder/sdk";
import { openDatabase } from "./db.js";
import { LoginOperations } from "./login-operations.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture() {
 const dir = await mkdtemp(join(tmpdir(), "login-op-")); dirs.push(dir);
 const db = await openDatabase(join(dir, "state.db"));
 const api = new LoginOperations(db, () => 1000, 100);
 await api.initialize();
 const ctx = { session: "trusted-session", agent: "trusted-agent", event: { id: "trusted-event" }, profile: "default", capabilities: [], env: {} as never, signal: new AbortController().signal } as unknown as ToolContext;
 return { db, api, ctx };
}
it("binds begin to trusted ToolContext and survives reopening with capability only stored hashed", async () => {
 const { db, api, ctx } = await fixture(); const op = await api.begin(ctx);
 const row = await db.get<{session:string;agent:string;event:string;capability_hash:string}>("SELECT * FROM login_operations WHERE id=?", op.id);
 expect(row).toMatchObject({ session: "trusted-session", agent: "trusted-agent", event: "trusted-event" });
 expect(row!.capability_hash).not.toBe(op.capability);
 await db.close();
 const reopened = await openDatabase(join(dirs[0]!, "state.db"));
 const recovered = new LoginOperations(reopened, () => 1000, 100); await recovered.initialize();
 expect(await recovered.finish(op.capability, "succeeded", 0)).toBe(true);
 expect(await recovered.finish(op.capability, "failed", 2)).toBe(false);
 await reopened.close();
});
it("rejects malformed inputs, wrong capability, expired and repeated completion", async () => {
 const { api, ctx, db } = await fixture(); const op = await api.begin(ctx);
 await expect(api.finish(op.capability, "succeeded", 256)).rejects.toThrow();
 await expect(api.finish(op.capability, "succeeded\nsecret" as never, 0)).rejects.toThrow();
 expect(await api.finish("x".repeat(44), "failed", 1)).toBe(false);
 expect(await api.finish(op.capability, "cancelled", 0)).toBe(true);
 expect(await api.finish(op.capability, "failed", 1)).toBe(false);
 await db.close();
});
it("expires operations deterministically", async () => {
 let now = 10; const dir = await mkdtemp(join(tmpdir(), "login-op-")); dirs.push(dir);
 const db = await openDatabase(join(dir, "state.db")); const api = new LoginOperations(db, () => now, 5); await api.initialize();
 const ctx = { session: "s", agent: "a", profile: "p", capabilities: [], env: {} as never, signal: new AbortController().signal } as unknown as ToolContext;
 const op = await api.begin(ctx); now = 15;
 expect(await api.finish(op.capability, "interrupted", 1)).toBe(false);
 await db.close();
});

it("CAS allows exactly one concurrent terminal writer", async () => {
 const { api, ctx, db } = await fixture(); const op = await api.begin(ctx);
 const results = await Promise.all([api.finish(op.capability, "succeeded", 0), api.finish(op.capability, "failed", 1)]);
 expect(results.filter(Boolean)).toHaveLength(1);
 await db.close();
});
