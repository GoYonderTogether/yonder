import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acct, type ChannelIO, conv, type PluginAPI, parseRef } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";
import {
	type HistoryQuery,
	historyEnvelope,
	historyPage,
	mergedInput,
	type Prepared,
	recoveryBatches,
} from "./history.js";
import type { FeishuInteraction } from "./interaction.js";
import { type ObjectValue, object, required, string } from "./protocol.js";
import type { FeishuTaskCards } from "./task-card.js";

/** What the history/recovery layer needs from the live channel instance. */
export interface HistoryHost {
	readonly id: string;
	readonly appId: string;
	readonly api: PluginAPI;
	readonly client: FeishuApi;
	readonly directory: string;
	readonly lifetime: AbortSignal;
	readonly interaction: FeishuInteraction;
	readonly taskCards: FeishuTaskCards;
	/** Watermark and receipt state lives on the channel; this layer reads and writes it. */
	baseline(): number;
	setBaseline(value: number): void;
	tenant(): string;
	setTenant(value: string): void;
	conversations: Map<string, { kind: "dm" | "group"; through: number }>;
	seen: Map<string, string>;
	recoveryState(value?: object): object;
	stopped(): boolean;
	io(): ChannelIO | undefined;
	serialize(work: () => Promise<void>): Promise<void>;
	allowed(sender: string, chat: string): boolean;
	/** Configured chat allowlist; unconfigured means every chat in this instance. */
	chatExcluded(chat: string): boolean;
	fail(error: unknown): void;
	save(): Promise<void>;
	saveHistory(): Promise<void>;
	prepare(
		data: ObjectValue,
		senderId: string,
		chat: string,
		messageId: string,
		key: string,
		signal?: AbortSignal,
	): Promise<Prepared>;
}

export class FeishuRecovery {
	constructor(private readonly host: HistoryHost) {}
	private messageKey = (tenant: string, id: string) => `${this.host.appId}:${tenant}:message:${id}`;
	async loadHistory(): Promise<void> {
		let initializeFromLedger = false;
		try {
			const saved = object(JSON.parse(await readFile(join(this.host.directory, "history.json"), "utf8")));
			if (typeof saved.baseline !== "number" || !Array.isArray(saved.conversations))
				throw new Error("Invalid Feishu history watermarks");
			this.host.setBaseline(saved.baseline);
			for (const entry of saved.conversations) {
				const row = object(entry);
				if (
					typeof row.chat !== "string" ||
					!["dm", "group"].includes(string(row.kind)) ||
					typeof row.through !== "number"
				)
					throw new Error("Invalid Feishu conversation watermark");
				this.host.conversations.set(row.chat, { kind: row.kind as "dm" | "group", through: row.through });
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			initializeFromLedger = true;
		}
		// The event ledger, not the receipt file, is the durable acceptance fact.
		let after: string | undefined;
		do {
			const page = await this.host.api.events.query({ type: "message.in", ...(after ? { after } : {}), limit: 500 });
			for (const event of page.events) {
				if (!event.conv?.startsWith(`conv:${this.host.id}:`)) continue;
				const data = object(event.data),
					tenant = string(data.tenant);
				if (tenant) this.host.setTenant(tenant);
				const originals = Array.isArray(data.originals) ? data.originals.map(object) : [data];
				const acceptedTimes: number[] = [];
				for (const original of originals) {
					const id = string(original.messageId) || string(original.msgId);
					if (id && original.complete !== false)
						this.host.seen.set(this.messageKey(string(original.tenant) || tenant, id), event.id);
					if (original.complete !== false) {
						const time =
							original.createdAt === undefined || original.createdAt === ""
								? Date.parse(event.ts)
								: Number(original.createdAt);
						if (Number.isFinite(time)) acceptedTimes.push(time);
					}
				}
				const chat = parseRef(event.conv).id;
				const existing = this.host.conversations.get(chat);
				if (initializeFromLedger && acceptedTimes.length) {
					const through = Math.max(...acceptedTimes);
					this.host.conversations.set(chat, {
						kind: data.kind === "dm" ? "dm" : "group",
						through: existing ? Math.max(existing.through, through) : through,
					});
				} else if (!existing && !initializeFromLedger) {
					this.host.conversations.set(chat, {
						kind: data.kind === "dm" ? "dm" : "group",
						through: this.host.baseline(),
					});
				}
			}
			after = page.next;
		} while (after);
		await this.host.saveHistory();
	}
	async history(query: HistoryQuery, signal: AbortSignal): Promise<{ items: object[]; next?: string }> {
		const page = await historyPage(this.host.client, query, AbortSignal.any([signal, this.host.lifetime]));
		const items: object[] = [];
		for (const item of page.items) {
			if (item.chat_id !== query.chat) throw new Error("Feishu history returned a different source");
			if (item.deleted || object(item.sender).sender_type !== "user") {
				items.push(item);
				continue;
			}
			const envelope = historyEnvelope(
				item,
				query.chat,
				this.host.conversations.get(query.chat)?.kind ?? "group",
				this.host.tenant(),
			);
			const sender = object(envelope.sender),
				message = object(envelope.message);
			const prepared = await this.host.prepare(
				envelope,
				string(object(sender.sender_id).open_id),
				query.chat,
				string(message.message_id),
				"query",
				AbortSignal.any([signal, this.host.lifetime]),
			);
			items.push(prepared.original);
		}
		return { items, ...(page.next ? { next: page.next } : {}) };
	}
	async catchup(): Promise<void> {
		const cutoff = Date.now();
		this.host.recoveryState({ state: "running", cutoff, privateChats: "known-only" });
		let count = 0,
			covered = 0;
		const failures: string[] = [];
		try {
			let token: string | undefined;
			do {
				const params = new URLSearchParams({ page_size: "100", ...(token ? { page_token: token } : {}) });
				const data = object(
					(await this.host.client.request(`/im/v1/chats?${params}`, "GET", undefined, this.host.lifetime)).data,
				);
				if (!Array.isArray(data.items)) throw new Error("Feishu chat list omitted items");
				for (const row of data.items) {
					const chat = required(object(row).chat_id, "History chat id");
					if (!this.host.conversations.has(chat))
						this.host.conversations.set(chat, { kind: "group", through: this.host.baseline() });
				}
				token = data.has_more ? required(data.page_token, "Chat next page token") : undefined;
			} while (token);
		} catch (error) {
			failures.push(this.host.client.safe(error));
		}
		await this.host.saveHistory();
		for (const [chat, state] of this.host.conversations) {
			if (this.host.stopped()) break;
			if (this.host.chatExcluded(chat)) continue;
			try {
				const rows = new Map<string, ObjectValue>();
				const threads = new Set<string>();
				const scan = async (thread?: string) => {
					let pageToken: string | undefined;
					do {
						// Scan all visible roots: an old root can have a newly created reply.
						const page = await historyPage(
							this.host.client,
							{
								chat,
								...(thread ? { thread } : {}),
								...(state.kind === "dm" ? { start: state.through } : {}),
								end: cutoff,
								...(pageToken ? { pageToken } : {}),
							},
							this.host.lifetime,
						);
						for (const item of page.items) {
							if (item.chat_id !== chat) throw new Error("Feishu history returned a different source");
							if (!thread && string(item.thread_id)) threads.add(string(item.thread_id));
							if (Number(item.create_time) >= state.through && !item.deleted)
								rows.set(required(item.message_id, "History message id"), item);
						}
						pageToken = page.next;
					} while (pageToken);
				};
				await scan();
				for (const thread of threads) await scan(thread);
				await this.host.serialize(async () => {
					const prepared: Prepared[] = [];
					for (const item of [...rows.values()].sort((a, b) => Number(a.create_time) - Number(b.create_time))) {
						const sender = object(item.sender);
						if (sender.sender_type !== "user" || !this.host.allowed(string(sender.id), chat)) continue;
						const data = historyEnvelope(item, chat, state.kind, this.host.tenant());
						const tenant = required(object(data.sender).tenant_key, "History tenant identity");
						if (this.host.tenant() && this.host.tenant() !== tenant) throw new Error("Feishu tenant identity mismatch");
						this.host.setTenant(tenant);
						const id = required(item.message_id, "History message id"),
							key = this.messageKey(tenant, id);
						this.host.interaction.observeMessage(conv(this.host.id, chat), id, Number(item.create_time));
						if (["text", "post"].includes(string(item.msg_type)))
							await this.host.taskCards.observe(
								conv(this.host.id, chat),
								acct(this.host.id, string(sender.id)),
								id,
								Number(item.create_time),
							);
						if (!this.host.seen.has(key))
							prepared.push(await this.host.prepare(data, string(sender.id), chat, id, key));
					}
					for (const batch of recoveryBatches(prepared)) {
						const digest = createHash("sha256")
							.update(JSON.stringify(batch.map((row) => [row.key, object(row.input.data).text])))
							.digest("hex");
						const io = this.host.io();
						if (!io) throw new Error("Feishu instance is not started");
						const event = await io.emit(mergedInput(batch, `recovery:${digest}`));
						for (const row of batch) if (row.original.complete !== false) this.host.seen.set(row.key, event.id);
						await this.host.save();
						count += batch.filter((row) => row.original.complete !== false).length;
					}
					const previous = state.through;
					state.through = cutoff;
					try {
						await this.host.saveHistory();
					} catch (error) {
						state.through = previous;
						throw error;
					}
				});
				covered++;
			} catch (error) {
				failures.push(`${chat}: ${this.host.client.safe(error)}`);
				this.host.fail(error);
			}
		}
		this.host.recoveryState({
			state: failures.length ? "incomplete" : "complete",
			cutoff,
			covered,
			count,
			privateChats: "known-only",
			...(failures.length ? { errors: failures } : {}),
		});
		this.host.api.log.info("Feishu history recovery", {
			instance: this.host.id,
			phase: "history",
			...this.host.recoveryState(),
		});
	}
}
