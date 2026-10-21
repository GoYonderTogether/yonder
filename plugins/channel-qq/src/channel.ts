import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	ApiError,
	contentSanitizer,
	FileKVStore,
	kvSessionPersistence,
	mentionGate,
	QQBot,
	type QQBotInboundMessage,
	type ReplyTarget,
} from "@tencent-connect/qqbot-nodejs";
import {
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
	},
};

export function incoming(
	id: string,
	config: Config,
	msg: QQBotInboundMessage,
	mentioned = msg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
		msg.mentions?.some((mention) => mention.is_you === true) === true,
): EventInput | undefined {
	if (msg.senderIsBot || !msg.messageId || !msg.senderId || !msg.content.trim()) return;
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
			text: msg.content.trim(),
			msgId: msg.messageId,
			...(group ? { mentioned } : {}),
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
	readonly output = { stream: false, attachments: false };
	private bot: QQBot | undefined;
	private store: FileKVStore | undefined;
	private work: Promise<void> | undefined;
	private state = "stopped";
	private error: string | undefined;
	private secret = "";
	private received = 0;
	private sent = 0;
	private readonly pending = new Set<Promise<unknown>>();
	private groups: GroupParticipation | undefined;
	constructor(
		readonly id: string,
		readonly config: Config,
		private readonly api: PluginAPI,
	) {}
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
			this.groups = new GroupParticipation(this.api, this.id, this.config.groupWindowSeconds);
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
		let attempted = false;
		try {
			signal?.throwIfAborted();
			if (!this.bot || this.state === "stopped" || this.state === "failed")
				throw new Error("QQ channel is not running");
			if (message.attachments?.length) throw new Error("QQ first release supports text replies only");
			if (!message.text.trim()) throw new Error("QQ reply is empty");
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
			attempted = true;
			const response = await this.bot.send({
				target: to,
				msgType: 0,
				content: message.text,
				...(message.replyTo ? { messageReference: { message_id: message.replyTo } } : {}),
				extra: { msg_seq: sequence },
			});
			if (!response.id) throw new Error("QQ response omitted message ID; delivery is unknown");
			this.sent++;
			return { ok: true, id: response.id };
		} catch (error) {
			// SDK requests do not expose cancellation. Once started, await their receipt;
			// network failures and invalid responses cannot safely be replayed.
			const uncertain =
				attempted && (!(error instanceof ApiError) || error.httpStatus === 0 || error.httpStatus >= 500);
			return { ok: false, error: this.safe(error), ...(uncertain ? { uncertain: true } : {}) };
		}
	}
}
