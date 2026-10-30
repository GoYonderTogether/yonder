import type { DatabaseSync } from "node:sqlite";
import type { ExecutionOwner, PluginAPI, ToolContext } from "@yonder/sdk";
import { type WatchRules, watchMatches } from "./watch-rules.js";

interface Watch {
	id: string;
	agent: string;
	chat: string;
	profile: string;
	conv: string;
	purpose: string;
	notification: { to: string; via: string };
	ownerSession: string;
	ownerProfile: string;
	state: "active" | "paused" | "deleted";
	rules: WatchRules;
	version: number;
	cursor: number;
	created: string;
	updated: string;
	error?: string;
	lastControl?: { op: string; reason: string; from?: string };
	lastScan?: { at: string; version: number; through: number; count: number; matchedIds: number[] };
}
/** Per-Bot processing positions; acquisition continues to use the archive's shared consumer. */
export class Watches {
	constructor(
		private readonly api: PluginAPI,
		private readonly db: DatabaseSync,
		private readonly scope: (chat: unknown) => string,
		private readonly latest: (chat: string, signal: AbortSignal) => Promise<number>,
	) {
		db.exec(`CREATE TABLE IF NOT EXISTS watches(agent TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(agent,id));
		CREATE TABLE IF NOT EXISTS watch_rules(agent TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,rules TEXT NOT NULL,reason TEXT NOT NULL,ts TEXT NOT NULL,PRIMARY KEY(agent,id,version));
		CREATE TABLE IF NOT EXISTS watch_batches(agent TEXT NOT NULL,id TEXT NOT NULL,event TEXT NOT NULL,through INTEGER NOT NULL,session TEXT NOT NULL,ts TEXT NOT NULL,PRIMARY KEY(agent,id,event));`);
	}
	private pending: Promise<unknown> = Promise.resolve();
	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.pending.then(operation);
		this.pending = next.catch(() => {});
		return next;
	}
	private request(watch: Watch) {
		return {
			id: `wechat-watch-${watch.id}`,
			eventType: "wechat-archive.watch",
			conv: watch.conv,
			profile: watch.profile,
			notification: watch.notification,
		};
	}
	private validate(watch: Watch) {
		return this.api.agents.inspectBinding(this.request(watch), {
			agent: watch.agent,
			profile: watch.ownerProfile,
			session: watch.ownerSession,
		});
	}
	private read(agent: string, id: string): Watch {
		const row = this.db.prepare("SELECT payload FROM watches WHERE agent=? AND id=?").get(agent, id);
		if (!row) throw Error("WECHAT_WATCH_NOT_FOUND");
		return JSON.parse(String(row.payload));
	}
	private save(watch: Watch) {
		watch.updated = new Date().toISOString();
		this.db.prepare("INSERT OR REPLACE INTO watches VALUES(?,?,?)").run(watch.agent, watch.id, JSON.stringify(watch));
	}
	private all(agent?: string): Watch[] {
		const rows = agent
			? this.db.prepare("SELECT payload FROM watches WHERE agent=? ORDER BY id").all(agent)
			: this.db.prepare("SELECT payload FROM watches ORDER BY agent,id").all();
		return rows.map((row) => JSON.parse(String(row.payload)));
	}
	private revision(watch: Watch, rules: WatchRules, reason: string) {
		this.db
			.prepare("INSERT INTO watch_rules VALUES(?,?,?,?,?,?)")
			.run(watch.agent, watch.id, watch.version, JSON.stringify(rules), reason, new Date().toISOString());
	}
	private rows(chat: string, after: number, limit = 100) {
		return this.db
			.prepare("SELECT payload FROM messages WHERE chat=? AND id>? AND emitted>=0 ORDER BY id LIMIT ?")
			.all(chat, after, limit)
			.map((row) => JSON.parse(String(row.payload)) as { id: number; text: string; [key: string]: unknown });
	}
	private recent(chat: string, limit: number) {
		return this.db
			.prepare("SELECT payload FROM messages WHERE chat=? ORDER BY id DESC LIMIT ?")
			.all(chat, limit)
			.reverse()
			.map((row) => JSON.parse(String(row.payload)) as { id: number; text: string });
	}
	tool(name: string, p: Record<string, any>, ctx: ToolContext): Promise<unknown> {
		return this.serial(() => this.handle(name, p, ctx));
	}
	private async handle(name: string, p: Record<string, any>, ctx: ToolContext): Promise<unknown> {
		if (!ctx.agent) throw Error("WECHAT_WATCH_AGENT_REQUIRED");
		if (name === "watch_inspect" && !p.id)
			return { watches: await Promise.all(this.all(ctx.agent).map((w) => this.inspect(w))) };
		if (name === "watch_configure") return this.configure(p, ctx);
		const watch = this.read(ctx.agent, p.id);
		if (name === "watch_inspect") return this.inspect(watch);
		if (name === "watch_test") {
			this.scope(watch.chat);
			const messages = this.recent(watch.chat, p.limit ?? 30);
			return {
				dryRun: true,
				acquiredNow: false,
				id: watch.id,
				version: watch.version,
				rules: watch.rules,
				messages,
				matchedIds: messages.filter((m) => watchMatches(m.text, watch.rules)).map((m) => m.id),
				route: (await this.inspect(watch)).route,
				state: watch.state,
				cursor: watch.cursor,
			};
		}
		if (name !== "watch_control") throw Error("WECHAT_UNKNOWN_TOOL");
		if (p.expectedVersion !== watch.version) throw Error("WECHAT_WATCH_VERSION_CONFLICT");
		if (p.op === "pause" || p.op === "delete") watch.state = p.op === "pause" ? "paused" : "deleted";
		else if (p.op === "resume") {
			this.scope(watch.chat);
			if (!["paused", "now"].includes(p.from)) throw Error("WECHAT_WATCH_RESUME_FROM_REQUIRED");
			await this.validate(watch);
			if (p.from === "now") watch.cursor = await this.latest(watch.chat, ctx.signal);
			watch.state = "active";
		} else if (p.op === "rules" || p.op === "rollback") {
			let rules = p.rules as WatchRules;
			if (p.op === "rollback") {
				const old = this.db
					.prepare("SELECT rules FROM watch_rules WHERE agent=? AND id=? AND version=?")
					.get(watch.agent, watch.id, p.version);
				if (!old) throw Error("WECHAT_WATCH_RULE_VERSION_NOT_FOUND");
				rules = JSON.parse(String(old.rules));
			}
			if (!rules?.keywords?.length || !p.reason?.trim()) throw Error("WECHAT_WATCH_RULES_REASON_REQUIRED");
			watch.version++;
			watch.rules = rules;
			this.db.exec("BEGIN IMMEDIATE");
			try {
				this.revision(watch, rules, p.reason);
				this.save(watch);
				this.db.exec("COMMIT");
			} catch (error) {
				this.db.exec("ROLLBACK");
				throw error;
			}
			return this.inspect(watch);
		} else throw Error("WECHAT_WATCH_UNKNOWN_CONTROL");
		watch.lastControl = { op: p.op, reason: p.reason, ...(p.from ? { from: p.from } : {}) };
		delete watch.error;
		this.save(watch);
		return this.inspect(watch);
	}
	private async configure(p: Record<string, any>, ctx: ToolContext) {
		const chat = this.scope(p.chat);
		if (this.all(ctx.agent!).some((w) => w.id === p.id)) throw Error("WECHAT_WATCH_EXISTS");
		const now = new Date().toISOString();
		const watch: Watch = {
			id: p.id,
			agent: ctx.agent!,
			chat,
			purpose: p.purpose,
			profile: p.profile,
			notification: p.notification,
			rules: p.rules,
			conv: `conv:wechat-archive:watch:${ctx.agent}:${p.id}`,
			ownerSession: ctx.session,
			ownerProfile: ctx.profile,
			state: "active",
			version: 1,
			cursor: await this.latest(chat, ctx.signal),
			created: now,
			updated: now,
		};
		const route = await this.api.agents.configureBinding(this.request(watch), ctx);
		watch.notification = route.notification;
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.save(watch);
			this.revision(watch, watch.rules, p.reason);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
		return this.inspect(watch);
	}
	private async inspect(watch: Watch) {
		const batches = this.db
			.prepare(
				"SELECT event,through,session,ts FROM watch_batches WHERE agent=? AND id=? ORDER BY through DESC LIMIT 20",
			)
			.all(watch.agent, watch.id);
		const since = batches.at(-1)?.ts;
		const range = { ...(since ? { since: String(since) } : {}), limit: 1000 };
		const runs = await this.api.events.query({ type: "run.end", conv: watch.conv, ...range });
		const outputs = batches.length
			? await this.api.events.query({ type: "message.out", from: `agent:${watch.agent}`, ...range })
			: { events: [], next: undefined };
		const completed = runs.events;
		const deliveries = outputs.events;
		const receipts = batches.map((batch) => {
			const ended = completed.find((e) => (e.data as { inputs?: string[] }).inputs?.includes(String(batch.event)));
			const output = deliveries.filter((e) => {
				const d = e.data as { session?: string; to?: string };
				return (
					d.session === batch.session &&
					d.to === watch.notification.to &&
					(e.parent === batch.event ||
						Boolean(ended && (ended.data as { inputs?: string[] }).inputs?.includes(e.parent ?? "")))
				);
			});
			return {
				...batch,
				processed: ended ? { event: ended.id, ts: ended.ts, ...ended.data } : null,
				deliveries: output.map((e) => ({ event: e.id, ts: e.ts, ...(e.data as object) })),
			};
		});
		let route: unknown;
		try {
			this.scope(watch.chat);
			route = { valid: true, details: await this.validate(watch) };
		} catch (error) {
			route = { valid: false, error: String(error instanceof Error ? error.message : error) };
		}
		return {
			watch,
			route,
			rules: this.db
				.prepare("SELECT version,rules,reason,ts FROM watch_rules WHERE agent=? AND id=? ORDER BY version DESC")
				.all(watch.agent, watch.id)
				.map((r) => ({ ...r, rules: JSON.parse(String(r.rules)) })),
			receipts,
			receiptCoverage: { recentBatches: 20, runsComplete: !runs.next, deliveriesComplete: !outputs.next },
			read: "unknown",
		};
	}
	async beforeSend(to: string, owner: ExecutionOwner) {
		const session = await this.api.sessions.get(owner.session);
		if (session?.mode !== "persistent" || !session.key.startsWith("conv:conv:wechat-archive:watch:")) return;
		const watch = this.all(session.agent ?? "").find((w) => session.key === `conv:${w.conv}`);
		if (!watch || to !== watch.notification.to) throw Error("WECHAT_WATCH_PRIVATE_TARGET_REQUIRED");
		this.scope(watch.chat);
		await this.validate(watch);
	}
	flush() {
		return this.serial(() => this.process());
	}
	private async process() {
		for (const watch of this.all().filter((w) => w.state === "active")) {
			try {
				this.scope(watch.chat);
				await this.validate(watch);
				const messages = this.rows(watch.chat, watch.cursor);
				if (!messages.length) {
					if (watch.error) {
						delete watch.error;
						this.save(watch);
					}
					continue;
				}
				const through = messages.at(-1)!.id;
				const matchedIds = messages.filter((m) => watchMatches(m.text, watch.rules)).map((m) => m.id);
				watch.lastScan = {
					at: new Date().toISOString(),
					version: watch.version,
					through,
					count: messages.length,
					matchedIds,
				};
				if (matchedIds.length) {
					const msgId = `${watch.agent}:${watch.id}:${watch.version}:${watch.cursor}:${through}`;
					const accepted = await this.api.events.emit({
						type: "wechat-archive.watch",
						from: "plugin:wechat-archive",
						conv: watch.conv,
						data: {
							externalContent: true,
							msgId,
							subscription: watch.id,
							chat: watch.chat,
							purpose: watch.purpose,
							ruleVersion: watch.version,
							notification: watch.notification,
							matchedIds,
							messages,
							coverage: "local archive only; incomplete",
						},
					});
					const route = accepted.routes?.find(
						(r) => r.agent === watch.agent && r.session && !r.dropped && r.wake === "run",
					);
					if (!route?.session) throw Error("WECHAT_WATCH_NOT_ACCEPTED");
					this.db
						.prepare("INSERT OR IGNORE INTO watch_batches VALUES(?,?,?,?,?,?)")
						.run(watch.agent, watch.id, accepted.id, through, route.session, accepted.ts);
				}
				watch.cursor = through;
				delete watch.error;
				this.save(watch);
			} catch (error) {
				watch.error = error instanceof Error ? error.message : String(error);
				this.save(watch);
			}
		}
	}
}
