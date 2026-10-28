import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { EventInput, PluginAPI, ToolResult } from "@yonder/sdk";
import { readWechatMediaFile, safeMessage, source } from "./source.js";

export interface Config {
	cliPath?: string;
	chats?: string[];
	discovery?: boolean;
	pollSeconds?: number;
	consumer?: string;
	mediaRoot?: string;
	pinnedPolicies?: Record<string, Record<string, unknown>>;
}
const defaults = {
	priority: "watch",
	purpose: "",
	note: "",
	role: "",
	tags: [] as string[],
	collect: false,
	dailyReview: true,
	keywords: [] as string[],
	periodicMinutes: 1440,
	evidence: [] as number[],
};
/** A batch row's archived messages, as normalized by `safeMessage`. */
interface ArchivedMessage {
	sender?: string | null;
	text?: string;
	direction?: string;
	media?: { kind?: string };
}

/** One-line hint for the kernel notification record; the messages themselves stay in `data.messages`. */
export function batchSummary(messages: readonly ArchivedMessage[]): string {
	const incoming = messages.filter((item) => item.direction !== "outgoing");
	const pick = incoming.length ? incoming : messages;
	const body = (item: ArchivedMessage): string => {
		const text = (item.text ?? "").trim().slice(0, 60);
		const kind = item.media?.kind && item.media.kind !== "unknown" ? item.media.kind : "";
		return text || (kind ? `[${kind}]` : "[无正文]");
	};
	const last = pick[pick.length - 1];
	if (!last) return "";
	if (pick.length === 1) return last.sender ? `${last.sender}: ${body(last)}` : body(last);
	const senders = [...new Set(pick.map((item) => item.sender).filter((name): name is string => Boolean(name)))];
	const names = senders.length ? `（${senders.slice(0, 3).join("、")}）` : "";
	return `${pick.length} 条消息${names}：${body(last)}`;
}
export class Archive {
	private db: DatabaseSync | undefined;
	private readonly lifetime = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private work: Promise<void> | undefined;
	private error: string | null = null;
	private lastSuccess: string | null = null;
	private lastSync: number | null = null;
	private operations = new Set<Promise<unknown>>();
	constructor(
		private readonly api: PluginAPI,
		readonly config: Config,
	) {}
	private async database(): Promise<DatabaseSync> {
		if (this.db) return this.db;
		await mkdir(this.api.paths.data, { recursive: true, mode: 0o700 });
		// Initialization is serialized by callers through open(), before concurrent tools start.
		if (this.db) return this.db;
		await chmod(this.api.paths.data, 0o700);
		const filename = join(this.api.paths.data, "archive.sqlite");
		this.db = new DatabaseSync(filename);
		await chmod(filename, 0o600);
		this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(chat TEXT PRIMARY KEY,metadata TEXT NOT NULL,initialized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS policies(chat TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,chat TEXT NOT NULL,payload TEXT NOT NULL,batch TEXT,emitted INTEGER NOT NULL DEFAULT -1);
      CREATE INDEX IF NOT EXISTS pending ON messages(emitted,batch);`);
		for (const chat of this.config.chats ?? [])
			this.discover({ chat, chatType: "unknown", coverage: "configured; history on demand" });
		return this.db;
	}
	private opening: Promise<DatabaseSync> | undefined;
	private open(): Promise<DatabaseSync> {
		this.lifetime.signal.throwIfAborted();
		this.opening ??= this.database();
		return this.opening;
	}
	private meta(key: string): string | undefined {
		return this.db!.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value as string | undefined;
	}
	private set(key: string, value: unknown): void {
		this.db!.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(key, String(value));
	}
	private policy(chat: string): Record<string, any> {
		const row = this.db!.prepare("SELECT * FROM policies WHERE chat=?").get(chat);
		if (!row) throw new Error("WECHAT_CHAT_OUT_OF_SCOPE");
		return {
			...defaults,
			...JSON.parse(String(row.payload)),
			...this.config.pinnedPolicies?.[chat],
			userPinned: Boolean(this.config.pinnedPolicies?.[chat]),
			chat,
			version: Number(row.version),
		};
	}
	private allowed(chat: string): boolean {
		return (
			(this.config.chats ?? []).includes(chat) ||
			(this.config.discovery === true &&
				Boolean(this.db!.prepare("SELECT chat FROM conversations WHERE chat=?").get(chat)))
		);
	}
	private scope(chat: unknown): string {
		if (typeof chat !== "string" || !this.allowed(chat) || this.policy(chat).priority === "silent")
			throw new Error("WECHAT_CHAT_OUT_OF_SCOPE");
		return chat;
	}
	private discover(entry: Record<string, any>): void {
		if (typeof entry.chat !== "string" || !/^Msg_[a-fA-F0-9]+$/.test(entry.chat))
			throw new Error("WECHAT_INVALID_SOURCE");
		const data = {
			chat: entry.chat,
			displayName: typeof entry.displayName === "string" ? entry.displayName : entry.chat,
			chatType: ["p2p", "group", "official"].includes(entry.chatType) ? entry.chatType : "unknown",
			lastTimestamp: Number.isSafeInteger(entry.lastTimestamp) ? entry.lastTimestamp : null,
			messageCount: Number.isSafeInteger(entry.messageCount) ? entry.messageCount : null,
			coverage: "local archive only; incomplete",
		};
		this.db!.prepare(
			"INSERT INTO conversations(chat,metadata) VALUES(?,?) ON CONFLICT(chat) DO UPDATE SET metadata=excluded.metadata",
		).run(entry.chat, JSON.stringify(data));
		this.db!.prepare("INSERT OR IGNORE INTO policies(chat,payload) VALUES(?,?)").run(
			entry.chat,
			JSON.stringify(defaults),
		);
	}
	private read(args: string[], signal = this.lifetime.signal): Promise<Record<string, any>> {
		return source(
			this.config.cliPath ?? join(homedir(), ".local/bin/wechat-context"),
			args,
			AbortSignal.any([signal, this.lifetime.signal]),
		);
	}
	private store(
		messages: Record<string, any>[],
		chat?: string,
		enqueue = false,
		cursorKey?: string,
		cursor?: number,
	): unknown[] {
		const clean = messages.map((m) => safeMessage(m, chat ?? m.chat));
		const digest = createHash("sha256")
			.update(JSON.stringify(clean.map((m) => m.id)))
			.digest("hex");
		this.db!.exec("BEGIN IMMEDIATE");
		try {
			for (const message of clean) {
				const batch = `${message.chat}:${digest}`;
				this.db!.prepare(
					"INSERT INTO messages(id,chat,payload,batch,emitted) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,batch=CASE WHEN messages.emitted=-1 AND excluded.emitted=0 THEN excluded.batch ELSE messages.batch END,emitted=CASE WHEN messages.emitted=-1 AND excluded.emitted=0 THEN 0 ELSE messages.emitted END",
				).run(message.id, message.chat, JSON.stringify(message), enqueue ? batch : null, enqueue ? 0 : -1);
			}
			if (cursorKey && cursor !== undefined) this.set(cursorKey, cursor);
			this.db!.exec("COMMIT");
			return clean;
		} catch (error) {
			this.db!.exec("ROLLBACK");
			throw error;
		}
	}
	status(): object {
		return {
			enabled: Boolean(this.config.discovery || this.config.chats?.length),
			lastSuccess: this.lastSuccess,
			lastSync: this.lastSync,
			error: this.error,
			stopped: this.lifetime.signal.aborted,
			...(this.db
				? {
						discovered: Number(this.db.prepare("SELECT COUNT(*) AS n FROM conversations").get()?.n),
						sampled: Number(this.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE initialized=1").get()?.n),
						catalogComplete: this.meta("catalogComplete") === "true",
						catalogTotal: this.meta("catalogTotal") ?? null,
						pending: Number(this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE emitted=0").get()?.n),
					}
				: {}),
		};
	}
	async tool(name: string, args: Record<string, any>, signal: AbortSignal): Promise<ToolResult> {
		const operation = this.handle(name, args, signal);
		this.operations.add(operation);
		try {
			return await operation;
		} finally {
			this.operations.delete(operation);
		}
	}
	private async handle(name: string, p: Record<string, any>, signal: AbortSignal): Promise<ToolResult> {
		await this.open();
		signal.throwIfAborted();
		const result = (value: unknown): ToolResult => ({
			text: JSON.stringify({ externalContent: true, ...(value as object) }),
		});
		if (name === "status") return result(this.status());
		if (name === "sources") {
			const page = await this.read(
				["catalog", "--limit", String(p.limit ?? 20), "--offset", String(p.offset ?? 0)],
				signal,
			);
			if (!Array.isArray(page.catalog)) throw new Error("WECHAT_INVALID_CATALOG");
			const entries = page.catalog.filter(
				(entry: Record<string, any>) => this.config.discovery || (this.config.chats ?? []).includes(entry.chat),
			);
			for (const entry of entries) this.discover(entry);
			return result({
				sources: entries.map((e: Record<string, any>) => ({
					...JSON.parse(
						String(this.db!.prepare("SELECT metadata FROM conversations WHERE chat=?").get(e.chat)?.metadata),
					),
					policy: this.policy(e.chat),
				})),
				nextOffset: page.nextOffset ?? null,
				total: page.total ?? null,
				coverage: "local archive only; incomplete",
			});
		}
		if (name === "policy") {
			if (p.op === "list") {
				const rows = this.db!.prepare("SELECT chat FROM policies ORDER BY chat LIMIT ? OFFSET ?").all(
					(p.limit ?? 20) + 1,
					p.offset ?? 0,
				);
				return result({
					policies: rows
						.slice(0, p.limit ?? 20)
						.filter((r) => this.allowed(String(r.chat)))
						.map((r) => this.policy(String(r.chat))),
					nextOffset: rows.length > (p.limit ?? 20) ? (p.offset ?? 0) + (p.limit ?? 20) : null,
				});
			}
			if (typeof p.chat !== "string" || !this.allowed(p.chat)) throw new Error("WECHAT_CHAT_OUT_OF_SCOPE");
			const current = this.policy(p.chat);
			if (p.op === "get") return result({ policy: current });
			if (this.config.pinnedPolicies?.[p.chat]) throw new Error("WECHAT_POLICY_USER_PINNED");
			if (p.expectedVersion !== current.version) throw new Error("WECHAT_POLICY_VERSION_CONFLICT");
			const value: Record<string, any> = p.op === "delete" ? { ...current, priority: "silent" } : { ...current, ...p };
			if (
				value.evidence.some(
					(id: number) => !this.db!.prepare("SELECT id FROM messages WHERE id=? AND chat=?").get(id, p.chat),
				)
			)
				throw new Error("WECHAT_POLICY_INVALID_EVIDENCE");
			const clean = Object.fromEntries(Object.keys(defaults).map((k) => [k, value[k]]));
			this.db!.prepare("UPDATE policies SET payload=?,version=version+1 WHERE chat=?").run(
				JSON.stringify(clean),
				p.chat,
			);
			if (value.priority === "silent")
				this.db!.prepare("UPDATE messages SET emitted=1 WHERE chat=? AND emitted=0").run(p.chat);
			return result({ policy: this.policy(p.chat) });
		}
		const chat = this.scope(p.chat);
		if (name === "history" || name === "search") {
			const args = [name, "--chat", chat, "--normalized", "--limit", String(p.limit ?? 30)];
			if (name === "search") args.push("--keyword", p.keyword);
			if (p.before !== undefined) args.push("--before", String(p.before));
			const page = await this.read(args, signal);
			if (!Array.isArray(page.messages)) throw new Error("WECHAT_INVALID_MESSAGES");
			return result({ messages: this.store(page.messages, chat), nextBefore: page.nextBefore ?? null });
		}
		const stored = this.db!.prepare("SELECT payload FROM messages WHERE id=? AND chat=?").get(p.id, chat);
		if (!stored) throw new Error("WECHAT_MESSAGE_NOT_DISCOVERED");
		if (name === "message") {
			const page = await this.read(["message", String(p.id)], signal);
			return result({ message: this.store([page.message], chat)[0] });
		}
		if (name !== "media") throw new Error("WECHAT_UNKNOWN_TOOL");
		const page = await this.read(["media", String(p.id)], signal),
			media = page.media;
		if (!media || !["available", "missing", "encrypted", "unsupported"].includes(media.availability))
			throw new Error("WECHAT_INVALID_MEDIA");
		if (media.availability !== "available")
			return result({ media: { availability: media.availability, kind: media.kind } });
		if (
			!["image", "voice", "file", "video"].includes(media.kind) ||
			typeof media.mime !== "string" ||
			!Number.isSafeInteger(media.size) ||
			media.size < 0 ||
			media.size > 100 * 1024 * 1024 ||
			typeof media.filename !== "string"
		)
			throw new Error("WECHAT_INVALID_MEDIA");
		const root =
			this.config.mediaRoot ??
			join(process.env.WX_CONTEXT_HOME ?? join(homedir(), "Library/Application Support/wechat-context"), "media");
		const bytes = await readWechatMediaFile(root, media.path, 100 * 1024 * 1024);
		if (bytes.length !== media.size) throw new Error("WECHAT_MEDIA_CHANGED");
		const attachment = {
			kind: media.kind === "voice" ? "audio" : media.kind,
			mime: media.mime,
			uri: pathToFileURL(media.path).href,
			name: media.filename,
			bytes: media.size,
		};
		return {
			...result({
				media: {
					availability: "available",
					kind: attachment.kind,
					mime: media.mime,
					name: media.filename,
					bytes: media.size,
				},
				transcription: "not-requested",
			}),
			attachments: [attachment],
			...(media.kind === "image" && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media.mime)
				? { images: [{ mime: media.mime, data: bytes.toString("base64") }] }
				: {}),
		};
	}
	async start(emit: (e: EventInput) => Promise<unknown>): Promise<void> {
		await this.open();
		if (this.config.discovery || this.config.chats?.length) this.schedule(emit, 0);
	}
	private schedule(emit: (e: EventInput) => Promise<unknown>, delay: number): void {
		if (this.lifetime.signal.aborted) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.work = this.poll(emit)
				.catch(() => {
					this.error = "WECHAT_ARCHIVE_POLL_FAILED";
				})
				.finally(() => {
					this.work = undefined;
					this.schedule(emit, (this.config.pollSeconds ?? 60) * 1000);
				});
		}, delay);
		this.timer.unref();
	}
	async poll(emit: (e: EventInput) => Promise<unknown>): Promise<void> {
		await this.open();
		await this.flush(emit);
		const health = await this.read(["status"]);
		this.lastSync = typeof health.last_sync?.at === "number" ? health.last_sync.at : null;
		if (!this.lastSync || Date.now() - this.lastSync * 1000 > 180000) {
			this.error = "WECHAT_SYNC_STALE";
			return;
		}
		if (this.config.discovery) {
			const page = await this.read(["catalog", "--limit", "100", "--offset", this.meta("catalogOffset") ?? "0"]);
			if (!Array.isArray(page.catalog)) throw new Error("WECHAT_INVALID_CATALOG");
			for (const entry of page.catalog) this.discover(entry);
			this.set("catalogOffset", page.nextOffset ?? 0);
			this.set("catalogComplete", page.nextOffset === null);
			if (page.total !== undefined) this.set("catalogTotal", page.total);
			await this.window();
		}
		const active = this.db!.prepare(
			"SELECT chat,initialized FROM conversations ORDER BY initialized,json_extract(metadata,'$.lastTimestamp') DESC,chat",
		)
			.all()
			.filter((r) => this.allowed(String(r.chat)) && this.policy(String(r.chat)).priority !== "silent");
		const offset = Number(this.meta("scanOffset") ?? 0) % Math.max(1, active.length);
		const uninitialized = active.filter((row) => !row.initialized);
		const selected = uninitialized.length
			? uninitialized.slice(0, 2)
			: [...active.slice(offset), ...active.slice(0, offset)].slice(0, 2);
		for (const row of selected) {
			const chat = String(row.chat);
			if (!this.config.discovery) await this.window(chat);
			if (!row.initialized) {
				const page = await this.read(["history", "--chat", chat, "--normalized", "--limit", "3"]);
				if (!Array.isArray(page.messages) || page.messages.length > 3) throw new Error("WECHAT_INVALID_SAMPLE");
				this.store(page.messages, chat, true);
				this.db!.prepare("UPDATE conversations SET initialized=1 WHERE chat=?").run(chat);
			}
		}
		this.set("scanOffset", offset + selected.length);
		await this.flush(emit);
		this.lastSuccess = new Date().toISOString();
		this.error = null;
	}
	private async window(chat?: string): Promise<void> {
		const key = chat ?? "*";
		const consumer = `${this.config.consumer ?? "yonder-wechat"}-${createHash("sha256")
			.update(this.api.paths.data + key)
			.digest("hex")
			.slice(0, 16)}`;
		const scope = chat ? ["--chat", chat] : [];
		if (this.meta(`seed:${key}`) === undefined) {
			if (!this.meta(`seed-intent:${key}`)) {
				this.set(`seed-intent:${key}`, Date.now());
				const baseline = await this.read(["fetch-new", "--consumer", consumer, ...scope, "--from-now"]);
				if (!Number.isSafeInteger(baseline.cursor) || baseline.cursor < 0) throw new Error("WECHAT_INVALID_BASELINE");
				this.set(`seed:${key}`, baseline.cursor);
			} else {
				const prior = await this.read(["check-new", "--consumer", consumer, ...scope]);
				if (!Number.isSafeInteger(prior.cursor) || prior.cursor < 0 || (prior.cursor === 0 && prior.count > 0))
					throw new Error("WECHAT_INITIALIZATION_UNKNOWN");
				this.set(`seed:${key}`, prior.cursor);
			}
		}
		const cursor = this.meta(`cursor:${key}`);
		if (cursor !== undefined) await this.read(["check-new", "--consumer", consumer, ...scope, "--ack", cursor]);
		const batch = await this.read([
			chat ? "fetch-new" : "window",
			"--consumer",
			consumer,
			...scope,
			"--limit",
			chat ? "100" : "1000",
		]);
		if (!Array.isArray(batch.messages) || !Number.isSafeInteger(batch.cursor) || batch.cursor < 0)
			throw new Error("WECHAT_INVALID_WINDOW");
		const eligible = [];
		for (const m of batch.messages) {
			if (!/^Msg_[a-fA-F0-9]+$/.test(m.chat) || m.id > batch.cursor) throw new Error("WECHAT_INVALID_MESSAGE");
			safeMessage(m, chat ?? m.chat);
			if (!this.allowed(m.chat) && this.config.discovery)
				this.discover({ chat: m.chat, displayName: m.chatName, chatType: m.chatType });
			if (this.allowed(m.chat) && this.policy(m.chat).priority !== "silent") eligible.push(m);
		}
		this.store(eligible, chat, true, `cursor:${key}`, batch.cursor);
		await this.read(["check-new", "--consumer", consumer, ...scope, "--ack", String(batch.cursor)]);
	}
	private async flush(emit: (e: EventInput) => Promise<unknown>): Promise<void> {
		const emittedChats = new Set<string>();
		const batches = this.db!.prepare(
			"SELECT batch AS id,chat FROM messages WHERE emitted=0 GROUP BY batch,chat ORDER BY MIN(id)",
		).all();
		for (const batch of batches) {
			const chat = String(batch.chat);
			if (!this.allowed(chat)) continue;
			const policy = this.policy(chat);
			if (policy.priority === "silent") continue;
			if (
				policy.priority === "periodic" &&
				Date.now() - Number(this.meta(`emitted:${chat}`) ?? 0) < policy.periodicMinutes * 60000
			)
				continue;
			const conversation = `conv:wechat-archive:${chat}`;
			const rows = this.db!.prepare("SELECT payload FROM messages WHERE batch=? AND emitted=0 ORDER BY id").all(
				String(batch.id),
			);
			const messages = rows.map((r) => JSON.parse(String(r.payload)) as ArchivedMessage & { text: string });
			await emit({
				type: "wechat-archive.material",
				from: "plugin:wechat-archive",
				conv: conversation,
				data: {
					externalContent: true,
					batchId: batch.id,
					msgId: batch.id,
					channel: "wechat-archive",
					conversation,
					chat,
					senders: [...new Set(messages.map((m) => m.sender).filter((n): n is string => Boolean(n)))],
					summary: batchSummary(messages),
					policy,
					messages,
					keywordMatches: policy.keywords.filter((k: string) => messages.some((m) => m.text.includes(k))),
					coverage: "local archive only; incomplete",
				},
			});
			this.db!.prepare("UPDATE messages SET emitted=1 WHERE batch=?").run(String(batch.id));
			emittedChats.add(chat);
		}
		for (const chat of emittedChats) this.set(`emitted:${chat}`, Date.now());
	}
	async stop(): Promise<void> {
		this.lifetime.abort();
		if (this.timer) clearTimeout(this.timer);
		await Promise.allSettled([this.work, ...this.operations]);
		this.db?.close();
		this.db = undefined;
	}
}
