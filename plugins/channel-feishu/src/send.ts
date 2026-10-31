import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, Delivery, OutMessage, OutputPart } from "@yonder/sdk";
import { type FeishuApi, FeishuRequestError, uncertain } from "./client.js";
import type { FeishuInteraction } from "./interaction.js";
import {
	type Config,
	cancellable,
	chunks,
	deliveryUuid,
	mimeFromBytes,
	object,
	opusDuration,
	recipient as recipientOf,
	required,
	string,
	textPayload,
} from "./protocol.js";

/** The instance state the send client needs; channel.ts owns the lifecycle. */
export interface SendHost {
	readonly id: string;
	readonly config: Config;
	readonly client: FeishuApi;
	readonly interaction: FeishuInteraction;
	readonly lifetime: AbortSignal;
	stopped(): boolean;
	fail(error: unknown): void;
	/** The channel's rawSend: keeps its stopped check, signal merge and test seams in one place. */
	rawSend(
		target: string,
		type: string,
		content: object,
		replyTo?: string,
		signal?: AbortSignal,
		uuid?: string,
	): Promise<string>;
}

/** Outbound message path: chunked text, attachments and the streaming CardKit card. */
export class FeishuSender {
	constructor(private readonly host: SendHost) {}
	async rawSendRequest(
		target: string,
		type: string,
		content: object,
		replyTo?: string,
		signal?: AbortSignal,
		uuid?: string,
	) {
		const recipient = recipientOf(target, this.host.id);
		const path = replyTo
			? `/im/v1/messages/${encodeURIComponent(replyTo)}/reply`
			: `/im/v1/messages?receive_id_type=${recipient.type}`;
		const result = await this.host.client.request(
			path,
			"POST",
			{
				msg_type: type,
				content: JSON.stringify(content),
				uuid: uuid ?? randomUUID(),
				...(replyTo ? { reply_in_thread: this.host.config.replyInThread ?? false } : { receive_id: recipient.id }),
			},
			signal,
		);
		const id = string(object(result.data).message_id);
		if (!id) throw new FeishuRequestError("Feishu send omitted message id", true);
		return id;
	}
	async send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		let lastId: string | undefined;
		let partIndex = 0;
		const nextUuid = () => deliveryUuid(msg.deliveryId, partIndex++);
		try {
			const replyTo =
				msg.sourceMessageId || msg.replyTo
					? await this.host.interaction.beforeReply(target, msg.sourceMessageId, msg.replyTo)
					: undefined;
			const mode = this.host.config.renderMode ?? "markdown";
			const payloadFor = (text: string) =>
				mode === "card" && this.host.config.templateId
					? {
							type: "interactive",
							content: {
								type: "template",
								data: {
									template_id: this.host.config.templateId,
									...(this.host.config.templateVersion
										? { template_version_name: this.host.config.templateVersion }
										: {}),
									template_variable: { content: text },
								},
							},
						}
					: textPayload(text, mode);
			const encode = (text: string) => payloadFor(text).content;
			for (const part of chunks(msg.text, this.host.config.textChunkBytes ?? 18000, encode)) {
				const payload = payloadFor(part);
				lastId = await this.host.rawSend(target, payload.type, payload.content, replyTo, signal, nextUuid());
			}
			for (const attachment of msg.attachments ?? []) {
				const payload = await this.upload(attachment, signal);
				lastId = await this.host.rawSend(target, payload.type, payload.content, replyTo, signal, nextUuid());
			}
			if (!lastId) throw new Error("Feishu message contains no text or attachments");
			return { ok: true, id: lastId };
		} catch (error) {
			this.host.fail(error);
			return {
				ok: false,
				...(lastId ? { id: lastId } : {}),
				...(lastId || uncertain(error) ? { uncertain: true } : {}),
				...(!lastId && error instanceof FeishuRequestError && error.retryable ? { retryable: true } : {}),
				error: this.host.client.safe(error),
			};
		}
	}
	private async upload(attachment: Attachment, signal?: AbortSignal): Promise<{ type: string; content: object }> {
		signal?.throwIfAborted();
		// Channel output consumes local artifacts only. No remote URL fetch or credential-bearing redirects.
		const uri = new URL(attachment.uri);
		if (uri.protocol !== "file:") throw new Error("Feishu upload needs a local file: artifact URI");
		const path = fileURLToPath(uri);
		const limit = Math.min(
			this.host.config.mediaMaxBytes ?? 30000000,
			attachment.kind === "image" ? 10000000 : 30000000,
		);
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
			const result = await this.host.client.request("/im/v1/images", "POST", form, signal);
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
		const result = await this.host.client.request("/im/v1/files", "POST", form, signal);
		return { type: messageType, content: { file_key: required(object(result.data).file_key, "Uploaded file key") } };
	}
	async stream(
		target: string,
		out: AsyncIterable<OutputPart>,
		sourceMessageId?: string,
		signal?: AbortSignal,
	): Promise<Delivery> {
		signal = signal ? AbortSignal.any([signal, this.host.lifetime]) : this.host.lifetime;
		out = cancellable(out, signal);
		if (this.host.config.streaming === false) {
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
				return { ok: false, error: this.host.client.safe(error) };
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
			await this.host.client.request(
				`/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/content/content`,
				"PUT",
				{ content: text, sequence: ++sequence, uuid: randomUUID() },
				cleanup ? undefined : signal,
			);
			accepted = text;
			lastUpdate = Date.now();
		};
		const open = async () => {
			const replyTo = await this.host.interaction.beforeReply(target, sourceMessageId);
			const card = {
				schema: "2.0",
				config: { streaming_mode: true, summary: { content: "Generating…" } },
				body: { elements: [{ tag: "markdown", element_id: "content", content: "" }] },
			};
			const result = await this.host.client.request(
				"/cardkit/v1/cards",
				"POST",
				{ type: "card_json", data: JSON.stringify(card) },
				signal,
			);
			cardId = string(object(result.data).card_id);
			if (!cardId) throw new FeishuRequestError("Feishu CardKit creation omitted card id", true);
			messageId = await this.host.rawSend(
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
				if (Date.now() - lastUpdate >= (this.host.config.updateIntervalMs ?? 200)) await update();
				// A completed message closes immediately, even if its producer is still doing other work.
				if (part.type === "final") break;
			}
			signal?.throwIfAborted();
		} catch (error) {
			retryable = !messageId && error instanceof FeishuRequestError && error.retryable;
			outcomeUncertain ||= uncertain(error);
			errors.push(this.host.client.safe(error));
		} finally {
			if (cardId) {
				// Cleanup has a fresh bounded request signal so caller cancellation cannot strand streaming_mode.
				try {
					await update(true);
				} catch (error) {
					outcomeUncertain ||= uncertain(error);
					errors.push(this.host.client.safe(error));
				}
				try {
					await this.host.client.request(`/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`, "PATCH", {
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
					errors.push(this.host.client.safe(error));
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
