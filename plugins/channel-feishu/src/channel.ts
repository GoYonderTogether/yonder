import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
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
	type Ref,
	type YEvent,
} from "@yonder/sdk";
import { FeishuApi } from "./client.js";
import { FeishuConnection } from "./connection.js";
import type { HistoryQuery, Prepared } from "./history.js";
import { FeishuRecovery } from "./history-recovery.js";
import { FeishuInteraction } from "./interaction.js";
import {
	type Config,
	editMessage,
	mimeFromBytes,
	type ObjectValue,
	object,
	parseContent,
	required,
	statusDetails,
	string,
} from "./protocol.js";
import { readReceipts } from "./receipts.js";
import { FeishuRegistration } from "./registration.js";
import { FeishuScopes } from "./scopes.js";
import { FeishuSender } from "./send.js";
import { FeishuTaskCards } from "./task-card.js";

export class FeishuChannel implements Channel {
	readonly kinds = ["dm", "group"];
	readonly output: { stream: boolean; attachments: boolean };
	readonly features: NonNullable<Channel["features"]>;
	readonly client: FeishuApi;
	readonly scopes: FeishuScopes;
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
	private readonly registration: FeishuRegistration;
	constructor(
		readonly id: string,
		readonly config: Config,
		private readonly api: PluginAPI,
		readonly fetcher: typeof fetch = fetch,
	) {
		this.directory = join(api.paths.data, id);
		this.client = new FeishuApi(config, api);
		this.registration = new FeishuRegistration({
			...{ id, api, fetcher, client: this.client, directory: this.directory },
			signal: this.lifetime.signal,
			restart: () => this.connection.restart(),
		});
		this.scopes = new FeishuScopes(this.client, this.directory);
		this.output = { stream: config.streaming !== false, attachments: true };
		this.features = {
			identity: "account",
			quote: "id",
			edit: true,
			streamMode: this.output.stream ? "message" : "none",
			history: "cursor",
		};
		this.connection = new FeishuConnection(id, this.client, api, () => this.ready());
		this.interaction = new FeishuInteraction(id, this.client, api);
		this.taskCards = new FeishuTaskCards(id, this.client, api, (target, card, signal) =>
			this.rawSend(target, "interactive", card, undefined, signal),
		);
		this.sender = new FeishuSender({
			id,
			config,
			client: this.client,
			interaction: this.interaction,
			lifetime: this.lifetime.signal,
			stopped: () => this.stopped,
			fail: (error) => this.fail(error),
			rawSend: (target, type, content, replyTo, signal, uuid) =>
				this.rawSend(target, type, content, replyTo, signal, uuid),
		});
		this.recovery = new FeishuRecovery({
			id,
			appId: config.appId,
			api,
			client: this.client,
			directory: this.directory,
			lifetime: this.lifetime.signal,
			interaction: this.interaction,
			taskCards: this.taskCards,
			baseline: () => this.baseline,
			setBaseline: (value) => {
				this.baseline = value;
			},
			tenant: () => this.tenant,
			setTenant: (value) => {
				this.tenant = value;
			},
			conversations: this.conversations,
			seen: this.seen,
			recoveryState: (value) => {
				if (value) this.recoveryState = value;
				return this.recoveryState;
			},
			stopped: () => this.stopped,
			io: () => this.io,
			serialize: (work) => this.serialize(work),
			allowed: (sender, chat) => this.allowed(sender, chat),
			chatExcluded: (chat) => this.chatExcluded(chat),
			fail: (error) => this.fail(error),
			save: () => this.save(),
			saveHistory: () => this.saveHistory(),
			prepare: (data, senderId, chat, messageId, key, signal) =>
				this.prepare(data, senderId, chat, messageId, key, signal),
		});
	}
	readonly login = (action: "start" | "poll", signal: AbortSignal) => this.registration.login(action, signal);
	status(): object {
		return {
			instance: this.id,
			configured: this.client.configured,
			domain: this.config.domain ?? "feishu",
			...this.connection.status(),
			botIdentityKnown: Boolean(this.botId),
			...(this.error ? { error: this.error } : {}),
			...statusDetails(this.config),
			recovery: this.recoveryState,
		};
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
		for (const [key, value] of await readReceipts(this.directory)) this.seen.set(key, value);
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
		this.registration.stop();
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
	private readonly recovery: FeishuRecovery;
	private readonly sender: FeishuSender;
	private loadHistory(): Promise<void> {
		return this.recovery.loadHistory();
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
		return this.recovery.history(query, signal);
	}
	async describeConversation(target: Ref, signal?: AbortSignal) {
		return this.client.describeConversation(this.id, target, signal);
	}
	private catchup(): Promise<void> {
		return this.recovery.catchup();
	}
	private chatExcluded(chat: string): boolean {
		const allowed = this.config.allowedChats;
		return allowed !== undefined && !allowed.includes(chat);
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
		const botMentioned = Boolean(this.botId) && [...mentions, ...parsed.mentions].includes(this.botId);
		const everyoneMentioned = [...mentions, ...parsed.mentions].includes("all");
		const mentioned = botMentioned || everyoneMentioned;
		const input: EventInput = {
			type: "message.in",
			from: acct(this.id, senderId),
			conv: conv(this.id, chat),
			data: {
				kind: message.chat_type === "p2p" ? "dm" : "group",
				text: [parsed.text, ...failures].join("\n"),
				mentioned,
				social: { mentions: { ...(this.botId ? { bot: botMentioned } : {}), everyone: everyoneMentioned } },
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
	async rawSend(target: string, type: string, content: object, replyTo?: string, signal?: AbortSignal, uuid?: string) {
		if (this.stopped) throw new Error("Feishu instance is stopped");
		signal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
		return this.sender.rawSendRequest(target, type, content, replyTo, signal, uuid);
	}
	send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		return this.sender.send(target, msg, signal);
	}
	async edit(_target: string, id: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		try {
			await editMessage(this.client, this.config.renderMode ?? "markdown", id, msg, signal);
			return { ok: true, id };
		} catch (error) {
			return { ok: false, uncertain: true, error: this.client.safe(error) };
		}
	}
	stream(
		target: string,
		out: AsyncIterable<OutputPart>,
		sourceMessageId?: string,
		signal?: AbortSignal,
	): Promise<Delivery> {
		return this.sender.stream(target, out, sourceMessageId, signal);
	}
}
