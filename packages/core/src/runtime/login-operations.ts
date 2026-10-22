import { createHash, randomBytes } from "node:crypto";
import type { ToolContext } from "@yonder/sdk";
import type { Db, DbExecutor } from "./db.js";

export type LoginOutcome = "succeeded" | "failed" | "cancelled" | "interrupted" | "expired";
export interface LoginOperation {
	id: string;
	capability: string;
	expiresAt: number;
}
export interface LoginOutboxEntry {
	id: string;
	operationId: string;
	session: string;
	event: string | null;
	outcome: LoginOutcome;
	code: number | null;
	finishedAt: number;
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
		await this.db.exec(`CREATE TABLE IF NOT EXISTS login_outbox (
   id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES login_operations(id), session TEXT NOT NULL,
   event TEXT, outcome TEXT NOT NULL, code INTEGER, finished_at INTEGER NOT NULL, acknowledged_at INTEGER)`);
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
	private async enqueue(tx: DbExecutor, id: string, state: LoginOutcome, code: number | null, finishedAt: number) {
		await tx.run(
			"INSERT INTO login_outbox(id,operation_id,session,event,outcome,code,finished_at) SELECT id,id,session,event,?,?,? FROM login_operations WHERE id=?",
			state,
			code,
			finishedAt,
			id,
		);
	}
	async finish(capability: string, outcome: LoginOutcome, code: number): Promise<boolean> {
		if (typeof capability !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(capability))
			throw new Error("Invalid capability");
		if (!outcomes.has(outcome) || !Number.isInteger(code) || code < 0 || code > 255)
			throw new Error("Invalid terminal result");
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.db.transaction(async (tx) => {
					const now = this.now();
					const row = await tx.get<{ id: string; expires_at: number; state: string }>(
						"SELECT id,expires_at,state FROM login_operations WHERE capability_hash=?",
						hash(capability),
					);
					if (row?.state !== "pending" || row.expires_at <= now) return false;
					const updated = await tx.get<{ id: string }>(
						"UPDATE login_operations SET state=?,code=?,finished_at=? WHERE id=? AND state='pending' AND expires_at>? RETURNING id",
						outcome,
						code,
						now,
						row.id,
						now,
					);
					if (!updated) return false;
					await this.enqueue(tx, row.id, outcome, code, now);
					return true;
				});
			} catch (error) {
				if (attempt >= 5 || !(error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message)))
					throw error;
				await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
			}
		}
	}
	async expirePending(): Promise<number> {
		return this.db.transaction(async (tx) => {
			const now = this.now();
			const expired = await tx.all<{ id: string }>(
				"UPDATE login_operations SET state='expired',finished_at=? WHERE state='pending' AND expires_at<=? RETURNING id",
				now,
				now,
			);
			for (const row of expired) await this.enqueue(tx, row.id, "expired", null, now);
			return expired.length;
		});
	}
	async readUnacknowledged(limit = 100): Promise<LoginOutboxEntry[]> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid limit");
		return this.db.all<LoginOutboxEntry>(
			"SELECT id,operation_id AS operationId,session,event,outcome,code,finished_at AS finishedAt FROM login_outbox WHERE acknowledged_at IS NULL ORDER BY finished_at,id LIMIT ?",
			limit,
		);
	}
	async acknowledge(id: string): Promise<boolean> {
		if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid outbox id");
		return this.db.transaction(async (tx) => {
			const result = await tx.get<{ id: string }>(
				"UPDATE login_outbox SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL RETURNING id",
				this.now(),
				id,
			);
			return result !== undefined;
		});
	}
}
