import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ApiError,
	contentSanitizer,
	FileKVStore,
	kvSessionPersistence,
	MediaFileType,
	mentionGate,
	QQBot,
	type QQBotInboundMessage,
	type ReplyTarget,
} from "@tencent-connect/qqbot-nodejs";
import {
	type Attachment,
	acct,
	type Channel,
	type ChannelIO,
	conv,
	type Delivery,
	type EventInput,
	type OutMessage,
	type PluginAPI,
	parseRef,
} from "@yonder/sdk";
import { GroupParticipation } from "./participation.js";

export interface Config {
	appId: string;
	credential: string;
	allowedUsers?: string[];
	allowedGroups?: string[];
	groupWindowSeconds?: number;
	groupParticipation?: Record<string, "all" | "mention" | "record">;
	groupKeywords?: string[];
	sendIntervalMs?: number;
	localMediaRoot?: string;
}
const str = { type: "string", minLength: 1 };
export const configSchema = {
	type: "object",
	additionalProperties: false,
	required: ["appId", "credential"],
	properties: {
		appId: { type: "string", pattern: "^[0-9]+$" },
		credential: str,
		allowedUsers: { type: "array", items: str },
		allowedGroups: { type: "array", items: str },
		groupWindowSeconds: { type: "integer", minimum: 1, maximum: 3600 },
		groupParticipation: { type: "object", additionalProperties: { enum: ["all", "mention", "record"] } },
		groupKeywords: { type: "array", items: str },
		sendIntervalMs: { type: "integer", minimum: 0, maximum: 60000 },
		localMediaRoot: { type: "string", minLength: 1 },
	},
};

type InboundMedia = NonNullable<QQBotInboundMessage["attachments"]>[number];

const mediaKind = (mime: string): Attachment["kind"] =>
	mime.startsWith("image/")
		? "image"
		: mime.startsWith("audio/")
			? "audio"
			: mime.startsWith("video/")
				? "video"
				: "file";

/** Platform media becomes real attachments; anything but an https URL is dropped, never guessed. */
export function attachmentsOf(items: InboundMedia[] | undefined): Attachment[] {
	return (items ?? []).flatMap((item) => {
		const uri = item.url;
		if (!uri?.startsWith("https://")) return [];
		const mime = item.content_type?.trim() || "application/octet-stream";
		return [
			{
				kind: mediaKind(mime),
				mime,
				uri,
				...(item.filename ? { name: item.filename } : {}),
				...(item.size ? { bytes: item.size } : {}),
			},
		];
	});
}

/** Count of inbound attachments the channel dropped (only https URLs are accepted). */
export function droppedAttachments(msg: QQBotInboundMessage, event: EventInput): number {
	const received = msg.attachments?.length ?? 0;
	const kept = (event.data as { attachments?: unknown[] }).attachments?.length ?? 0;
	return Math.max(0, received - kept);
}

/** A quoted reply only survives in msg_elements[0]; the reference index alone carries no text. */
export function quoteOf(msg: QQBotInboundMessage): { text: string } | undefined {
	const text = msg.msgElements?.[0]?.content?.trim();
	return msg.refMsgIdx !== undefined && text ? { text } : undefined;
}

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

/** Outbound media either goes to the platform as an https URL or is uploaded from an allowlisted local file. */
export interface OutboundMedia {
	fileType: MediaFileType;
	source: { url: string } | { localPath: string };
}
/** A skipped attachment: `reason` is a readable, actionable line for the owner and the log. */
export type MediaResolution = { ok: true; media: OutboundMedia } | { ok: false; reason: string };

const fileTypeOf = (attachment: Attachment): MediaFileType =>
	attachment.kind === "image"
		? MediaFileType.IMAGE
		: attachment.kind === "audio"
			? MediaFileType.VOICE
			: attachment.kind === "video"
				? MediaFileType.VIDEO
				: MediaFileType.FILE;

/** `~/…` and `~` mean the home directory of this harness process, never a guess. */
const expandHome = (uri: string, home: string) =>
	uri === "~" ? home : uri.startsWith("~/") ? join(home, uri.slice(2)) : uri;

/**
 * Attachment references arrive as https URLs, `file:` URIs, `~/…` or home-relative paths, or absolute paths.
 * Everything local is resolved to an absolute path first, then checked against the allowlisted media root;
 * a reference that cannot be resolved is reported instead of thrown, so one bad attachment never drops the text.
 */
export function mediaOf(attachment: Attachment, root: string, home = homedir()): MediaResolution {
	const fileType = fileTypeOf(attachment);
	const uri = attachment.uri.trim();
	if (uri.startsWith("https://")) return { ok: true, media: { fileType, source: { url: uri } } };
	let path: string;
	if (uri.startsWith("file:")) {
		try {
			path = fileURLToPath(uri);
		} catch {
			return { ok: false, reason: `无法解析的 file 引用 ${uri}；请改用 https 链接或本机文件路径` };
		}
	} else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(uri)) {
		return { ok: false, reason: `只支持 https 链接：${uri}` };
	} else path = resolve(home, expandHome(uri, home));
	const rel = relative(resolve(root), resolve(path));
	if (rel.startsWith("..") || isAbsolute(rel))
		return { ok: false, reason: `本机文件不在允许的目录 ${root} 内：${path}` };
	return { ok: true, media: { fileType, source: { localPath: resolve(path) } } };
}

/** Rejects a resolved local media path whose realpath leaves the allowlisted root, or that does not exist. */
export async function assertInsideMediaRoot(localPath: string, root: string): Promise<void> {
	const [realPath, realRoot] = await Promise.all([realpath(localPath), realpath(root)]);
	const rel = relative(realRoot, realPath);
	if (isAbsolute(rel) || rel === "" || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === "..")
		throw new Error(`QQ local attachment escapes the allowlisted media root: ${localPath}`);
}

export function incoming(
	id: string,
	config: Config,
	msg: QQBotInboundMessage,
	mentioned = msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
		msg.mentions?.some((mention) => mention.is_you === true) === true,
): EventInput | undefined {
	const text = msg.content.trim();
	const attachments = attachmentsOf(msg.attachments);
	const quote = quoteOf(msg);
	if (msg.senderIsBot || !msg.messageId || !msg.senderId || (!text && !attachments.length)) return;
	if (
		msg.kind !== "c2c" &&
		(msg.kind !== "group" || !["GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"].includes(msg.rawEventType))
	)
		return;
	const group = msg.kind === "group";
	const targetId = group ? msg.groupOpenid : msg.senderId;
	if (!targetId || ![targetId, msg.senderId].every((value) => /^[A-Za-z0-9_-]+$/.test(value)))
		throw new Error("QQ message has invalid identity");
	const allowed = group ? config.allowedGroups : config.allowedUsers;
	if (allowed && !allowed.includes(targetId)) return;
	const createdAt = Date.parse(msg.timestamp);
	return {
		type: "message.in",
		from: acct(id, msg.senderId),
		conv: conv(id, `${group ? "group" : "c2c"}:${targetId}`),
		data: {
			kind: group ? "group" : "dm",
			text,
			...(attachments.length ? { attachments } : {}),
			...(quote ? { quote } : {}),
			msgId: msg.messageId,
			...(group ? { mentioned, social: { mentions: { bot: mentioned }, nativeKind: msg.rawEventType } } : {}),
			...(Number.isFinite(createdAt) ? { createdAt: String(createdAt) } : {}),
			...(msg.senderName ? { name: msg.senderName } : {}),
		},
	};
}

export function recipient(id: string, target: string): ReplyTarget {
	const parsed = parseRef(target);
	if ((parsed.kind !== "conv" && parsed.kind !== "acct") || parsed.channel !== id)
		throw new Error("QQ target belongs to another instance");
	if (parsed.kind === "acct") {
		if (!/^[A-Za-z0-9_-]+$/.test(parsed.id)) throw new Error("Invalid QQ OpenID");
		return { scope: "c2c", targetId: parsed.id };
	}
	const match = /^(c2c|group):([A-Za-z0-9_-]+)$/.exec(parsed.id);
	if (!match) throw new Error("QQ conversation must include c2c: or group: and its OpenID");
	return { scope: match[1] as "c2c" | "group", targetId: String(match[2]) };
}

export class QQChannel implements Channel {
	readonly kinds = ["dm", "group"];
	readonly output = { stream: false, attachments: true };
	readonly features = { identity: "account", mentions: ["bot"], streamMode: "none" } satisfies NonNullable<
		Channel["features"]
	>;
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
		if (credential?.type !== "api_key" || !credential.key)
			throw new Error(`QQ credential unavailable: ${this.config.credential}`);
		this.secret = credential.key;
		const directory = join(this.api.paths.data, this.id);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		this.store = new FileKVStore({ dir: directory, fileName: "gateway.json" });
		if (this.config.groupWindowSeconds) {
			this.groups = new GroupParticipation(this.api, this.id, this.config.groupWindowSeconds, this.config);
			await this.groups.start();
		}
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
				this.groups?.accept(recorded as import("@yonder/sdk").YEvent);
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
						...(message.replyTo ? { messageReference: { message_id: message.replyTo } } : {}),
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
