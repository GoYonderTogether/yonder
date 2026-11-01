import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	ApiError,
	contentSanitizer,
	FileKVStore,
	kvSessionPersistence,
	mentionGate,
	QQBot,
} from "@tencent-connect/qqbot-nodejs";
import type { Channel, ChannelIO, Delivery, OutMessage, PluginAPI, YEvent } from "@yonder/sdk";
import type { Config } from "./config.js";
import { droppedAttachments, incoming } from "./inbound.js";
import { assertInsideMediaRoot, mediaOf, type OutboundMedia, recipient } from "./outbound.js";
import { GroupParticipation } from "./participation.js";

/** Serializes requests and keeps at least `intervalMs` between them; QQ rejects bursts. */
export class Spacing {
	private chain: Promise<unknown> = Promise.resolve();
	private last = 0;
	constructor(private readonly intervalMs: number) {}
	run<T>(work: () => Promise<T>): Promise<T> {
		const next = this.chain.then(async () => {
			const wait = this.last + this.intervalMs - Date.now();
			if (wait > 0) await new Promise<void>((done) => setTimeout(done, wait));
			try {
				return await work();
			} finally {
				this.last = Date.now();
			}
		});
		this.chain = next.catch(() => {});
		return next;
	}
}

export * from "./config.js";
export { attachmentsOf, droppedAttachments, incoming, quoteOf } from "./inbound.js";
export type { MediaResolution, OutboundMedia } from "./outbound.js";
export { assertInsideMediaRoot, mediaOf, recipient } from "./outbound.js";

export class QQChannel implements Channel {
	readonly kinds = ["dm", "group"];
	readonly output = { stream: false, attachments: true };
	readonly features = {
		identity: "account",
		mentions: ["bot"],
		outboundMentions: false,
		streamMode: "none",
	} satisfies NonNullable<Channel["features"]>;
	private bot: QQBot | undefined;
	private store: FileKVStore | undefined;
	private work: Promise<void> | undefined;
	private state = "stopped";
	private error: string | undefined;
	private secret = "";
	private received = 0;
	private sent = 0;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly queue: Spacing;
	private readonly mediaRoot: string;
	private groups: GroupParticipation | undefined;
	constructor(
		readonly id: string,
		readonly config: Config,
		private readonly api: PluginAPI,
	) {
		// Local attachments are only accepted under this allowlisted root.
		this.mediaRoot = resolve(config.localMediaRoot ?? join(api.paths.data, id, "media"));
		this.queue = new Spacing(config.sendIntervalMs ?? 500);
	}
	status() {
		return {
			instance: this.id,
			appId: this.config.appId,
			transport: "websocket",
			state: this.state,
			received: this.received,
			sent: this.sent,
			groups: this.groups?.status() ?? [],
			...(this.error ? { error: this.error } : {}),
		};
	}
	private safe(error: unknown): string {
		const text = error instanceof Error ? error.message : "QQ operation failed";
		return this.secret ? text.split(this.secret).join("[redacted]") : text;
	}
	async start(io: ChannelIO): Promise<void> {
		const credential = await this.api.credentials.get(this.config.credential);
		if (credential?.type !== "api_key" || !credential.key) {
			this.state = "unavailable";
			this.error = `QQ credential unavailable: ${this.config.credential}`;
			this.api.log.error("QQ transport unavailable", { instance: this.id, error: this.error });
			return;
		}
		this.secret = credential.key;
		const directory = join(this.api.paths.data, this.id);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		this.store = new FileKVStore({ dir: directory, fileName: "gateway.json" });
		this.groups = new GroupParticipation(this.api, this.id, this.config.groupWindowSeconds ?? 3, this.config);
		await this.groups.start();
		const bot = new QQBot({
			appId: this.config.appId,
			appSecret: credential.key,
			accountId: this.id,
			baseUrl: "https://api.bot.qq.com",
			tokenBaseUrl: "https://api.bot.qq.com",
			intents: 1 << 25,
			markdownSupport: false,
			sessionPersistence: kvSessionPersistence({ store: this.store, accountId: this.config.appId }),
		});
		this.bot = bot;
		// Detect mentions before the sanitizer removes their text markers; never drop room context.
		bot.use(mentionGate({ passthrough: true }), contentSanitizer({ stripBotMention: true }));
		this.state = "connecting";
		bot.on("ready", () => {
			this.state = "ready";
			this.error = undefined;
			this.api.log.info("QQ gateway ready", { instance: this.id });
		});
		bot.on("resumed", () => {
			this.state = "ready";
			this.error = undefined;
		});
		bot.on("error", (error) => {
			this.error = this.safe(error);
			this.state = "disconnected";
			this.api.log.warn("QQ connection error", { instance: this.id, error: this.error });
		});
		bot.on("message", async (ctx, msg) => {
			if (this.state === "stopped") return;
			const event = incoming(this.id, this.config, msg, ctx.state.mention?.wasMentioned ?? false);
			if (!event) return;
			const dropped = droppedAttachments(msg, event);
			if (dropped > 0) this.api.log.warn("QQ inbound attachments dropped", { instance: this.id, dropped });
			const work = io.emit(event);
			this.pending.add(work);
			try {
				const recorded = await work;
				const sender = recorded as YEvent;
				this.groups?.accept(sender);
				this.received++;
			} finally {
				this.pending.delete(work);
			}
		});
		// start owns the SDK's reconnect loop and only resolves after stop.
		this.work = bot
			.start()
			.catch((error: unknown) => {
				this.error = this.safe(error);
				this.state = "failed";
				this.api.log.error("QQ transport stopped", { instance: this.id, error: this.error });
			})
			.finally(() => {
				bot.stop();
				if (this.state !== "failed") this.state = "stopped";
			});
	}
	async stop(): Promise<void> {
		this.state = "stopped";
		this.groups?.stop();
		this.bot?.stop();
		await this.work;
		await Promise.allSettled(this.pending);
		this.store?.flush();
		this.bot = undefined;
		this.secret = "";
	}
	async send(target: string, message: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		// Per-item progress; declared outside try so the catch can report partial success.
		let accepted = 0;
		let firstId: string | undefined;
		let total = 0;
		try {
			signal?.throwIfAborted();
			if (message.mentions?.length)
				return { ok: false, error: "QQ 官方群消息接口的出站艾特格式尚未核实；未发送，不会用普通 @ 文本冒充提醒。" };
			const bot = this.bot;
			if (!bot || this.state === "stopped" || this.state === "failed") throw new Error("QQ channel is not running");
			const text = message.text.trim();
			if (!text && !message.attachments?.length) throw new Error("QQ reply is empty");
			// 一个附件失败不能丢掉整条消息：能发的照发，发不了的记一条可读警告。
			const media: OutboundMedia[] = [];
			const skipped: string[] = [];
			for (const item of message.attachments ?? []) {
				const resolution = mediaOf(item, this.mediaRoot);
				if (!resolution.ok) {
					skipped.push(`${item.name ?? item.uri}：${resolution.reason}`);
					continue;
				}
				if ("localPath" in resolution.media.source) {
					try {
						await assertInsideMediaRoot(resolution.media.source.localPath, this.mediaRoot);
					} catch (error) {
						skipped.push(`${item.name ?? item.uri}：${error instanceof Error ? error.message : String(error)}`);
						continue;
					}
				}
				media.push(resolution.media);
			}
			if (skipped.length)
				this.api.log.warn("QQ outbound attachments skipped; the text is still sent", {
					instance: this.id,
					skipped,
					allowedRoot: this.mediaRoot,
				});
			if (!text && !media.length)
				throw new Error(`QQ reply is empty: every attachment was skipped (${skipped.join("; ")})`);
			const to = recipient(this.id, target);
			const msgId = message.replyTo ?? message.sourceMessageId;
			if (msgId) to.msgId = msgId;
			let quoteId = message.replyTo;
			if (quoteId && to.scope === "group") {
				let after: string | undefined;
				do {
					const page = await this.api.events.query({
						type: "message.in",
						conv: target,
						limit: 1000,
						...(after ? { after } : {}),
					});
					const event = page.events.find((event) => (event.data as { msgId?: string }).msgId === message.replyTo);
					if (event) {
						quoteId = (event.data as { qq?: { msgIdx?: string } }).qq?.msgIdx ?? quoteId;
						break;
					}
					after = page.next;
				} while (after);
			}
			let sequence = 1;
			if (msgId) {
				const key = `reply:${to.scope}:${to.targetId}:${msgId}`;
				sequence = (this.store?.get<number>(key) ?? 0) + 1;
				this.store?.set(key, sequence, 60 * 60 * 1000);
				this.store?.flush();
			}
			total = (text ? 1 : 0) + media.length;
			if (text) {
				const response = await this.queue.run(() =>
					bot.send({
						target: to,
						msgType: 0,
						content: text,
						...(quoteId ? { messageReference: { message_id: quoteId } } : {}),
						extra: { msg_seq: sequence },
					}),
				);
				accepted++;
				if (response.id) firstId ??= response.id;
			}
			for (const item of media) {
				const response = await this.queue.run(() =>
					bot.sendMedia({ target: to, fileType: item.fileType, ...item.source }),
				);
				accepted++;
				if (response.message?.id) firstId ??= response.message.id;
			}
			this.sent++;
			// Text (or media) accepted without an id still counts as success.
			return { ok: true, ...(firstId ? { id: firstId } : {}) };
		} catch (error) {
			// SDK requests do not expose cancellation. Once started, await their receipt;
			// network failures and invalid responses cannot safely be replayed.
			if (accepted > 0) {
				// Partial success: keep the accepted id and report unknown so the core
				// records message.unknown instead of replaying the whole group (06 §8).
				return {
					ok: false,
					uncertain: true,
					...(firstId ? { id: firstId } : {}),
					error: `${this.safe(error)} (${accepted}/${total} accepted)`,
				};
			}
			const uncertain = !(error instanceof ApiError) || error.httpStatus === 0 || error.httpStatus >= 500;
			return { ok: false, error: this.safe(error), ...(uncertain ? { uncertain: true } : {}) };
		}
	}
}
