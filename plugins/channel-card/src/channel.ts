import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Channel, ChannelIO, ChannelLoginResult, Delivery, OutMessage, PluginAPI, Ref } from "@yonder/sdk";
import WebSocket from "ws";
import {
	cardEndpoint,
	cardLoginCode,
	cardMentions,
	cardMessageEvent,
	cardResponseError,
	cardTarget,
	validateAgentMappings,
	validateDeviceMessage,
} from "./message.js";
import {
	type CardWorkerHost,
	greetCardOwners,
	linkWorkOwner,
	notifyWorkerDisconnected,
	openWorkBridge,
	parseDeviceFrame,
	reportWorkerResult,
	resolveDeliveryFrame,
	type WorkBridge,
	workerBots,
} from "./work.js";

export interface Config {
	endpoint?: string;
	device?: { kind?: "laptop" | "desktop" | "server" };
}
export { lateNote } from "./message.js";
export type { CardWorkerBot, CardWorkerHost } from "./work.js";

export class CardChannel implements Channel {
	readonly id: string;
	readonly multiAgent = true;
	readonly kinds = ["dm", "group", "notice"];
	readonly output: Channel["output"];
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
	private io: ChannelIO | undefined;
	private stopped = false;
	private controller = new AbortController();
	private socket: WebSocket | undefined;
	private workerDisconnectNotified = { value: false };
	private reconnect?: ReturnType<typeof setTimeout>;
	private pollTimer?: ReturnType<typeof setTimeout>;
	private nextSyncAt: number | undefined;
	private backoff = 1000;
	private mappings = new Map<string, string>();
	private pending = new Map<string, (delivery: Delivery) => void>();
	private welcome = false;
	private owners: Array<{ agent: string; account: Ref; actor: string }> = [];
	private deviceId: string | undefined;

	constructor(id: string, config: Config, api: PluginAPI, scheduleSync?: () => void | Promise<void>);
	constructor(id: string, worker: CardWorkerHost);
	constructor(
		id: string,
		configOrWorker: Config | CardWorkerHost,
		api?: PluginAPI,
		scheduleSync: () => void | Promise<void> = () => {},
	) {
		this.id = id;
		if (api) {
			this.api = api;
			this.config = configOrWorker as Config;
			this.scheduleSync = scheduleSync;
			this.files = api.storage.open();
			this.endpoint = cardEndpoint(this.config.endpoint);
			this.output = { stream: false, attachments: false };
		} else {
			this.worker = configOrWorker as CardWorkerHost;
			if (!this.worker.token || this.worker.token.length > 4096) throw new Error("Invalid card worker credential");
			this.config = this.worker.endpoint ? { endpoint: this.worker.endpoint } : {};
			this.endpoint = cardEndpoint(this.worker.endpoint);
			this.token = this.worker.token;
			this.output = { stream: false, attachments: false, singleResult: true };
		}
	}
	private readonly files?: ReturnType<PluginAPI["storage"]["open"]>;
	private api?: PluginAPI;
	private config: Config;
	private worker?: CardWorkerHost;
	private scheduleSync: () => void | Promise<void> = () => {};

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
		if (!response.ok) throw new Error(cardResponseError(response.status, path));
		return response.json();
	}

	private async save(): Promise<void> {
		if (!this.files) throw new Error("Card credentials are unavailable in worker mode");
		await this.files.write(`${this.id}.json`, JSON.stringify({ endpoint: this.endpoint, token: this.token }));
	}

	async start(io?: ChannelIO): Promise<void> {
		if (!this.worker && !io) throw new Error("Card channel needs host channel IO");
		this.io = io;
		this.stopped = false;
		this.controller = new AbortController();
		if (this.worker) {
			this.connect();
			return;
		}
		const api = this.api;
		const files = this.files;
		if (!api || !files) throw new Error("Card channel host state is unavailable");
		const stored = await files.read(`${this.id}.json`);
		if (stored !== undefined) {
			try {
				const state = JSON.parse(stored);
				if (state.endpoint !== this.endpoint || typeof state.token !== "string" || !state.token)
					throw new Error("Invalid card credentials");
				this.token = state.token;
			} catch {
				throw new Error("Card credential state invalid or endpoint changed");
			}
		}
		// 名片服务不可达（如证书过期）只告警，由定时同步重试；不能让它拖垮整个 harness 启动。
		if (this.token)
			await this.syncAgents().catch((error: unknown) => this.warn(`Agent sync failed: ${(error as Error).message}`));
		else await api.agents.list();
		await this.scheduleSync();
	}

	nextSync(): number | undefined {
		return this.nextSyncAt;
	}
	async tick(now: number): Promise<void> {
		if (this.worker) return;
		if (!this.token || this.nextSyncAt === undefined || now < this.nextSyncAt) return;
		await this.syncAgents().catch(() => this.warn("Agent sync failed"));
	}

	private warn(message: string): void {
		if (this.worker) this.worker.log?.(message);
		else this.api?.log.warn(message, { instance: this.id });
	}
	/**
	 * SOC01 G-02：设备授权只把「设备 owner 自己的账号」关联到本实例各 Agent 的 owner。
	 * 账号取自设备令牌可见的 /api/session actor（主人本人），不取消息里的 senderId，陌生账号无法借道成为 owner。
	 */
	private async linkOwner(agents: Array<{ id: string; owner?: Ref }>): Promise<void> {
		const api = this.api;
		if (this.worker || !api) throw new Error("Owner identity is unavailable in worker mode");
		const session = (await this.request("/api/session")) as { actor?: { id?: unknown }; deviceId?: unknown };
		const linked = await linkWorkOwner(this.id, api, agents, session, (message) => this.warn(message));
		this.owners = linked.owners;
		this.deviceId = linked.deviceId;
	}
	async syncAgents(): Promise<void> {
		const api = this.api;
		if (this.worker || !api) throw new Error("Agent sync is unavailable in worker mode");
		if (!this.token || this.stopped) return;
		try {
			const agents = await api.agents.list();
			const rows = await this.request(
				"/api/device/agents",
				"PUT",
				agents.map((a) => ({ key: a.id, name: a.name, avatarUrl: a.avatarUrl ?? null })),
			);
			const mappings = validateAgentMappings(rows, agents);
			if (this.stopped) return;
			this.mappings = mappings;
			// SOC01 G-02：授权完成后把设备主人自己的账号关联到各 Agent 的 owner，DM 才会判为 owner 进入主对话。
			await this.linkOwner(agents).catch((error: unknown) => {
				this.owners = [];
				this.deviceId = undefined;
				this.warn(`Owner identity link skipped: ${(error as Error).message}`);
			});
			if (this.socket) this.socket.close();
			else this.connect();
		} finally {
			this.nextSyncAt = this.stopped || !this.token ? undefined : Date.now() + 600000;
			await this.scheduleSync();
		}
	}

	async login(
		action: "start" | "poll",
		signal: AbortSignal,
		verifyCode?: string,
	): Promise<ChannelLoginResult & { message?: string }> {
		if (this.worker) throw new Error("Device login is unavailable in worker mode");
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
			const data = cardLoginCode(
				await this.request(
					"/api/device/start",
					"POST",
					{ name: hostname(), kind: this.config.device?.kind ?? "desktop" },
					signal,
				),
				this.endpoint,
			);
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
		const code = this.code;
		if (!code) throw new Error("Card login code is unavailable");
		try {
			const data = (await this.request(
				`/api/device/poll?code=${encodeURIComponent(code.code)}`,
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
		if (this.stopped || !this.token || (!this.worker && !this.io) || this.socket) return;
		clearTimeout(this.reconnect);
		const url = new URL("/ws/device", this.endpoint);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		this.workerDisconnectNotified.value = false;
		const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` }, handshakeTimeout: 15000 });
		this.socket = socket;
		socket.on("error", () => {
			this.warn("Device socket error");
			notifyWorkerDisconnected(this.worker, "connection interrupted", this.workerDisconnectNotified, (message) =>
				this.warn(message),
			);
		});
		let work: WorkBridge | undefined;
		socket.once("open", async () => {
			this.backoff = 1000;
			if (!this.worker)
				work = await openWorkBridge(this.io?.control, this.owners, this.mappings.size, this.deviceId, (frame) => {
					if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
				});
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify({ type: "hello", ...(work ? { workProtocol: 1 } : {}) }));
			if (this.welcome) {
				this.welcome = false;
				void greetCardOwners(
					this.io,
					this.owners,
					this.mappings,
					this.id,
					(path, method, data) => this.request(path, method, data),
					(message) => this.warn(message),
				).catch(() => this.warn("Owner connection notification failed"));
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
			if (resolveDeliveryFrame(data, this.pending, Boolean(this.worker))) return;
			if (data.type === "bots" && this.worker) {
				inputs = inputs
					.then(() => this.updateWorkerBots(data))
					.catch(() => {
						this.warn("Worker Bot map not accepted");
						socket.terminate();
					});
			} else if (data.type === "message") {
				const incoming = inputs
					.then(() => this.incoming(socket, data))
					.catch(() => {
						this.warn("Device input not accepted");
						socket.terminate();
					});
				if (!this.worker) inputs = incoming;
			}
		});
		socket.once("close", () => {
			work?.close();
			notifyWorkerDisconnected(this.worker, "connection interrupted", this.workerDisconnectNotified, (message) =>
				this.warn(message),
			);
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
	private async updateWorkerBots(data: Record<string, unknown>): Promise<void> {
		if (!this.worker) throw new Error("Invalid worker Bot map");
		const bots = workerBots(data);
		this.mappings = new Map(bots.map((bot) => [bot.id, bot.id]));
		await this.worker.onBots?.(bots);
	}
	private async incoming(socket: WebSocket, data: Record<string, unknown>): Promise<void> {
		if (socket.readyState !== WebSocket.OPEN || this.stopped) return;
		const agent = [...this.mappings].find(([, platform]) => platform === data.agentId)?.[0];
		if (!agent) return;
		const m = validateDeviceMessage(data, this.kinds);
		const event = cardMessageEvent(this.id, agent, data, m);
		if (this.worker) {
			await this.worker.receive({ agentId: agent, convId: data.convId as string, sourceMessageId: m.id, event });
		} else {
			const io = this.io;
			if (!io) throw new Error("Card channel host IO is unavailable");
			await io.emit(event);
		}
		if (socket.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify({ type: "ack", agentId: data.agentId, convId: data.convId, seq: m.seq }));
	}
	async send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		const parsed = cardTarget(target, this.id, this.mappings, Boolean(msg.attachments?.length));
		if (!parsed)
			return reportWorkerResult(this.worker, msg, {
				ok: false,
				error: "Invalid card target or unsupported attachments",
			});
		const { kind, key, id, agentId } = parsed;
		if (signal?.aborted || this.stopped)
			return reportWorkerResult(this.worker, msg, { ok: false, error: "Card send cancelled" });
		let convId = id;
		if (kind === "acct") {
			try {
				convId = (
					(await this.request("/api/device/dm", "POST", { agentId, accountId: id }, signal)) as { convId: string }
				).convId;
			} catch {
				return reportWorkerResult(this.worker, msg, { ok: false, error: "Card DM unavailable" });
			}
			if (typeof convId !== "string" || !convId)
				return reportWorkerResult(this.worker, msg, { ok: false, error: "Invalid card DM response" });
		}
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN || signal?.aborted)
			return reportWorkerResult(this.worker, msg, { ok: false, error: "Card not connected" });
		const mentions = cardMentions(this.id, key, msg.mentions);
		if (!mentions) return reportWorkerResult(this.worker, msg, { ok: false, error: "Invalid card mention" });
		return new Promise((resolve) => {
			const ref = randomUUID();
			const finish = (value: Delivery) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				this.pending.delete(ref);
				void reportWorkerResult(this.worker, msg, value).then(resolve);
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
					content: msg.content ?? { type: "markdown", text: msg.text, ...(mentions.length ? { mentions } : {}) },
					...(msg.sourceMessageId ? { sourceMessageId: msg.sourceMessageId } : {}),
					...(msg.deliveryId ? { deliveryId: msg.deliveryId } : {}),
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
		if (this.worker) throw new Error("Card drafts are unavailable in worker mode");
		const agentId = agent && this.mappings.get(agent);
		if (!agentId) throw new Error("Card Agent not registered");
		return this.request("/api/device/cards", "POST", { ...data, agentId }, signal);
	}
	async stop(): Promise<void> {
		this.stopped = true;
		notifyWorkerDisconnected(this.worker, "worker stopped", this.workerDisconnectNotified, (message) =>
			this.warn(message),
		);
		this.controller.abort();
		clearTimeout(this.reconnect);
		clearTimeout(this.pollTimer);
		this.nextSyncAt = undefined;
		await this.scheduleSync();
		for (const done of this.pending.values())
			done({ ok: false, uncertain: true, error: "Card stopped before confirmation" });
		this.socket?.terminate();
		this.socket = undefined;
		await this.polling?.catch(() => {});
	}
}
