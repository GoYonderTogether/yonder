import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
	type Attachment,
	acct,
	type Channel,
	type ChannelIO,
	conv,
	type Delivery,
	type EventInput,
	type OutMessage,
	type OutputPart,
	type PluginAPI,
	parseRef,
	type YEvent,
} from "@yonder/sdk";
import { FeishuApi, FeishuRequestError, uncertain } from "./client.js";
import { FeishuConnection } from "./connection.js";
import {
	type HistoryQuery,
	historyEnvelope,
	historyPage,
	mergedInput,
	type Prepared,
	recoveryBatches,
} from "./history.js";
import { FeishuInteraction } from "./interaction.js";
import {
	type Config,
	cancellable,
	chunks,
	editMessage,
	mimeFromBytes,
	type ObjectValue,
	object,
	opusDuration,
	parseContent,
	recipient as recipientOf,
	required,
	string,
	textPayload,
} from "./protocol.js";
import { FeishuTaskCards } from "./task-card.js";

export class FeishuChannel implements Channel {
	readonly kinds = ["dm", "group"];
	readonly output: { stream: boolean; attachments: boolean };
	readonly client: FeishuApi;
	private readonly connection: FeishuConnection;
	private readonly interaction: FeishuInteraction;
	readonly taskCards: FeishuTaskCards;
	private baseline = Date.now();
	private readonly conversations = new Map<string, { kind: "dm" | "group"; through: number }>();
	private recoveryState: object = { state: "not-started", privateChats: "known-only" };
	private recoveryWork: Promise<void> | undefined;
	private inputTail: Promise<void> = Promise.resolve();
	private io: ChannelIO | undefined;
	private error: string | undefined;
	private botId = "";
	private tenant = "";
	private stopped = true;
	private readonly seen = new Map<string, string>();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly directory: string;
	private saveTail: Promise<void> = Promise.resolve();
	private readonly lifetime = new AbortController();
	constructor(
		readonly id: string,
		readonly config: Config,
		private readonly api: PluginAPI,
	) {
		this.directory = join(api.paths.data, id);
		this.client = new FeishuApi(config, api);
		this.output = { stream: config.streaming !== false, attachments: true };
		this.connection = new FeishuConnection(id, this.client, api, () => this.ready());
		this.interaction = new FeishuInteraction(id, this.client, api);
		this.taskCards = new FeishuTaskCards(id, this.client, api, (target, card, signal) =>
			this.rawSend(target, "interactive", card, undefined, signal),
		);
	}
	status(): object {
		return {
			instance: this.id,
			domain: this.config.domain ?? "feishu",
			...this.connection.status(),
			botIdentityKnown: Boolean(this.botId),
			...(this.error ? { error: this.error } : {}),
			requiredScopes: ["im:message", "im:message:send_as_bot", "im:resource", "cardkit:card:write"],
			transport: "websocket",
			renderMode: this.config.renderMode ?? "markdown",
			recovery: this.recoveryState,
		};
	}
	private async load(): Promise<void> {
		try {
			const rows: unknown = JSON.parse(await readFile(join(this.directory, "receipts.json"), "utf8"));
			if (!Array.isArray(rows)) throw new Error("Invalid Feishu receipt file");
			for (const row of rows) {
				if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || typeof row[1] !== "string")
					throw new Error("Invalid Feishu receipt");
				this.seen.set(row[0], row[1]);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	private save(): Promise<void> {
		// Persist protocol receipts, never transcripts or a second run queue.
		const work = this.saveTail
			.catch(() => {})
			.then(async () => {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const temporary = join(this.directory, `receipts-${randomUUID()}.tmp`);
				await writeFile(temporary, JSON.stringify([...this.seen]), { mode: 0o600 });
				await rename(temporary, join(this.directory, "receipts.json"));
			});
		this.saveTail = work;
		return work;
	}
	private fail(error: unknown): void {
		this.error = this.client.safe(error);
		this.api.log.warn("Feishu operation unavailable", { instance: this.id, error: this.error });
	}
	async start(io: ChannelIO): Promise<void> {
		this.io = io;
		this.stopped = false;
		await this.load();
		await this.loadHistory();
		await this.taskCards.start();
		const dispatcher = new Lark.EventDispatcher({ logger: this.connection.logger }).register({
			"im.message.receive_v1": async (data: unknown) => {
				await this.receive(data);
			},
			"card.action.trigger": async (data: unknown) => await this.callback(data),
		});
		await Promise.all([this.interaction.start(), this.connection.start(dispatcher)]);
	}
	private async ready(): Promise<void> {
		if (this.stopped) return;
		if (!this.recoveryWork) {
			// Establish the gate before any identity request can yield to live SDK callbacks.
			this.recoveryWork = Promise.resolve()
				.then(async () => {
					try {
						const info = await this.client.request("/bot/v3/info", "GET", undefined, this.lifetime.signal);
						const bot = object(info.bot ?? object(info.data).bot);
						this.botId = required(bot.open_id, "Bot open_id");
					} catch (error) {
						this.fail(error);
					}
					await this.catchup();
				})
				.finally(() => {
					this.recoveryWork = undefined;
				});
		}
		await this.recoveryWork;
	}
	async stop(): Promise<void> {
		this.stopped = true;

		this.lifetime.abort();
		this.connection.stop();
		await Promise.allSettled([this.recoveryWork, this.inputTail]);
		await Promise.allSettled(this.pending.values());
		await this.saveTail;
		await this.interaction.stop();
		await this.taskCards.stop();
		this.client.clear();
	}
	onInput(event: YEvent): Promise<void> {
		return this.interaction.onInput(event);
	}
	onEnd(event: YEvent): Promise<void> {
		return this.interaction.onEnd(event);
	}
	private serialize = (work: () => Promise<void>) => (this.inputTail = this.inputTail.catch(() => {}).then(work));
	private messageKey = (tenant: string, id: string) => `${this.config.appId}:${tenant}:message:${id}`;
	private async loadHistory(): Promise<void> {
		let initializeFromLedger = false;
		try {
			const saved = object(JSON.parse(await readFile(join(this.directory, "history.json"), "utf8")));
			if (typeof saved.baseline !== "number" || !Array.isArray(saved.conversations))
				throw new Error("Invalid Feishu history watermarks");
			this.baseline = saved.baseline;
			for (const entry of saved.conversations) {
				const row = object(entry);
				if (
					typeof row.chat !== "string" ||
					!["dm", "group"].includes(string(row.kind)) ||
					typeof row.through !== "number"
				)
					throw new Error("Invalid Feishu conversation watermark");
				this.conversations.set(row.chat, { kind: row.kind as "dm" | "group", through: row.through });
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			initializeFromLedger = true;
		}
		// The event ledger, not the receipt file, is the durable acceptance fact.
		let after: string | undefined;
		do {
			const page = await this.api.events.query({ type: "message.in", ...(after ? { after } : {}), limit: 500 });
			for (const event of page.events) {
				if (!event.conv?.startsWith(`conv:${this.id}:`)) continue;
				const data = object(event.data),
					tenant = string(data.tenant);
				if (tenant) this.tenant = tenant;
				const originals = Array.isArray(data.originals) ? data.originals.map(object) : [data];
				const acceptedTimes: number[] = [];
				for (const original of originals) {
					const id = string(original.messageId) || string(original.msgId);
					if (id && original.complete !== false)
						this.seen.set(this.messageKey(string(original.tenant) || tenant, id), event.id);
					if (original.complete !== false) {
						const time =
							original.createdAt === undefined || original.createdAt === ""
								? Date.parse(event.ts)
								: Number(original.createdAt);
						if (Number.isFinite(time)) acceptedTimes.push(time);
					}
				}
				const chat = parseRef(event.conv).id;
				const existing = this.conversations.get(chat);
				if (initializeFromLedger && acceptedTimes.length) {
					const through = Math.max(...acceptedTimes);
					this.conversations.set(chat, {
						kind: data.kind === "dm" ? "dm" : "group",
						through: existing ? Math.max(existing.through, through) : through,
					});
				} else if (!existing && !initializeFromLedger) {
					this.conversations.set(chat, { kind: data.kind === "dm" ? "dm" : "group", through: this.baseline });
				}
			}
			after = page.next;
		} while (after);
		await this.saveHistory();
	}
	private saveHistory(): Promise<void> {
		const work = this.saveTail
			.catch(() => {})
			.then(async () => {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const temporary = join(this.directory, `history-${randomUUID()}.tmp`);
				await writeFile(
					temporary,
					JSON.stringify({
						baseline: this.baseline,
						conversations: [...this.conversations].map(([chat, value]) => ({ chat, ...value })),
					}),
					{ mode: 0o600 },
				);
				await rename(temporary, join(this.directory, "history.json"));
			});
		this.saveTail = work;
		return work;
	}

	async history(query: HistoryQuery, signal: AbortSignal): Promise<{ items: object[]; next?: string }> {
		const page = await historyPage(this.client, query, AbortSignal.any([signal, this.lifetime.signal]));
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
				this.conversations.get(query.chat)?.kind ?? "group",
				this.tenant,
			);
			const sender = object(envelope.sender),
				message = object(envelope.message);
			const prepared = await this.prepare(
				envelope,
				string(object(sender.sender_id).open_id),
				query.chat,
				string(message.message_id),
				"query",
				AbortSignal.any([signal, this.lifetime.signal]),
			);
			items.push(prepared.original);
		}
		return { items, ...(page.next ? { next: page.next } : {}) };
	}
	private async catchup(): Promise<void> {
		const cutoff = Date.now();
		this.recoveryState = { state: "running", cutoff, privateChats: "known-only" };
		let count = 0,
			covered = 0;
		const failures: string[] = [];
		try {
			let token: string | undefined;
			do {
				const params = new URLSearchParams({ page_size: "100", ...(token ? { page_token: token } : {}) });
				const data = object(
					(await this.client.request(`/im/v1/chats?${params}`, "GET", undefined, this.lifetime.signal)).data,
				);
				if (!Array.isArray(data.items)) throw new Error("Feishu chat list omitted items");
				for (const row of data.items) {
					const chat = required(object(row).chat_id, "History chat id");
					if (!this.conversations.has(chat)) this.conversations.set(chat, { kind: "group", through: this.baseline });
				}
				token = data.has_more ? required(data.page_token, "Chat next page token") : undefined;
			} while (token);
		} catch (error) {
			failures.push(this.client.safe(error));
		}
		await this.saveHistory();
		for (const [chat, state] of this.conversations) {
			if (this.stopped) break;
			if (this.config.allowedChats && !this.config.allowedChats.includes(chat)) continue;
			try {
				const rows = new Map<string, ObjectValue>();
				const threads = new Set<string>();
				const scan = async (thread?: string) => {
					let pageToken: string | undefined;
					do {
						// Scan all visible roots: an old root can have a newly created reply.
						const page = await historyPage(
							this.client,
							{
								chat,
								...(thread ? { thread } : {}),
								...(state.kind === "dm" ? { start: state.through } : {}),
								end: cutoff,
								...(pageToken ? { pageToken } : {}),
							},
							this.lifetime.signal,
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
				await this.serialize(async () => {
					const prepared: Prepared[] = [];
					for (const item of [...rows.values()].sort((a, b) => Number(a.create_time) - Number(b.create_time))) {
						const sender = object(item.sender);
						if (sender.sender_type !== "user" || !this.allowed(string(sender.id), chat)) continue;
						const data = historyEnvelope(item, chat, state.kind, this.tenant);
						const tenant = required(object(data.sender).tenant_key, "History tenant identity");
						if (this.tenant && this.tenant !== tenant) throw new Error("Feishu tenant identity mismatch");
						this.tenant = tenant;
						const id = required(item.message_id, "History message id"),
							key = this.messageKey(tenant, id);
						this.interaction.observeMessage(conv(this.id, chat), id, Number(item.create_time));
						if (["text", "post"].includes(string(item.msg_type)))
							await this.taskCards.observe(
								conv(this.id, chat),
								acct(this.id, string(sender.id)),
								id,
								Number(item.create_time),
							);
						if (!this.seen.has(key)) prepared.push(await this.prepare(data, string(sender.id), chat, id, key));
					}
					for (const batch of recoveryBatches(prepared)) {
						const digest = createHash("sha256")
							.update(JSON.stringify(batch.map((row) => [row.key, object(row.input.data).text])))
							.digest("hex");
						if (!this.io) throw new Error("Feishu instance is not started");
						const event = await this.io.emit(mergedInput(batch, `recovery:${digest}`));
						for (const row of batch) if (row.original.complete !== false) this.seen.set(row.key, event.id);
						await this.save();
						count += batch.filter((row) => row.original.complete !== false).length;
					}
					const previous = state.through;
					state.through = cutoff;
					try {
						await this.saveHistory();
					} catch (error) {
						state.through = previous;
						throw error;
					}
				});
				covered++;
			} catch (error) {
				failures.push(`${chat}: ${this.client.safe(error)}`);
				this.fail(error);
			}
		}
		this.recoveryState = {
			state: failures.length ? "incomplete" : "complete",
			cutoff,
			covered,
			count,
			privateChats: "known-only",
			...(failures.length ? { errors: failures } : {}),
		};
		this.api.log.info("Feishu history recovery", { instance: this.id, phase: "history", ...this.recoveryState });
	}
	private allowed(sender: string, chat: string): boolean {
		return (
			(!this.config.allowedUsers || this.config.allowedUsers.includes(sender)) &&
			(!this.config.allowedChats || this.config.allowedChats.includes(chat))
		);
	}
	private receive(raw: unknown): Promise<void> {
		if (this.stopped) return Promise.resolve();
		const data = object(raw),
			message = object(data.message),
			sender = object(data.sender);
		const senderId = string(object(sender.sender_id).open_id),
			chat = string(message.chat_id),
			messageId = string(message.message_id);
		if (
			!senderId ||
			!chat ||
			!messageId ||
			typeof message.content !== "string" ||
			!["p2p", "group"].includes(string(message.chat_type))
		)
			return Promise.reject(new Error("Malformed Feishu message identity"));
		if (sender.sender_type !== "user" || senderId === this.botId || !this.allowed(senderId, chat))
			return Promise.resolve();
		const tenant = string(sender.tenant_key);
		if (!tenant) return Promise.reject(new Error("Feishu message has no tenant identity"));
		if (this.tenant && this.tenant !== tenant) return Promise.reject(new Error("Feishu tenant identity mismatch"));
		this.tenant = tenant;
		this.interaction.observeMessage(conv(this.id, chat), messageId, Number(message.create_time) || Date.now());
		if (["text", "post"].includes(string(message.message_type)))
			void this.taskCards
				.observe(conv(this.id, chat), acct(this.id, senderId), messageId, Number(message.create_time))
				.catch((error: unknown) => this.fail(error));
		const key = `${this.config.appId}:${tenant}:message:${messageId}`;
		if (this.seen.has(key)) return Promise.resolve();
		const existing = this.pending.get(key);
		if (existing) return existing;
		this.conversations.set(
			chat,
			this.conversations.get(chat) ?? { kind: message.chat_type === "p2p" ? "dm" : "group", through: this.baseline },
		);
		const recovery = this.recoveryWork;
		const work = Promise.resolve(recovery)
			.then(() =>
				this.serialize(async () => {
					if (this.stopped) return;
					if (this.seen.has(key)) return;
					await this.saveHistory();
					const prepared = await this.prepare(data, senderId, chat, messageId, key);
					if (!this.io) throw new Error("Feishu instance is not started");
					const event = await this.io.emit(prepared.input);
					this.seen.set(key, event.id);
					await this.save();
				}),
			)
			.catch((error) => {
				this.fail(error);
				throw error;
			})
			.finally(() => {
				this.pending.delete(key);
			});
		this.pending.set(key, work);
		return work;
	}
	private async prepare(
		data: ObjectValue,
		senderId: string,
		chat: string,
		messageId: string,
		key: string,
		signal = this.lifetime.signal,
	): Promise<Prepared> {
		const message = object(data.message),
			type = required(message.message_type, "message type");
		const parsed = parseContent(type, string(message.content));
		const attachments: Attachment[] = [];
		const failures: string[] = [];
		for (const resource of parsed.resources) {
			try {
				const kind = resource.kind === "image" ? "image" : "file";
				let response!: Response;
				let bytes!: Buffer;
				// A dropped connection is common on a moving laptop: retry before telling the agent the resource is lost.
				for (let attempt = 1; ; attempt++) {
					try {
						response = await this.client.raw(
							`/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resource.key)}?type=${kind}`,
							"GET",
							undefined,
							signal,
						);
						if (!response.ok) {
							await response.body?.cancel();
							throw new Error(`resource HTTP ${response.status}`);
						}
						bytes = await this.client.bytes(response, this.config.mediaMaxBytes ?? 30000000);
						break;
					} catch (error) {
						const retryable = !/resource HTTP 4\d\d/.test(error instanceof Error ? error.message : "");
						if (!retryable || attempt >= 3 || signal.aborted) throw error;
						await new Promise((resolve) => setTimeout(resolve, 1000 * 3 ** (attempt - 1)));
					}
				}
				const mime = mimeFromBytes(bytes, response.headers.get("content-type") ?? "application/octet-stream");
				const disposition = response.headers.get("content-disposition") ?? "";
				const rawName = resource.name || /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(disposition)?.[1];
				let name = rawName ? basename(rawName) : `${resource.kind}-${resource.key}`;
				try {
					name = basename(decodeURIComponent(name));
				} catch {}
				const media = join(this.directory, "media");
				await mkdir(media, { recursive: true, mode: 0o700 });
				const path = join(media, `${randomUUID()}-${name.replace(/[^\p{L}\p{N}._-]/gu, "_")}`);
				await writeFile(path, bytes, { mode: 0o600 });
				attachments.push({ kind: resource.kind, mime, uri: pathToFileURL(path).href, name, bytes: bytes.length });
			} catch (error) {
				this.api.log.warn("Feishu resource download failed", {
					instance: this.id,
					kind: resource.kind,
					error: this.client.safe(error),
				});
				failures.push(`[${resource.kind === "image" ? "图片" : "文件"}没能下载，可以请对方重发]`);
			}
		}
		const mentions = Array.isArray(message.mentions)
			? message.mentions.map((value) => string(object(object(value).id).open_id))
			: [];
		const mentioned =
			mentions.includes(this.botId) ||
			mentions.includes("all") ||
			parsed.mentions.includes(this.botId) ||
			parsed.mentions.includes("all");
		const input: EventInput = {
			type: "message.in",
			from: acct(this.id, senderId),
			conv: conv(this.id, chat),
			data: {
				kind: message.chat_type === "p2p" ? "dm" : "group",
				text: [parsed.text, ...failures].join("\n"),
				mentioned,
				msgId: messageId,
				...(attachments.length ? { attachments } : {}),
				...(string(message.parent_id) ? { replyTo: string(message.parent_id) } : {}),
				threadId: string(message.thread_id),
				rootId: string(message.root_id),
				tenant: string(object(data.sender).tenant_key),
				mentions: [...mentions, ...parsed.mentions],
				sourceType: type,
				createdAt: string(message.create_time),
			},
		};
		return {
			key,
			input,
			original: { ...input.data, sender: senderId, messageId, createdAt: string(message.create_time) },
		};
	}
	private async callback(raw: unknown): Promise<object> {
		if (this.stopped) throw new Error("Feishu instance is stopped");
		const data = object(raw),
			operator = object(data.operator),
			context = object(data.context),
			action = object(data.action);
		const sender = required(operator.open_id ?? object(operator.user_id).open_id, "Card operator");
		const messageId = required(context.open_message_id, "Original card message");
		const chat = required(context.open_chat_id ?? context.chat_id, "Original card chat");
		if (!this.allowed(sender, chat))
			return { toast: { type: "error", content: "This operator or conversation is not allowed" } };
		if (!string(data.token) || !string(action.tag)) throw new Error("Malformed Feishu card callback");
		// This handler is only registered on the authenticated, app-owned SDK WebSocket. No public webhook.
		if (Object.hasOwn(object(action.value), "yonder_task_card"))
			return this.taskCards.callback(acct(this.id, sender), conv(this.id, chat), messageId, object(action.value));
		const key = `${this.config.appId}:card:${createHash("sha256").update(required(data.token, "Callback token")).digest("hex")}`;
		const existing = this.pending.get(key);
		if (existing) await existing;
		if (!this.seen.has(key)) {
			const work = (async () => {
				const event = await this.api.events.emit({
					type: "channel-feishu.card-action",
					from: acct(this.id, sender),
					conv: conv(this.id, chat),
					data: {
						msgId: key,
						instance: this.id,
						messageId,
						operator: acct(this.id, sender),
						action: { tag: action.tag, value: action.value, formValue: action.form_value },
						source: "feishu-websocket",
					},
				});
				this.seen.set(key, event.id);
				await this.save();
			})();
			this.pending.set(key, work);
			try {
				await work;
			} finally {
				this.pending.delete(key);
			}
		}
		return { toast: { type: "success", content: "Action received" } };
	}
	private recipient = (target: string) => recipientOf(target, this.id);
	async rawSend(
		target: string,
		type: string,
		content: object,
		replyTo?: string,
		signal?: AbortSignal,
	): Promise<string> {
		if (this.stopped) throw new Error("Feishu instance is stopped");
		signal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
		const recipient = this.recipient(target);
		const path = replyTo
			? `/im/v1/messages/${encodeURIComponent(replyTo)}/reply`
			: `/im/v1/messages?receive_id_type=${recipient.type}`;
		const result = await this.client.request(
			path,
			"POST",
			{
				msg_type: type,
				content: JSON.stringify(content),
				uuid: randomUUID(),
				...(replyTo ? { reply_in_thread: this.config.replyInThread ?? false } : { receive_id: recipient.id }),
			},
			signal,
		);
		const id = string(object(result.data).message_id);
		if (!id) throw new FeishuRequestError("Feishu send omitted message id", true);
		return id;
	}
	async send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		let lastId: string | undefined;
		try {
			const replyTo =
				msg.sourceMessageId || msg.replyTo
					? await this.interaction.beforeReply(target, msg.sourceMessageId, msg.replyTo)
					: undefined;
			const mode = this.config.renderMode ?? "markdown";
			const payloadFor = (text: string) =>
				mode === "card" && this.config.templateId
					? {
							type: "interactive",
							content: {
								type: "template",
								data: {
									template_id: this.config.templateId,
									...(this.config.templateVersion ? { template_version_name: this.config.templateVersion } : {}),
									template_variable: { content: text },
								},
							},
						}
					: textPayload(text, mode);
			const encode = (text: string) => payloadFor(text).content;
			for (const part of chunks(msg.text, this.config.textChunkBytes ?? 18000, encode)) {
				const payload = payloadFor(part);
				lastId = await this.rawSend(target, payload.type, payload.content, replyTo, signal);
			}
			for (const attachment of msg.attachments ?? []) {
				const payload = await this.upload(attachment, signal);
				lastId = await this.rawSend(target, payload.type, payload.content, replyTo, signal);
			}
			if (!lastId) throw new Error("Feishu message contains no text or attachments");
			return { ok: true, id: lastId };
		} catch (error) {
			this.fail(error);
			return {
				ok: false,
				...(lastId ? { id: lastId } : {}),
				...(lastId || uncertain(error) ? { uncertain: true } : {}),
				...(!lastId && error instanceof FeishuRequestError && error.retryable ? { retryable: true } : {}),
				error: this.client.safe(error),
			};
		}
	}
	async edit(_target: string, id: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		try {
			await editMessage(this.client, this.config.renderMode ?? "markdown", id, msg, signal);
			return { ok: true, id };
		} catch (error) {
			return { ok: false, uncertain: true, error: this.client.safe(error) };
		}
	}
	private async upload(attachment: Attachment, signal?: AbortSignal): Promise<{ type: string; content: object }> {
		signal?.throwIfAborted();
		// Channel output consumes local artifacts only. No remote URL fetch or credential-bearing redirects.
		const uri = new URL(attachment.uri);
		if (uri.protocol !== "file:") throw new Error("Feishu upload needs a local file: artifact URI");
		const path = fileURLToPath(uri);
		const limit = Math.min(this.config.mediaMaxBytes ?? 30000000, attachment.kind === "image" ? 10000000 : 30000000);
		const handle = await open(path, "r");
		let bytes: Buffer;
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size === 0 || stat.size > limit)
				throw new Error(`Feishu artifact must be a regular file of 1..${limit} bytes`);
			const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
			let offset = 0;
			while (offset < buffer.length) {
				signal?.throwIfAborted();
				const read = await handle.read(buffer, offset, buffer.length - offset, null);
				if (!read.bytesRead) break;
				offset += read.bytesRead;
			}
			if (offset > stat.size) throw new Error("Feishu artifact changed while reading");
			bytes = buffer.subarray(0, offset);
		} finally {
			await handle.close();
		}
		signal?.throwIfAborted();
		if (bytes.length === 0 || bytes.length > limit) throw new Error(`Feishu attachment must be 1..${limit} bytes`);
		const mime = mimeFromBytes(bytes, attachment.mime);
		const name = basename(attachment.name ?? path);
		const form = new FormData();
		if (attachment.kind === "image") {
			if (!mime.startsWith("image/")) throw new Error("Feishu image artifact is not an image");
			form.set("image_type", "message");
			form.set("image", new Blob([new Uint8Array(bytes)], { type: mime }), name);
			const result = await this.client.request("/im/v1/images", "POST", form, signal);
			return { type: "image", content: { image_key: required(object(result.data).image_key, "Uploaded image key") } };
		}
		let fileType = "stream",
			messageType = "file";
		if (attachment.kind === "audio") {
			if (mime !== "audio/ogg" || !bytes.includes(Buffer.from("OpusHead")))
				throw new Error("Feishu playable audio requires Ogg/Opus; supply a converted artifact");
			fileType = "opus";
			messageType = "audio";
			const duration = opusDuration(bytes);
			if (duration) form.set("duration", String(duration));
		} else if (attachment.kind === "video") {
			if (mime !== "video/mp4") throw new Error("Feishu playable video requires an MP4 artifact");
			fileType = "mp4";
			messageType = "media";
		} else {
			const extension = name.split(".").pop()?.toLowerCase();
			if (extension && ["pdf", "doc", "xls", "ppt"].includes(extension)) fileType = extension;
		}
		form.set("file_type", fileType);
		form.set("file_name", name);
		form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
		const result = await this.client.request("/im/v1/files", "POST", form, signal);
		return { type: messageType, content: { file_key: required(object(result.data).file_key, "Uploaded file key") } };
	}
	async stream(
		target: string,
		out: AsyncIterable<OutputPart>,
		sourceMessageId?: string,
		signal?: AbortSignal,
	): Promise<Delivery> {
		signal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
		out = cancellable(out, signal);
		if (this.config.streaming === false) {
			let text = "";
			try {
				for await (const part of out) {
					signal?.throwIfAborted();
					if (part.type === "text") text += part.delta;
					else if (part.type === "final") text = part.text;
					else if (part.type === "error") throw new Error(part.message);
				}
				return await this.send(target, { text, ...(sourceMessageId ? { sourceMessageId } : {}) }, signal);
			} catch (error) {
				return { ok: false, error: this.client.safe(error) };
			}
		}
		let cardId = "",
			messageId = "",
			text = "",
			accepted = "",
			sequence = 0,
			lastUpdate = 0;
		const errors: string[] = [];
		let outcomeUncertain = false,
			retryable = false;
		const update = async (cleanup = false) => {
			if (text === accepted) return;
			await this.client.request(
				`/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/content/content`,
				"PUT",
				{ content: text, sequence: ++sequence, uuid: randomUUID() },
				cleanup ? undefined : signal,
			);
			accepted = text;
			lastUpdate = Date.now();
		};
		const open = async () => {
			const replyTo = await this.interaction.beforeReply(target, sourceMessageId);
			const card = {
				schema: "2.0",
				config: { streaming_mode: true, summary: { content: "Generating…" } },
				body: { elements: [{ tag: "markdown", element_id: "content", content: "" }] },
			};
			const result = await this.client.request(
				"/cardkit/v1/cards",
				"POST",
				{ type: "card_json", data: JSON.stringify(card) },
				signal,
			);
			cardId = string(object(result.data).card_id);
			if (!cardId) throw new FeishuRequestError("Feishu CardKit creation omitted card id", true);
			messageId = await this.rawSend(
				target,
				"interactive",
				{ type: "card", data: { card_id: cardId } },
				replyTo,
				signal,
			);
		};
		try {
			for await (const part of out) {
				signal?.throwIfAborted();
				if (part.type === "text") text += part.delta;
				else if (part.type === "final") text = part.text;
				else if (part.type === "error") throw new Error(part.message);
				if (!cardId) {
					if (!text) continue;
					await open();
				}
				if (Buffer.byteLength(text) > 20000) throw new Error("Feishu streaming card exceeds 20000-byte content limit");
				if (Date.now() - lastUpdate >= (this.config.updateIntervalMs ?? 200)) await update();
				// A completed message closes immediately, even if its producer is still doing other work.
				if (part.type === "final") break;
			}
			signal?.throwIfAborted();
		} catch (error) {
			retryable = !messageId && error instanceof FeishuRequestError && error.retryable;
			outcomeUncertain ||= uncertain(error);
			errors.push(this.client.safe(error));
		} finally {
			if (cardId) {
				// Cleanup has a fresh bounded request signal so caller cancellation cannot strand streaming_mode.
				try {
					await update(true);
				} catch (error) {
					outcomeUncertain ||= uncertain(error);
					errors.push(this.client.safe(error));
				}
				try {
					await this.client.request(`/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`, "PATCH", {
						settings: JSON.stringify({
							config: {
								streaming_mode: false,
								summary: { content: Array.from(accepted.replace(/\n/g, " ")).slice(0, 50).join("") || "Ended" },
							},
						}),
						sequence: ++sequence,
						uuid: randomUUID(),
					});
				} catch (error) {
					outcomeUncertain ||= uncertain(error);
					errors.push(this.client.safe(error));
				}
			}
		}
		// An already visible card is never replaced by a duplicate final text on update/close failure.
		return errors.length
			? {
					ok: false,
					...(messageId ? { id: messageId } : {}),
					...(outcomeUncertain ? { uncertain: true } : {}),
					...(retryable && !messageId && !outcomeUncertain ? { retryable: true } : {}),
					error: errors.join("; "),
				}
			: { ok: true, id: messageId };
	}
}
