import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type {
	Attachment,
	Channel,
	ChannelIO,
	ChannelLoginResult,
	Delivery,
	OutMessage,
	PluginAPI,
	Ref,
} from "@yonder/sdk";
import WebSocket from "ws";
import { lateNote, socialMentions, validateDeviceMessage } from "./message.js";
import { linkWorkOwner, openWorkBridge, parseDeviceFrame, type WorkBridge } from "./work.js";

export interface Config {
	endpoint?: string;
	device?: { kind?: "laptop" | "desktop" | "server" };
}
export { lateNote } from "./message.js";

export class CardChannel implements Channel {
	readonly multiAgent = true;
	readonly kinds = ["dm", "group", "notice"];
	readonly output = { stream: false, attachments: false };
	readonly features = {
		groupParticipation: "membership",
		identity: "account",
		quote: "id",
		outboundMentions: true,
		streamMode: "none",
	} satisfies NonNullable<Channel["features"]>;
	readonly endpoint: string;
	private token?: string;
	private code: { code: string; url: string; expiresAt: string } | undefined;
	private loginState = "idle";
	private polling: Promise<ChannelLoginResult> | undefined;
	private io?: ChannelIO;
	private stopped = false;
	private controller = new AbortController();
	private socket: WebSocket | undefined;
	private reconnect?: ReturnType<typeof setTimeout>;
	private pollTimer?: ReturnType<typeof setTimeout>;
	private syncTimer?: ReturnType<typeof setInterval>;
	private backoff = 1000;
	private mappings = new Map<string, string>();
	private pending = new Map<string, (delivery: Delivery) => void>();
	private welcome = false;
	private owners: Array<{ agent: string; account: Ref; actor: string }> = [];
	private deviceId: string | undefined;

	constructor(
		readonly id: string,
		private config: Config,
		private api: PluginAPI,
	) {
		let url: URL;
		try {
			url = new URL(config.endpoint ?? "https://yonder.zethai.cn");
		} catch {
			throw new Error("Card endpoint must be an HTTP(S) origin without credentials");
		}
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/"
		)
			throw new Error("Card endpoint must be an HTTP(S) origin without credentials");
		if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
			throw new Error("Card endpoint requires HTTPS outside loopback");
		this.endpoint = url.origin;
	}

	private async request(path: string, method = "GET", data?: unknown, signal?: AbortSignal): Promise<unknown> {
		const response = await fetch(`${this.endpoint}${path}`, {
			method,
			redirect: "error",
			headers: {
				...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
				...(data !== undefined ? { "content-type": "application/json" } : {}),
			},
			...(data !== undefined ? { body: JSON.stringify(data) } : {}),
			signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
		});
		// Never put arbitrary server bodies (or credentials) into errors/logs.
		if (!response.ok)
			throw new Error(
				response.status === 404 && (path.startsWith("/api/device/poll") || path === "/api/device/redeem")
					? "invalid_code"
					: response.status === 429 && path === "/api/device/redeem"
						? "rate_limited"
						: `Card HTTP ${response.status}`,
			);
		return response.json();
	}

	private get file(): string {
		return join(this.api.paths.data, `${this.id}.json`);
	}
	private async save(): Promise<void> {
		await mkdir(this.api.paths.data, { recursive: true, mode: 0o700 });
		await chmod(this.api.paths.data, 0o700);
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify({ endpoint: this.endpoint, token: this.token }), { mode: 0o600 });
		await rename(temporary, this.file);
	}

	async start(io: ChannelIO): Promise<void> {
		this.io = io;
		this.stopped = false;
		this.controller = new AbortController();
		try {
			const state = JSON.parse(await readFile(this.file, "utf8"));
			if (state.endpoint !== this.endpoint || typeof state.token !== "string" || !state.token)
				throw new Error("Invalid card credentials");
			this.token = state.token;
			await chmod(this.api.paths.data, 0o700);
			await chmod(this.file, 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("Card credential state invalid or endpoint changed");
		}
		// 名片服务不可达（如证书过期）只告警，由定时同步重试；不能让它拖垮整个 harness 启动。
		if (this.token)
			await this.syncAgents().catch((error: unknown) => this.warn(`Agent sync failed: ${(error as Error).message}`));
		else await this.api.agents.list();
		this.syncTimer = setInterval(() => {
			if (this.token) void this.syncAgents().catch(() => this.warn("Agent sync failed"));
		}, 600000);
		this.syncTimer.unref();
	}

	/** 确认返回的确认链接属于本实例 origin；非法 URL 按响应不合法处理，不把解析异常抛给调用方。 */
	private sameOrigin(value: string): boolean {
		try {
			return new URL(value).origin === this.endpoint;
		} catch {
			return false;
		}
	}

	private warn(message: string): void {
		this.api.log.warn(message, { instance: this.id });
	}
	/**
	 * SOC01 G-02：设备授权只把「设备 owner 自己的账号」关联到本实例各 Agent 的 owner。
	 * 账号取自设备令牌可见的 /api/session actor（主人本人），不取消息里的 senderId，陌生账号无法借道成为 owner。
	 */
	private async linkOwner(agents: Array<{ id: string; owner?: Ref }>): Promise<void> {
		const session = (await this.request("/api/session")) as { actor?: { id?: unknown }; deviceId?: unknown };
		const linked = await linkWorkOwner(this.id, this.api, agents, session, (message) => this.warn(message));
		this.owners = linked.owners;
		this.deviceId = linked.deviceId;
	}
	async syncAgents(): Promise<void> {
		if (!this.token || this.stopped) return;
		const agents = await this.api.agents.list();
		const rows = await this.request(
			"/api/device/agents",
			"PUT",
			agents.map((a) => ({ key: a.id, name: a.name, avatarUrl: a.avatarUrl ?? null })),
		);
		if (
			!Array.isArray(rows) ||
			rows.length !== agents.length ||
			rows.some((r) => !r || typeof r.id !== "string" || !agents.some((a) => a.id === r.key)) ||
			new Set(rows.map((r) => r.key)).size !== agents.length
		)
			throw new Error("Invalid card Agent mapping");
		if (this.stopped) return;
		this.mappings = new Map(rows.map((r) => [r.key, r.id]));
		// SOC01 G-02：授权完成后把设备主人自己的账号关联到各 Agent 的 owner，DM 才会判为 owner 进入主对话。
		await this.linkOwner(agents).catch((error: unknown) => {
			this.owners = [];
			this.deviceId = undefined;
			this.warn(`Owner identity link skipped: ${(error as Error).message}`);
		});
		if (this.socket) this.socket.close();
		else this.connect();
	}

	async login(
		action: "start" | "poll",
		signal: AbortSignal,
		verifyCode?: string,
	): Promise<ChannelLoginResult & { message?: string }> {
		signal.throwIfAborted();
		if (this.stopped) return { status: "stopped", instance: this.id };
		if (this.token)
			return {
				status: verifyCode !== undefined ? "already-connected" : "confirmed",
				instance: this.id,
				message: "此设备已连接当前名片服务。",
			};
		// CLI passes poll for --verify-code; either action redeems the owner's invite.
		if (verifyCode !== undefined) {
			const invalid = {
				status: "invalid-code",
				instance: this.id,
				message: "邀请码无效、已过期或已使用，请在网页重新添加设备获取十位数字邀请码。",
			};
			if (!/^\d{10}$/.test(verifyCode)) return invalid;
			try {
				const data = (await this.request(
					"/api/device/redeem",
					"POST",
					{ code: verifyCode, name: hostname(), kind: this.config.device?.kind ?? "desktop" },
					signal,
				)) as { deviceToken?: unknown };
				await this.acceptToken(data.deviceToken);
				return { status: "connected", instance: this.id };
			} catch (error) {
				if (error instanceof Error && error.message === "invalid_code") return invalid;
				if (error instanceof Error && error.message === "rate_limited")
					return { status: "retry-later", instance: this.id, message: "兑换请求过于频繁，请稍后重试。" };
				throw error;
			}
		}
		if (action === "start" && !this.code) {
			const data = (await this.request(
				"/api/device/start",
				"POST",
				{ name: hostname(), kind: this.config.device?.kind ?? "desktop" },
				signal,
			)) as { code: string; url: string };
			if (typeof data.code !== "string" || !data.code || typeof data.url !== "string" || !this.sameOrigin(data.url))
				throw new Error("Invalid card login response");
			this.code = { ...data, expiresAt: new Date(Date.now() + 600000).toISOString() };
			this.loginState = "pending";
			this.schedulePoll();
		}
		if (action === "poll" && this.code) {
			this.polling ??= this.poll(signal).finally(() => {
				this.polling = undefined;
			});
			return this.polling;
		}
		return {
			status: this.loginState,
			instance: this.id,
			...(this.code ? { qrcodeUrl: this.code.url, expiresAt: this.code.expiresAt } : {}),
		};
	}
	private async acceptToken(token: unknown): Promise<void> {
		if (typeof token !== "string" || !token) throw new Error("Invalid card token response");
		this.token = token;
		await this.save();
		this.code = undefined;
		clearTimeout(this.pollTimer);
		this.loginState = "confirmed";
		this.owners = [];
		this.welcome = true;
		await this.syncAgents();
	}
	private schedulePoll(): void {
		clearTimeout(this.pollTimer);
		if (this.stopped || !this.code) return;
		this.pollTimer = setTimeout(() => {
			void this.login("poll", this.controller.signal)
				.catch(() => this.warn("Device polling failed"))
				.finally(() => this.schedulePoll());
		}, 2000);
		this.pollTimer.unref();
	}
	private async poll(signal: AbortSignal): Promise<ChannelLoginResult> {
		try {
			const data = (await this.request(
				`/api/device/poll?code=${encodeURIComponent(this.code!.code)}`,
				"GET",
				undefined,
				signal,
			)) as { status: string; deviceToken?: string };
			if (data.status === "confirmed") {
				await this.acceptToken(data.deviceToken);
			} else if (["used", "expired"].includes(data.status)) {
				this.code = undefined;
				this.loginState = data.status;
			} else if (data.status !== "pending") throw new Error("Invalid card polling response");
			return { status: data.status, instance: this.id };
		} catch (error) {
			if (error instanceof Error && error.message === "invalid_code") {
				this.code = undefined;
				this.loginState = "invalid_code";
				return { status: "invalid_code", instance: this.id };
			}
			throw error;
		}
	}

	controlReady(): void {
		if (this.socket) this.socket.close();
		else this.connect();
	}
	private connect(): void {
		if (this.stopped || !this.token || !this.io || this.socket) return;
		clearTimeout(this.reconnect);
		const url = new URL("/ws/device", this.endpoint);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` }, handshakeTimeout: 15000 });
		this.socket = socket;
		socket.on("error", () => this.warn("Device socket error"));
		let work: WorkBridge | undefined;
		socket.once("open", async () => {
			this.backoff = 1000;
			work = await openWorkBridge(this.io?.control, this.owners, this.mappings.size, this.deviceId, (frame) => {
				if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
			});
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify({ type: "hello", ...(work ? { workProtocol: 1 } : {}) }));
			if (this.welcome) {
				this.welcome = false;
				void this.greetOwners().catch(() => this.warn("Owner connection notification failed"));
			}
		});
		let inputs = Promise.resolve();
		socket.on("message", (raw) => {
			const data = parseDeviceFrame(raw);
			if (!data) return;
			if (typeof data.type === "string" && data.type.startsWith("work.")) {
				work?.receive(data);
				return;
			}
			if (data.type === "sent" && typeof data.ref === "string") {
				const message = data.message as { id?: unknown } | undefined;
				if (typeof message?.id === "string") this.pending.get(data.ref)?.({ ok: true, id: message.id });
			} else if (data.type === "error" && typeof data.ref === "string") {
				this.pending.get(data.ref)?.({ ok: false, error: "Card send rejected" });
			} else if (data.type === "message") {
				inputs = inputs
					.then(() => this.incoming(socket, data))
					.catch(() => {
						this.warn("Device input not accepted");
						socket.terminate();
					});
			}
		});
		socket.once("close", () => {
			work?.close();
			if (this.socket === socket) this.socket = undefined;
			for (const done of this.pending.values())
				done({ ok: false, uncertain: true, error: "Card disconnected before confirmation" });
			if (!this.stopped) {
				this.reconnect = setTimeout(() => this.connect(), this.backoff);
				this.reconnect.unref();
				this.backoff = Math.min(this.backoff * 2, 30000);
			}
		});
	}
	private async greetOwners(): Promise<void> {
		if (!this.io?.ownerConnected) return;
		for (const { agent, account, actor } of this.owners) {
			try {
				const agentId = this.mappings.get(agent);
				if (!agentId) continue;
				const result = (await this.request("/api/device/dm", "POST", { agentId, accountId: actor })) as {
					convId?: unknown;
				};
				if (typeof result.convId !== "string" || !result.convId) throw new Error("Invalid card DM response");
				await this.io.ownerConnected({ account, conv: `conv:${this.id}:${agent}:${result.convId}`, agent });
			} catch {
				this.warn(`Owner connection notification failed for ${agent}`);
			}
		}
	}
	private async incoming(socket: WebSocket, data: Record<string, unknown>): Promise<void> {
		if (socket.readyState !== WebSocket.OPEN || this.stopped) return;
		const agent = [...this.mappings].find(([, platform]) => platform === data.agentId)?.[0];
		if (!agent) return;
		const m = validateDeviceMessage(data, this.kinds);
		const content = m.content;
		const attachments: Attachment[] = [];
		if (content.type === "image" || content.type === "file") {
			if (typeof content.url !== "string") throw new Error("Invalid device attachment");
			attachments.push({
				kind: content.type,
				mime: content.type === "image" ? "image/*" : "application/octet-stream",
				uri: content.url,
				...(content.name !== undefined ? { name: content.name } : {}),
				...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
			});
		}
		const raw = content.type === "interactive" ? `${content.title ?? ""}\n${content.body ?? ""}` : (content.text ?? "");
		const text = data.replayed === true ? lateNote(m.createdAt, raw) : raw;
		const social = socialMentions(data.social, data.mentioned === true, data.convKind);
		await this.io!.emit({
			type: "message.in",
			from: `acct:${this.id}:${agent}:${m.senderId}`,
			conv: `conv:${this.id}:${agent}:${data.convId}`,
			data: {
				kind: data.convKind,
				target: agent,
				mentioned: social.mentions.bot,
				social: {
					...social,
					...(data.convKind === "group" ? { room: `card:${this.id}:${data.convId}` } : {}),
				},
				text,
				msgId: m.id,
				createdAt: String(m.createdAt),
				...(m.replyTo ? { replyTo: m.replyTo } : {}),
				...(m.senderName ? { name: m.senderName } : {}),
				...(typeof m.senderIsBot === "boolean" ? { senderIsBot: m.senderIsBot } : {}),
				...(Array.isArray(content.mentions)
					? { mentions: content.mentions.map((id) => `acct:${this.id}:${agent}:${id}`) }
					: {}),
				...(attachments.length ? { attachments } : {}),
			},
		});
		if (socket.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify({ type: "ack", agentId: data.agentId, convId: data.convId, seq: m.seq }));
	}
	async send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		const [kind, instance, key, id, extra] = target.split(":");
		const agentId = key && this.mappings.get(key);
		if (
			!["acct", "conv"].includes(kind ?? "") ||
			instance !== this.id ||
			!agentId ||
			!id ||
			extra ||
			msg.attachments?.length
		)
			return { ok: false, error: "Invalid card target or unsupported attachments" };
		if (signal?.aborted || this.stopped) return { ok: false, error: "Card send cancelled" };
		let convId = id;
		if (kind === "acct") {
			try {
				convId = (
					(await this.request("/api/device/dm", "POST", { agentId, accountId: id }, signal)) as { convId: string }
				).convId;
			} catch {
				return { ok: false, error: "Card DM unavailable" };
			}
			if (typeof convId !== "string" || !convId) return { ok: false, error: "Invalid card DM response" };
		}
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN || signal?.aborted)
			return { ok: false, error: "Card not connected" };
		const prefix = `acct:${this.id}:${key}:`;
		const mentions: string[] = [];
		for (const ref of msg.mentions ?? []) {
			if (!ref.startsWith(prefix) || !/^[0-9a-f-]{36}$/i.test(ref.slice(prefix.length)))
				return { ok: false, error: "Invalid card mention" };
			mentions.push(ref.slice(prefix.length));
		}
		return new Promise((resolve) => {
			const ref = randomUUID();
			const finish = (value: Delivery) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				this.pending.delete(ref);
				resolve(value);
			};
			const abort = () => finish({ ok: false, uncertain: true, error: "Card send cancelled before confirmation" });
			const timer = setTimeout(() => finish({ ok: false, uncertain: true, error: "Card confirmation timeout" }), 15000);
			this.pending.set(ref, finish);
			signal?.addEventListener("abort", abort, { once: true });
			socket.send(
				JSON.stringify({
					type: "send",
					ref,
					agentId,
					convId,
					content: { type: "markdown", text: msg.text, ...(mentions.length ? { mentions } : {}) },
					...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
				}),
				(error) => {
					if (error) finish({ ok: false, uncertain: true, error: "Card send outcome unknown" });
				},
			);
		});
	}
	async cardPush(
		agent: string | null,
		data: { title: string; markdown: string; display?: { kind: "html" | "svg"; source: string } },
		signal: AbortSignal,
	): Promise<unknown> {
		const agentId = agent && this.mappings.get(agent);
		if (!agentId) throw new Error("Card Agent not registered");
		return this.request("/api/device/cards", "POST", { ...data, agentId }, signal);
	}
	async stop(): Promise<void> {
		this.stopped = true;
		this.controller.abort();
		clearTimeout(this.reconnect);
		clearTimeout(this.pollTimer);
		clearInterval(this.syncTimer);
		for (const done of this.pending.values())
			done({ ok: false, uncertain: true, error: "Card stopped before confirmation" });
		this.socket?.terminate();
		this.socket = undefined;
		await this.polling?.catch(() => {});
	}
}
