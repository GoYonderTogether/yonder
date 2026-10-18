import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	acct,
	conv,
	parseRef,
	type Attachment,
	type Channel,
	type ChannelIO,
	type Delivery,
	type OutMessage,
	type OutputPart,
	type PluginAPI,
} from "@yonder/sdk";
import * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuApi } from "./client.js";
import {
	cancellable,
	chunks,
	mimeFromBytes,
	object,
	opusDuration,
	parseContent,
	required,
	string,
	textPayload,
	type Config,
	type ObjectValue,
} from "./protocol.js";

export class FeishuChannel implements Channel {
	readonly kinds = ["dm", "group"];
	readonly output: { stream: boolean; attachments: boolean };
	readonly client: FeishuApi;
	private ws: Lark.WSClient | undefined;
	private io: ChannelIO | undefined;
	private state = "stopped";
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
	}
	status(): object {
		return {
			instance: this.id,
			domain: this.config.domain ?? "feishu",
			state: this.state,
			botIdentityKnown: Boolean(this.botId),
			...(this.error ? { error: this.error } : {}),
			requiredScopes: ["im:message", "im:message:send_as_bot", "im:resource", "cardkit:card:write"],
			transport: "websocket",
			recovery: "official SDK autoReconnect; durable original message ids",
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
		this.state = "connecting";
		try {
			await this.load();
			const credentials = await this.client.credentials();
			const info = await this.client.request("/bot/v3/info", "GET", undefined, this.lifetime.signal);
			const bot = object(info.bot ?? object(info.data).bot);
			this.botId = required(bot.open_id, "Bot open_id");
			const dispatcher = new Lark.EventDispatcher({}).register({
				"im.message.receive_v1": async (data: unknown) => {
					await this.receive(data);
				},
				"card.action.trigger": async (data: unknown) => {
					return await this.callback(data);
				},
			});
			this.ws = new Lark.WSClient({
				...credentials,
				domain: this.config.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
				autoReconnect: true,
				logger: {
					trace: () => {},
					debug: () => {},
					info: () => {},
					warn: () => {},
					error: () =>
						this.fail(new Error("Feishu SDK transport error; inspect app permission and connection configuration")),
				},
				onReady: () => {
					if (!this.stopped) {
						this.state = "connected";
						this.error = undefined;
					}
				},
				onReconnecting: () => {
					if (!this.stopped) this.state = "reconnecting";
				},
				onReconnected: () => {
					if (!this.stopped) {
						this.state = "connected";
						this.error = undefined;
					}
				},
				onError: () => {
					if (!this.stopped) {
						this.state = "connection-error";
						this.fail(new Error("Feishu websocket connection failed"));
					}
				},
			});
			await this.ws.start({ eventDispatcher: dispatcher });
		} catch (error) {
			this.state = "not-ready";
			this.fail(error);
		}
	}
	async stop(): Promise<void> {
		this.stopped = true;
		this.state = "stopped";
		this.lifetime.abort();
		this.ws?.close({ force: true });
		this.ws = undefined;
		await Promise.allSettled(this.pending.values());
		await this.saveTail;
		this.client.clear();
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
		if (!senderId || !chat || !messageId || typeof message.content !== "string")
			return Promise.reject(new Error("Malformed Feishu message identity"));
		if (sender.sender_type !== "user" || senderId === this.botId || !this.allowed(senderId, chat))
			return Promise.resolve();
		const tenant = string(sender.tenant_key);
		if (!tenant) return Promise.reject(new Error("Feishu message has no tenant identity"));
		if (this.tenant && this.tenant !== tenant) return Promise.reject(new Error("Feishu tenant identity mismatch"));
		this.tenant = tenant;
		const key = `${this.config.appId}:${tenant}:message:${messageId}`;
		if (this.seen.has(key)) return Promise.resolve();
		const existing = this.pending.get(key);
		if (existing) return existing;
		const work = this.ingest(data, senderId, chat, messageId, key)
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
	private async ingest(
		data: ObjectValue,
		senderId: string,
		chat: string,
		messageId: string,
		key: string,
	): Promise<void> {
		const message = object(data.message),
			type = required(message.message_type, "message type");
		const parsed = parseContent(type, string(message.content));
		const attachments: Attachment[] = [];
		const failures: string[] = [];
		for (const resource of parsed.resources) {
			try {
				const kind = resource.kind === "image" ? "image" : "file";
				const response = await this.client.raw(
					`/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resource.key)}?type=${kind}`,
					"GET",
					undefined,
					this.lifetime.signal,
				);
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error(`resource HTTP ${response.status}`);
				}
				const bytes = await this.client.bytes(response, this.config.mediaMaxBytes ?? 30000000);
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
				failures.push(`[${resource.kind} unavailable: ${this.client.safe(error)}]`);
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
		const event = await this.io!.emit({
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
			},
		});
		this.seen.set(key, event.id);
		await this.save();
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
	private recipient(target: string): { id: string; type: string } {
		const parsed = parseRef(target);
		if ((parsed.kind !== "acct" && parsed.kind !== "conv") || parsed.channel !== this.id)
			throw new Error("Feishu target belongs to another instance");
		return { id: parsed.id, type: parsed.kind === "conv" ? "chat_id" : "open_id" };
	}
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
		return required(object(result.data).message_id, "Sent message id");
	}
	async send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		let lastId: string | undefined;
		try {
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
				lastId = await this.rawSend(target, payload.type, payload.content, msg.replyTo, signal);
			}
			for (const attachment of msg.attachments ?? []) {
				const payload = await this.upload(attachment, signal);
				lastId = await this.rawSend(target, payload.type, payload.content, msg.replyTo, signal);
			}
			if (!lastId) throw new Error("Feishu message contains no text or attachments");
			return { ok: true, id: lastId };
		} catch (error) {
			this.fail(error);
			return { ok: false, ...(lastId ? { id: lastId } : {}), error: this.client.safe(error) };
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
		replyTo?: string,
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
				return await this.send(target, { text, ...(replyTo ? { replyTo } : {}) }, signal);
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
		try {
			signal?.throwIfAborted();
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
			cardId = required(object(result.data).card_id, "Created CardKit card id");
			messageId = await this.rawSend(
				target,
				"interactive",
				{ type: "card", data: { card_id: cardId } },
				replyTo,
				signal,
			);
			for await (const part of out) {
				signal?.throwIfAborted();
				if (part.type === "text") text += part.delta;
				else if (part.type === "final") text = part.text;
				else if (part.type === "error") throw new Error(part.message);
				if (Buffer.byteLength(text) > 20000) throw new Error("Feishu streaming card exceeds 20000-byte content limit");
				if (Date.now() - lastUpdate >= (this.config.updateIntervalMs ?? 200)) await update();
			}
			signal?.throwIfAborted();
		} catch (error) {
			errors.push(this.client.safe(error));
		} finally {
			if (cardId) {
				// Cleanup has a fresh bounded request signal so caller cancellation cannot strand streaming_mode.
				try {
					await update(true);
				} catch (error) {
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
					errors.push(this.client.safe(error));
				}
			}
		}
		// An already visible card is never replaced by a duplicate final text on update/close failure.
		return errors.length
			? { ok: false, ...(messageId ? { id: messageId } : {}), error: errors.join("; ") }
			: { ok: true, id: messageId };
	}
}
