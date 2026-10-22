import { createHash, randomBytes } from "node:crypto";
import type { ToolContext } from "@yonder/sdk";
import type { Db } from "./db.js";

export type LoginOutcome = "succeeded" | "failed" | "cancelled" | "interrupted";
export interface LoginOperation {
	id: string;
	capability: string;
	expiresAt: number;
}
const outcomes = new Set<LoginOutcome>(["succeeded", "failed", "cancelled", "interrupted"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Durable, bearer-capability completion API. Never log or put capability in process argv. */
export class LoginOperations {
	constructor(
		private readonly db: Db,
		private readonly now: () => number = Date.now,
		private readonly ttlMs = 10 * 60_000,
	) {}
	async initialize() {
		await this.db.exec(`CREATE TABLE IF NOT EXISTS login_operations (
   id TEXT PRIMARY KEY, capability_hash TEXT NOT NULL UNIQUE, session TEXT NOT NULL, agent TEXT,
   event TEXT, state TEXT NOT NULL, code INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER)`);
	}
	async begin(ctx: ToolContext): Promise<LoginOperation> {
		if (!ctx.session || ctx.session.length > 512 || (ctx.agent !== null && ctx.agent.length > 256))
			throw new Error("Invalid trusted context");
		const event = ctx.event?.id;
		const id = randomBytes(16).toString("hex"),
			capability = randomBytes(32).toString("base64url"),
			now = this.now();
		await this.db.run(
			"INSERT INTO login_operations(id,capability_hash,session,agent,event,state,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)",
			id,
			hash(capability),
			ctx.session,
			ctx.agent,
			event ?? null,
			now,
			now + this.ttlMs,
		);
		return { id, capability, expiresAt: now + this.ttlMs };
	}
	async finish(capability: string, outcome: LoginOutcome, code: number): Promise<boolean> {
		if (typeof capability !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(capability))
			throw new Error("Invalid capability");
		if (!outcomes.has(outcome) || !Number.isInteger(code) || code < 0 || code > 255)
			throw new Error("Invalid terminal result");
		const result = await this.db.transaction(async (tx) => {
			const now = this.now();
			const row = await tx.get<{ id: string; expires_at: number; state: string }>(
				"SELECT id,expires_at,state FROM login_operations WHERE capability_hash=?",
				hash(capability),
			);
			if (!row || row.state !== "pending" || row.expires_at <= now) return false;
			const updated = await tx.get<{ id: string }>(
				"UPDATE login_operations SET state=?,code=?,finished_at=? WHERE id=? AND state='pending' AND expires_at>? RETURNING id",
				outcome,
				code,
				now,
				row.id,
				now,
			);
			return updated !== undefined;
		});
		return result;
	}
}
