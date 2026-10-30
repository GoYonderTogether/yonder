import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { Attachment, Channel, ChannelIO, ChannelLoginResult, Delivery, OutMessage, PluginAPI } from "@yonder/sdk";
import { privatePath, writePrivateFile } from "@yonder/sdk";
import WebSocket from "ws";

export interface Config {
	endpoint?: string;
	device?: { kind?: "laptop" | "desktop" | "server" };
}
interface Message {
	id: string;
	senderId: string;
	seq: number;
	createdAt: number;
	replyTo?: string;
	content: { type: string; text?: string; url?: string; name?: string; bytes?: number; title?: string; body?: string };
}

export class CardChannel implements Channel {
	readonly multiAgent = true;
	readonly kinds = ["dm", "group", "notice"];
	readonly output = { stream: false, attachments: false };
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

	constructor(
		readonly id: string,
		private config: Config,
		private api: PluginAPI,
	) {
		const url = new URL(config.endpoint ?? "https://yonder.zethai.cn");
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
		privatePath(this.api.paths.data, true);
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		await writePrivateFile(temporary, JSON.stringify({ endpoint: this.endpoint, token: this.token }));
		await rename(temporary, this.file);
	}

	async start(io: ChannelIO): Promise<void> {
		this.io = io;
		this.stopped = false;
		this.controller = new AbortController();
		try {
			privatePath(this.file);
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
		if (this.token) await this.syncAgents();
		else await this.api.agents.list();
		this.syncTimer = setInterval(() => {
			if (this.token) void this.syncAgents().catch(() => this.warn("Agent sync failed"));
		}, 600000);
		this.syncTimer.unref();
	}

	private warn(message: string): void {
		this.api.log.warn(message, { instance: this.id });
	}
	async syncAgents(): Promise<void> {
		if (!this.token || this.stopped) return;
		const agents = await this.api.agents.list();
		const rows = await this.request(
			"/api/device/agents",
			"PUT",
			agents.map((a) => ({ key: a.id, name: a.name })),
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
		// Backend hello subscriptions are fixed for the lifetime of a connection.
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
			if (
				typeof data.code !== "string" ||
				!data.code ||
				typeof data.url !== "string" ||
				new URL(data.url).origin !== this.endpoint
			)
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

	private connect(): void {
		if (this.stopped || !this.token || !this.io || this.socket) return;
		clearTimeout(this.reconnect);
		const url = new URL("/ws/device", this.endpoint);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` }, handshakeTimeout: 15000 });
		this.socket = socket;
		socket.on("error", () => this.warn("Device socket error"));
		socket.once("open", () => {
			this.backoff = 1000;
			socket.send(JSON.stringify({ type: "hello" }));
		});
		let inputs = Promise.resolve();
		socket.on("message", (raw) => {
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(raw.toString());
				if (!data || typeof data !== "object") return;
			} catch {
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
	private async incoming(socket: WebSocket, data: Record<string, unknown>): Promise<void> {
		if (socket.readyState !== WebSocket.OPEN || this.stopped) return;
		const agent = [...this.mappings].find(([, platform]) => platform === data.agentId)?.[0];
		if (!agent) return;
		const m = data.message as Message;
		if (
			typeof data.convId !== "string" ||
			!this.kinds.includes(String(data.convKind)) ||
			typeof data.mentioned !== "boolean" ||
			!m ||
			typeof m.id !== "string" ||
			typeof m.senderId !== "string" ||
			!Number.isInteger(m.seq) ||
			m.seq < 1 ||
			!Number.isFinite(m.createdAt) ||
			!m.content
		)
			throw new Error("Invalid device message");
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
		const text =
			content.type === "interactive" ? `${content.title ?? ""}\n${content.body ?? ""}` : (content.text ?? "");
		await this.io!.emit({
			type: "message.in",
			from: `acct:${this.id}:${agent}:${m.senderId}`,
			conv: `conv:${this.id}:${agent}:${data.convId}`,
			data: {
				kind: data.convKind,
				target: agent,
				mentioned: data.mentioned,
				text,
				msgId: m.id,
				createdAt: String(m.createdAt),
				...(m.replyTo ? { replyTo: m.replyTo } : {}),
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
					content: { type: "markdown", text: msg.text },
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
