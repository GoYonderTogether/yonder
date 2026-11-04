/**
 * The live connector: one outbound `/ws/device` connection, Bot registration
 * over `PUT /api/device/agents`, message delivery in/out of OpenClaw, and the
 * five session work methods. Spec 23: state only in <state>/yonder/, no
 * inbound port, no transcript copy, no device-execution methods; a failed or
 * unpaired setup degrades to the yonder_status tool with an honest reason.
 */

import { hostname } from "node:os";
import { BotBridge, type BotRegistration, type CloudApi } from "./bots.js";
import { GatewayClient } from "./gateway.js";
import { cloudUrl, deviceSocketUrl } from "./net.js";
import { GatewayRpc, type SessionGateway } from "./sessions.js";
import {
	type ConnectorState,
	clearStateDir,
	type InboundFrame,
	parseFrame,
	readConfig,
	readState,
	writeState,
} from "./state.js";
import { WorkBridge } from "./work.js";

export const DEFAULT_ENDPOINT = "https://yonderbot.net";

export interface ConnectorRuntime {
	/** The agent ids this gateway runs (OpenClaw's `agents.list` default id at minimum). */
	agents: Array<{ key: string; name: string }>;
	/** The local Gateway WebSocket URL and auth token. */
	gatewayUrl: string;
	gatewayToken?: string;
	defaultAgentId: string;
}

export interface ConnectOptions {
	endpoint?: string;
	stateDir: string;
	log: (message: string) => void;
	/** Resolved gateway facts; injected by index.ts from the OpenClaw runtime. */
	runtime: ConnectorRuntime;
}

export type OutboundFrame =
	| { type: "hello"; workProtocol?: 1 }
	| { type: "ack"; agentId: string; convId: string; seq: number }
	| { type: "send"; ref: string; agentId: string; convId: string; content: Record<string, unknown> }
	| {
			type: "work.response";
			requestId: string;
			ok: boolean;
			result?: unknown;
			error?: { code: string; message: string };
	  }
	| { type: "work.event"; channelId: string; frame: unknown };

export interface OutboundConnection {
	send(frame: OutboundFrame): boolean;
	start(): void;
}

/**
 * The input handed to the gateway for one cloud message. A replayed message
 * keeps the 「补收」 marker so an old instruction is never taken for the
 * current one (spec 16 §3). Undefined for content the gateway cannot carry.
 */
export function composeCloudInput(frame: Extract<InboundFrame, { type: "message" }>): string | undefined {
	const content = frame.message.content as { type?: unknown; text?: unknown };
	if (content.type !== "text" && content.type !== "markdown") return undefined;
	const text = typeof content.text === "string" ? content.text : "";
	if (!text.trim()) return undefined;
	if (frame.replayed) {
		const at = new Date(frame.message.createdAt).toISOString();
		return `[补收：这条消息发于 ${at}，设备离线期间未送达。若其中的操作已被之后的消息取代，不要再执行，先向对方确认。]\n${text}`;
	}
	const from = frame.message.senderName ?? "对方";
	const place = frame.convKind === "group" ? "群聊" : "私聊";
	return `[Yonder ${place} · ${from}]\n${text}`;
}

class DeviceConnection implements OutboundConnection {
	// The OpenClaw runtime bundles `ws`; its type is richer than the root
	// project's @types, so the constructor is typed loosely here.
	private socket:
		| {
				send(data: string): void;
				close(): void;
				readyState: number;
				on(ev: string, cb: (...a: unknown[]) => void): void;
				off(ev: string, cb: (...a: unknown[]) => void): void;
		  }
		| undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private delay = 1_000;
	private stopped = false;
	private open = false;

	constructor(
		private readonly endpoint: string,
		private readonly deviceToken: string,
		private readonly onFrame: (frame: InboundFrame) => void,
		private readonly onOpen: () => void,
		private readonly onClose: (reason: string) => void,
	) {}

	get connected(): boolean {
		return this.open;
	}

	start(): void {
		if (this.stopped) return;
		void this.loop();
	}

	private async loop(): Promise<void> {
		while (!this.stopped) {
			try {
				await this.connectOnce();
			} catch {
				// Retried below; the connector stays degraded meanwhile.
			}
			if (this.stopped) return;
			const delay = this.delay;
			this.delay = Math.min(30_000, this.delay * 2);
			await new Promise<void>((resolve) => {
				this.retry = setTimeout(resolve, delay);
				this.retry.unref?.();
			});
		}
	}

	private async connectOnce(): Promise<void> {
		const url = deviceSocketUrl(this.endpoint);
		const WsConstructor = (await import("ws")).WebSocket;
		const socket = new WsConstructor(url, {
			headers: { authorization: `Bearer ${this.deviceToken}` },
			maxPayload: 1_400_000,
		}) as unknown as NonNullable<typeof this.socket>;
		this.socket = socket;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("cloud connect timeout")), 10_000);
			const onOpen = () => {
				clearTimeout(timer);
				cleanup();
				resolve();
			};
			const onError = () => {
				clearTimeout(timer);
				cleanup();
				reject(new Error("cloud connect failed"));
			};
			const cleanup = () => {
				socket.off("open", onOpen);
				socket.off("error", onError);
			};
			socket.on("open", onOpen);
			socket.on("error", onError);
		});
		this.open = true;
		this.delay = 1_000;
		this.onOpen();
		for await (const raw of frames(socket)) {
			if (this.stopped) return;
			const frame = parseFrame(raw);
			if (frame) {
				try {
					this.onFrame(frame);
				} catch {
					/* one bad handler must not drop the connection */
				}
			}
		}
	}

	send(frame: OutboundFrame): boolean {
		const socket = this.socket;
		if (!socket || !this.open || socket.readyState !== 1) return false;
		try {
			socket.send(JSON.stringify(frame));
			return true;
		} catch {
			return false;
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = undefined;
		const socket = this.socket;
		this.socket = undefined;
		this.open = false;
		try {
			socket?.close();
		} catch {
			/* Already closed. */
		}
	}
}

/** The loose socket shape the OpenClaw-bundled `ws` provides. */
type WsSocket = NonNullable<DeviceConnection["socket"]>;

async function* frames(socket: WsSocket): AsyncGenerator<string> {
	const queue: string[] = [];
	const wake: (() => void)[] = [];
	let ended = false;
	const notify = () => wake.shift()?.();
	socket.on("message", (data: unknown) => {
		const text = typeof data === "string" ? data : String(data);
		queue.push(text);
		notify();
	});
	const end = () => {
		ended = true;
		notify();
	};
	socket.on("close", end);
	socket.on("error", end);
	while (!ended) {
		while (queue.length > 0) {
			const item = queue.shift();
			if (item !== undefined) yield item;
		}
		await new Promise<void>((resolve) => wake.push(resolve));
	}
	while (queue.length > 0) {
		const item = queue.shift();
		if (item !== undefined) yield item;
	}
}

// ---- live state ----

let active:
	| {
			connection: DeviceConnection;
			gateway: GatewayClient;
			gatewayRpc: GatewayRpc;
			work: WorkBridge;
			bots: BotBridge;
			endpoint: string;
			persist: (next: ConnectorState) => void;
			state: ConnectorState;
			unsyncHello: boolean;
	  }
	| undefined;

let lastStatus = "未连接 Yonder。";

/** The single model-facing tool's read. */
export function statusText(): string {
	return lastStatus;
}

/** Start the connector; never throws (spec 23 §3: 启动不做同步网络等待). */
export function connectYonder(options: ConnectOptions): void {
	if (active) return;
	const endpoint = options.endpoint?.trim() || DEFAULT_ENDPOINT;
	try {
		cloudUrl(endpoint);
	} catch (error) {
		lastStatus = `未连接：${error instanceof Error ? error.message : "服务地址无效"}`;
		return;
	}
	const stored = readConfig(options.stateDir);
	if (!stored) {
		lastStatus = "未连接 Yonder：在终端运行 `npx -y @yonder/connect openclaw` 完成安装与配对。";
		return;
	}
	let state = readState(options.stateDir);
	const persist = (next: ConnectorState) => {
		state = next;
		try {
			writeState(options.stateDir, next);
		} catch {
			// A read-only state root must not take the gateway down; this run
			// still works from memory.
		}
	};
	const host = hostname();
	const connection = new DeviceConnection(
		stored.endpoint,
		stored.deviceToken,
		(frame) => routeFrame(frame),
		() => {
			if (active && !active.unsyncHello) {
				active.unsyncHello = true;
				active.connection.send({ type: "hello", workProtocol: 1 });
			}
		},
		(reason) => {
			if (active) {
				active.unsyncHello = false;
				options.log(`Yonder 连接断开（${reason}），正在重连。`);
			}
		},
	);
	const gateway = new GatewayClient({
		url: options.runtime.gatewayUrl,
		token: options.runtime.gatewayToken,
		onEvent: (event) => gatewayRpc?.handleEvent(event.event, event.payload),
	});
	let gatewayRpc: GatewayRpc | undefined;
	const rpc = new GatewayRpc(gateway, options.runtime.defaultAgentId);
	gatewayRpc = rpc;
	const work = new WorkBridge(rpc as unknown as SessionGateway, connection, host, host);
	const agents = (): Promise<BotRegistration[]> =>
		Promise.resolve(options.runtime.agents.map(({ key, name }) => ({ key, name })));
	const bots = new BotBridge({
		gateway: {
			submit: (sessionKey, text) => rpc.submit(sessionKey, text),
			create: (opts) => rpc.create(opts),
			exists: (sessionKey) => rpc.show(sessionKey).then((row) => row !== undefined),
		},
		connection,
		api: {
			putAgents: async (list) => putAgents(stored.endpoint, stored.deviceToken, list),
		} as CloudApi,
		agents,
		onAck: (agentId, convId, seq) => {
			const key = `${agentId}:${convId}`;
			if (seq <= (state.cursors[key] ?? 0)) return;
			persist({ ...state, cursors: { ...state.cursors, [key]: seq } });
		},
		cursor: (agentId, convId) => state.cursors[`${agentId}:${convId}`],
		bindSession: (key, sessionKey) => persist({ ...state, botSessions: { ...state.botSessions, [key]: sessionKey } }),
		sessionFor: (key) => state.botSessions[key],
		unbindSession: (key) => {
			const next = { ...state.botSessions };
			delete next[key];
			persist({ ...state, botSessions: next });
		},
		log: options.log,
	});
	// Replies leave the gateway through the reduced event stream: the GatewayRpc
	// reduces `chat` finals; the connector core forwards them to the Bot bridge.
	rpc.onFinalReply = (sessionKey: string, text: string) => {
		void bots.onGatewayReply(sessionKey, text, true).catch(() => {});
	};
	active = {
		connection,
		gateway,
		gatewayRpc: rpc,
		work,
		bots,
		endpoint: stored.endpoint,
		persist,
		state,
		unsyncHello: false,
	};
	void bots.start().catch(() => {});
	void gateway.start();
	lastStatus = `正在连接 ${stored.endpoint}…`;
}

/** Stop the connector (spec 23 §6: 断开/卸载后不再连云端). */
export function disconnectYonder(): void {
	if (!active) return;
	active.bots.stop();
	active.work.stop();
	active.gateway.stop();
	active.connection.stop();
	active = undefined;
	lastStatus = "已断开 Yonder 连接。";
}

function routeFrame(frame: InboundFrame): void {
	if (!active) return;
	if (frame.type === "message" || frame.type === "sent" || frame.type === "error") {
		active.bots.handle(frame);
		return;
	}
	active.work.handle(frame);
}

/** `PUT /api/device/agents`: the harness's complete agent list, reconciled by the cloud (spec 23 §2.2). */
async function putAgents(
	endpoint: string,
	deviceToken: string,
	agents: Array<{ key: string; name: string; avatarUrl: string | null }>,
): Promise<Array<{ key: string; id: string }>> {
	const response = await fetch(new URL("/api/device/agents", endpoint), {
		method: "PUT",
		redirect: "error",
		headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
		body: JSON.stringify(agents),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`Bot registration failed (HTTP ${response.status})`);
	const body: unknown = await response.json();
	if (!Array.isArray(body)) throw new Error("Bot registration returned an invalid body");
	return body.flatMap((row) => {
		const item = row as { key?: unknown; id?: unknown };
		return typeof item.key === "string" && typeof item.id === "string" ? [{ key: item.key, id: item.id }] : [];
	});
}

/** The "disconnect" action: remove this connector's state files (spec 23 §6). */
export function disconnectState(dir: string): string[] {
	return clearStateDir(dir);
}
